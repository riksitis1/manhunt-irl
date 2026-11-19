import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoPoint, JoinSuccessPayload, RoomSettings, RoomSnapshot } from '@shared/types';
import {
  clearSession,
  emitAck,
  getSocket,
  loadSession,
  saveSession,
  type StoredSession,
} from './lib/socket';
import { GameView } from './views/GameView';
import { HomeView } from './views/HomeView';
import { LobbyView } from './views/LobbyView';
import { SummaryView } from './views/SummaryView';
import { WheelView } from './views/WheelView';

function getJoinCodeFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get('join') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function App() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const initialJoinCode = getJoinCodeFromUrl();

  useEffect(() => {
    const socket = getSocket();

    const tryReconnect = () => {
      const saved = sessionRef.current;
      if (!saved) return;
      void emitAck('room:reconnect', {
        roomCode: saved.roomCode,
        playerId: saved.playerId,
        sessionToken: saved.sessionToken,
      }).then((res) => {
        if (!res.ok) {
          clearSession();
          setSession(null);
          setRoom(null);
        }
      });
    };

    const onConnect = () => {
      setConnected(true);
      tryReconnect();
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    const onRoomState = (snapshot: RoomSnapshot) => {
      setClockOffsetMs(snapshot.serverNow - Date.now());
      setRoom(snapshot);
      setError(null);
    };

    const onKicked = (payload: { reason?: string }) => {
      clearSession();
      setSession(null);
      setRoom(null);
      setError(payload?.reason ?? 'You were removed from the lobby.');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoomState);
    socket.on('room:kicked', onKicked);

    if (socket.connected) {
      tryReconnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoomState);
      socket.off('room:kicked', onKicked);
    };
  }, []);

  const handleCreateLobby = async (name: string) => {
    setBusy(true);
    setError(null);
    const res = await emitAck<{ name: string }, JoinSuccessPayload>('room:create', { name });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Unable to create lobby.');
      return;
    }
    const nextSession: StoredSession = {
      ...res.data,
      name: name.trim(),
      savedAt: Date.now(),
    };
    saveSession(nextSession);
    setSession(nextSession);
  };

  const handleJoinLobby = async (code: string, name: string) => {
    setBusy(true);
    setError(null);
    const res = await emitAck<{ code: string; name: string }, JoinSuccessPayload>('room:join', {
      code,
      name,
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Unable to join lobby.');
      return;
    }
    const nextSession: StoredSession = {
      ...res.data,
      name: name.trim(),
      savedAt: Date.now(),
    };
    saveSession(nextSession);
    setSession(nextSession);
    // Clean ?join= query param after joining
    if (window.location.search.includes('join=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleLeave = () => {
    getSocket().emit('room:leave');
    clearSession();
    setSession(null);
    setRoom(null);
    setError(null);
  };

  const handleUpdateSettings = (patch: Partial<RoomSettings>) => {
    void emitAck('room:settings', patch).then((res) => {
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const handleKick = (playerId: string) => {
    void emitAck('room:kick', { playerId }).then((res) => {
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const handleStartGame = () => {
    setError(null);
    void emitAck('game:start', {}).then((res) => {
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const handleSkipWheel = () => {
    void emitAck('game:skipWheel', {});
  };

  const handleLocationUpdate = useCallback((point: GeoPoint, isGpsPing: boolean) => {
    getSocket().emit('location:update', {
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy,
      isGpsPing,
    });
  }, []);

  const handleSelfCaught = () => {
    void emitAck('game:selfCaught', {});
  };

  const handleClaimTag = (targetPlayerId: string) => {
    void emitAck('game:claimTag', { targetPlayerId });
  };

  const handleRespondTag = (accept: boolean) => {
    void emitAck('game:respondTag', { accept });
  };

  const handleHostEliminate = (targetPlayerId: string) => {
    void emitAck('game:hostEliminate', { targetPlayerId });
  };

  const handleEndGame = () => {
    void emitAck('game:end', {});
  };

  const handleResetLobby = () => {
    void emitAck('game:resetLobby', {});
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-obsidian text-slate-100">
      {!connected && (
        <div className="sticky top-0 z-[900] bg-amber-500 px-3 py-1 text-center text-[11px] font-black text-slate-950">
          Reconnecting to Manhunt server...
        </div>
      )}

      {!room && (
        <HomeView
          initialJoinCode={initialJoinCode}
          initialName={session?.name ?? ''}
          busy={busy}
          error={error}
          onCreateLobby={(name) => void handleCreateLobby(name)}
          onJoinLobby={(code, name) => void handleJoinLobby(code, name)}
        />
      )}

      {room?.phase === 'LOBBY' && (
        <LobbyView
          room={room}
          error={error}
          onUpdateSettings={handleUpdateSettings}
          onKickPlayer={handleKick}
          onStartGame={handleStartGame}
          onLeave={handleLeave}
        />
      )}

      {room?.phase === 'WHEEL' && (
        <WheelView room={room} clockOffsetMs={clockOffsetMs} onSkipWheel={handleSkipWheel} />
      )}

      {room && (room.phase === 'HEADSTART' || room.phase === 'ACTIVE') && session && (
        <GameView
          room={room}
          sessionToken={session.sessionToken}
          clockOffsetMs={clockOffsetMs}
          onLocationUpdate={handleLocationUpdate}
          onSelfCaught={handleSelfCaught}
          onClaimTag={handleClaimTag}
          onRespondTag={handleRespondTag}
          onHostEliminate={handleHostEliminate}
          onEndGame={handleEndGame}
        />
      )}

      {room?.phase === 'ENDED' && (
        <SummaryView room={room} onBackToLobby={handleResetLobby} onLeave={handleLeave} />
      )}
    </div>
  );
}
