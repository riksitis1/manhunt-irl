import crypto from 'node:crypto';
import { evaluateBoundary, isValidLatLng } from './geo.js';
import {
  DEFAULT_ROOM_SETTINGS,
  type Boundary,
  type EliminationReason,
  type GamePhase,
  type GeoPoint,
  type GpsPingItem,
  type MatchEvent,
  type PendingTagClaim,
  type PlayerRole,
  type PlayerStatus,
  type PublicPlayer,
  type RoomSettings,
  type RoomSnapshot,
  type VideoPingItem,
  type WheelCandidate,
  type WheelSpinState,
} from './shared/types.js';
import { VideoStore } from './videoStore.js';

interface InternalPendingPing {
  round: number;
  deadlineAt: number;
  challengeCode: string;
}

interface InternalPlayer {
  id: string;
  sessionToken: string;
  socketId: string | null;
  name: string;
  isHost: boolean;
  connected: boolean;
  role: PlayerRole;
  status: PlayerStatus;
  eliminatedAt?: number;
  eliminationReason?: EliminationReason;
  lastLocation?: GeoPoint;
  outOfBoundsSince?: number;
  pendingPing?: InternalPendingPing;
  pingSubmittedRound?: number;
  pendingTagClaim?: PendingTagClaim;
  lastLocationEventAt: number;
}

interface InternalRoom {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  phase: GamePhase;
  settings: RoomSettings;
  players: InternalPlayer[];
  wheel: WheelSpinState | null;
  wheelSelectedIds: string[];
  wheelAdvanceAt: number | null;
  headstartEndsAt: number | null;
  gameStartedAt: number | null;
  gameEndedAt: number | null;
  winnerSide: 'HUNTERS' | 'RUNNERS' | null;
  pingRound: number;
  pingRoundStartedAt: number | null;
  gpsFallbackAppliedRound: number;
  nextPingAt: number | null;
  videoPings: VideoPingItem[];
  gpsPings: GpsPingItem[];
  events: MatchEvent[];
  tickTimer: NodeJS.Timeout | null;
}

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_EVENTS = 60;
const MAX_GPS_ACCURACY_FOR_ELIMINATION_M = 35;
const WHEEL_SPIN_DURATION_MS = 4600;
const WHEEL_REVEAL_PAUSE_MS = 1800;
const TAG_CLAIM_DURATION_MS = 15_000;
const GPS_FALLBACK_DELAY_MS = 12_000;
const ROOM_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function randomCode(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
  }
  return out;
}

function randomChallengeCode(): string {
  return String(crypto.randomInt(1000, 10000));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 18);
}

function sanitizeBoundary(raw: unknown, fallback: Boundary): Boundary {
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Record<string, unknown>;
  if (candidate.type === 'NONE') {
    return { type: 'NONE' };
  }
  if (candidate.type === 'CIRCLE') {
    const center = candidate.center as Record<string, unknown> | undefined;
    const radius = candidate.radiusMeters;
    if (
      center &&
      isValidLatLng(center.lat, center.lng) &&
      typeof radius === 'number' &&
      Number.isFinite(radius)
    ) {
      return {
        type: 'CIRCLE',
        center: { lat: center.lat as number, lng: center.lng as number },
        radiusMeters: Math.max(25, Math.min(5000, Math.round(radius))),
      };
    }
    return fallback;
  }
  if (candidate.type === 'POLYGON' && Array.isArray(candidate.points)) {
    const pts = candidate.points
      .filter((p): p is { lat: number; lng: number } => {
        if (!p || typeof p !== 'object') return false;
        const obj = p as Record<string, unknown>;
        return isValidLatLng(obj.lat, obj.lng);
      })
      .slice(0, 40)
      .map((p) => ({ lat: p.lat, lng: p.lng }));
    if (pts.length >= 3) {
      return { type: 'POLYGON', points: pts };
    }
    return { type: 'NONE' };
  }
  return fallback;
}

export class GameManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToSession = new Map<string, { roomCode: string; playerId: string }>();
  private readonly videoStore: VideoStore;
  private readonly onRoomChanged: (roomCode: string) => void;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(videoStore: VideoStore, onRoomChanged: (roomCode: string) => void) {
    this.videoStore = videoStore;
    this.onRoomChanged = onRoomChanged;
    this.cleanupTimer = setInterval(() => {
      void this.purgeStaleRooms();
    }, 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  private addEvent(room: InternalRoom, type: MatchEvent['type'], message: string): void {
    room.events.unshift({
      id: crypto.randomBytes(6).toString('hex'),
      timestamp: Date.now(),
      type,
      message,
    });
    if (room.events.length > MAX_EVENTS) {
      room.events.length = MAX_EVENTS;
    }
  }

  private ensureTick(room: InternalRoom): void {
    if (room.tickTimer) return;
    room.tickTimer = setInterval(() => {
      this.tickRoom(room);
    }, 1000);
  }

  private stopTick(room: InternalRoom): void {
    if (!room.tickTimer) return;
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }

  createRoom(
    socketId: string,
    rawName: string
  ): { ok: true; roomCode: string; playerId: string; sessionToken: string } | { ok: false; error: string } {
    const name = sanitizeName(rawName);
    if (name.length < 2) {
      return { ok: false, error: 'Enter a nickname (at least 2 characters).' };
    }

    let code = randomCode(4);
    let tries = 0;
    while (this.rooms.has(code) && tries < 20) {
      code = randomCode(4);
      tries++;
    }

    const playerId = crypto.randomBytes(8).toString('hex');
    const sessionToken = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    const host: InternalPlayer = {
      id: playerId,
      sessionToken,
      socketId,
      name,
      isHost: true,
      connected: true,
      role: 'UNASSIGNED',
      status: 'ALIVE',
      lastLocationEventAt: 0,
    };

    const room: InternalRoom = {
      code,
      createdAt: now,
      lastActivityAt: now,
      phase: 'LOBBY',
      settings: structuredClone(DEFAULT_ROOM_SETTINGS),
      players: [host],
      wheel: null,
      wheelSelectedIds: [],
      wheelAdvanceAt: null,
      headstartEndsAt: null,
      gameStartedAt: null,
      gameEndedAt: null,
      winnerSide: null,
      pingRound: 0,
      pingRoundStartedAt: null,
      gpsFallbackAppliedRound: 0,
      nextPingAt: null,
      videoPings: [],
      gpsPings: [],
      events: [],
      tickTimer: null,
    };

    this.addEvent(room, 'SYSTEM', `${name} created lobby ${code}`);
    this.rooms.set(code, room);
    this.socketToSession.set(socketId, { roomCode: code, playerId });
    this.onRoomChanged(code);

    return { ok: true, roomCode: code, playerId, sessionToken };
  }

  joinRoom(
    socketId: string,
    rawCode: string,
    rawName: string
  ): { ok: true; roomCode: string; playerId: string; sessionToken: string } | { ok: false; error: string } {
    const code = rawCode.trim().toUpperCase();
    const name = sanitizeName(rawName);
    if (name.length < 2) {
      return { ok: false, error: 'Enter a nickname (at least 2 characters).' };
    }

    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: `Lobby "${code}" not found.` };
    }

    if (room.phase !== 'LOBBY') {
      return { ok: false, error: 'Match already in progress.' };
    }

    if (room.players.length >= room.settings.maxPlayers) {
      return { ok: false, error: `Lobby is full (${room.settings.maxPlayers} max).` };
    }

    // Disambiguate duplicate names cleanly
    let finalName = name;
    let suffix = 2;
    while (room.players.some((p) => p.name.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${name.slice(0, 15)} #${suffix}`;
      suffix++;
    }

    const playerId = crypto.randomBytes(8).toString('hex');
    const sessionToken = crypto.randomBytes(16).toString('hex');

    room.players.push({
      id: playerId,
      sessionToken,
      socketId,
      name: finalName,
      isHost: false,
      connected: true,
      role: 'UNASSIGNED',
      status: 'ALIVE',
      lastLocationEventAt: 0,
    });

    room.lastActivityAt = Date.now();
    this.addEvent(room, 'SYSTEM', `${finalName} joined the lobby`);
    this.socketToSession.set(socketId, { roomCode: code, playerId });
    this.onRoomChanged(code);

    return { ok: true, roomCode: code, playerId, sessionToken };
  }

  reconnectPlayer(
    socketId: string,
    roomCode: string,
    playerId: string,
    sessionToken: string
  ): { ok: true; roomCode: string; playerId: string } | { ok: false; error: string } {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room) return { ok: false, error: 'Session expired or lobby closed.' };

    const player = room.players.find((p) => p.id === playerId && p.sessionToken === sessionToken);
    if (!player) return { ok: false, error: 'Invalid session credentials.' };

    if (player.socketId && player.socketId !== socketId) {
      this.socketToSession.delete(player.socketId);
    }

    player.socketId = socketId;
    player.connected = true;
    room.lastActivityAt = Date.now();
    this.socketToSession.set(socketId, { roomCode: room.code, playerId: player.id });
    this.onRoomChanged(room.code);

    return { ok: true, roomCode: room.code, playerId: player.id };
  }

  handleDisconnect(socketId: string): void {
    const session = this.socketToSession.get(socketId);
    if (!session) return;
    this.socketToSession.delete(socketId);

    const room = this.rooms.get(session.roomCode);
    if (!room) return;

    const player = room.players.find((p) => p.id === session.playerId);
    if (!player) return;

    if (player.socketId === socketId) {
      player.socketId = null;
      player.connected = false;
    }

    // Reassign host if host disconnected while in LOBBY and another connected player exists
    if (player.isHost && room.phase === 'LOBBY') {
      const nextHost = room.players.find((p) => p.connected && p.id !== player.id);
      if (nextHost) {
        player.isHost = false;
        nextHost.isHost = true;
        this.addEvent(room, 'SYSTEM', `${nextHost.name} is now the lobby host`);
      }
    }

    this.onRoomChanged(room.code);
  }

  leaveRoom(socketId: string): void {
    const session = this.socketToSession.get(socketId);
    if (!session) return;
    this.socketToSession.delete(socketId);

    const room = this.rooms.get(session.roomCode);
    if (!room) return;

    const idx = room.players.findIndex((p) => p.id === session.playerId);
    if (idx === -1) return;
    const [player] = room.players.splice(idx, 1);
    if (!player) return;

    if (room.phase === 'LOBBY') {
      this.addEvent(room, 'SYSTEM', `${player.name} left the lobby`);
      if (room.players.length === 0) {
        this.stopTick(room);
        this.rooms.delete(room.code);
        void this.videoStore.deleteRoomVideos(room.code);
        return;
      }
      if (player.isHost) {
        const nextHost = room.players.find((p) => p.connected) ?? room.players[0];
        if (nextHost) {
          nextHost.isHost = true;
          this.addEvent(room, 'SYSTEM', `${nextHost.name} is now the lobby host`);
        }
      }
      this.onRoomChanged(room.code);
      return;
    }

    // During an active match, keep record as forfeited instead of removing mid-match
    player.connected = false;
    player.socketId = null;
    room.players.splice(idx, 0, player);
    if (player.role === 'RUNNER' && player.status === 'ALIVE') {
      this.eliminatePlayer(room, player, 'FORFEIT');
    } else {
      this.onRoomChanged(room.code);
    }
  }

  updateSettings(socketId: string, patch: Partial<RoomSettings>): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a lobby.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only the host can change settings.' };
    if (room.phase !== 'LOBBY') return { ok: false, error: 'Cannot edit settings during a match.' };

    const next = { ...room.settings };
    if (patch.mode === 'VIDEO' || patch.mode === 'GPS') {
      next.mode = patch.mode;
    }
    if (patch.maxPlayers !== undefined) {
      next.maxPlayers = clampInt(patch.maxPlayers, Math.max(2, room.players.length), 20, next.maxPlayers);
    }
    if (patch.hunterCount !== undefined) {
      next.hunterCount = clampInt(patch.hunterCount, 1, Math.max(1, next.maxPlayers - 1), next.hunterCount);
    }
    if (patch.headstartSec !== undefined) {
      next.headstartSec = clampInt(patch.headstartSec, 10, 600, next.headstartSec);
    }
    if (patch.pingIntervalSec !== undefined) {
      next.pingIntervalSec = clampInt(patch.pingIntervalSec, 30, 900, next.pingIntervalSec);
    }
    if (patch.videoDeadlineSec !== undefined) {
      next.videoDeadlineSec = clampInt(patch.videoDeadlineSec, 30, 300, next.videoDeadlineSec);
    }
    if (patch.videoMaxDurationSec !== undefined) {
      next.videoMaxDurationSec = clampInt(patch.videoMaxDurationSec, 5, 15, next.videoMaxDurationSec);
    }
    if (typeof patch.keepVideos === 'boolean') {
      next.keepVideos = patch.keepVideos;
    }
    if (patch.boundaryGraceSec !== undefined) {
      next.boundaryGraceSec = clampInt(patch.boundaryGraceSec, 0, 30, next.boundaryGraceSec);
    }
    if (patch.boundary !== undefined) {
      next.boundary = sanitizeBoundary(patch.boundary, next.boundary);
    }

    // Ensure hunterCount stays valid relative to maxPlayers
    next.hunterCount = Math.min(next.hunterCount, Math.max(1, next.maxPlayers - 1));
    room.settings = next;
    room.lastActivityAt = Date.now();
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  kickPlayer(socketId: string, targetPlayerId: string): { ok: boolean; error?: string; kickedSocketId?: string | null } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a lobby.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only the host can kick players.' };
    if (room.phase !== 'LOBBY') return { ok: false, error: 'Cannot kick during active match.' };
    if (targetPlayerId === player.id) return { ok: false, error: 'Cannot kick yourself.' };

    const idx = room.players.findIndex((p) => p.id === targetPlayerId);
    if (idx === -1) return { ok: false, error: 'Player not found.' };
    const [removed] = room.players.splice(idx, 1);
    if (!removed) return { ok: false, error: 'Player not found.' };

    if (removed.socketId) {
      this.socketToSession.delete(removed.socketId);
    }

    this.addEvent(room, 'SYSTEM', `${removed.name} was removed by host`);
    this.onRoomChanged(room.code);
    return { ok: true, kickedSocketId: removed.socketId };
  }

  startGame(socketId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a lobby.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only the host can start the game.' };
    if (room.phase !== 'LOBBY') return { ok: false, error: 'Match already started.' };
    if (room.players.length < 2) {
      return { ok: false, error: 'Need at least 2 players to start.' };
    }

    // Clamp hunter count if fewer players joined than configured
    const validHunters = Math.min(room.settings.hunterCount, room.players.length - 1);
    room.settings.hunterCount = Math.max(1, validHunters);

    // Reset player states
    for (const p of room.players) {
      p.role = 'UNASSIGNED';
      p.status = 'ALIVE';
      p.eliminatedAt = undefined;
      p.eliminationReason = undefined;
      p.outOfBoundsSince = undefined;
      p.pendingPing = undefined;
      p.pingSubmittedRound = undefined;
      p.pendingTagClaim = undefined;
    }

    room.videoPings = [];
    room.gpsPings = [];
    room.pingRound = 0;
    room.pingRoundStartedAt = null;
    room.gpsFallbackAppliedRound = 0;
    room.nextPingAt = null;
    room.gameStartedAt = null;
    room.gameEndedAt = null;
    room.winnerSide = null;
    room.wheelSelectedIds = [];
    room.phase = 'WHEEL';
    room.lastActivityAt = Date.now();

    this.addEvent(
      room,
      'PHASE',
      `Spinning wheel to pick ${room.settings.hunterCount} hunter${room.settings.hunterCount > 1 ? 's' : ''}...`
    );

    this.startNextWheelSpin(room);
    this.ensureTick(room);
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  private startNextWheelSpin(room: InternalRoom): void {
    const remaining: WheelCandidate[] = room.players
      .filter((p) => !room.wheelSelectedIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    const spinIndex = room.wheelSelectedIds.length;
    const totalSpins = room.settings.hunterCount;

    if (spinIndex >= totalSpins || remaining.length === 0) {
      this.finishWheelAndStartHeadstart(room);
      return;
    }

    const winnerIndex = crypto.randomInt(0, remaining.length);
    const winner = remaining[winnerIndex];
    if (!winner) {
      this.finishWheelAndStartHeadstart(room);
      return;
    }

    const selectedHunters: WheelCandidate[] = room.wheelSelectedIds
      .map((id) => room.players.find((p) => p.id === id))
      .filter((p): p is InternalPlayer => Boolean(p))
      .map((p) => ({ id: p.id, name: p.name }));

    const now = Date.now();
    room.wheel = {
      spinIndex,
      totalSpins,
      candidates: remaining,
      winnerId: winner.id,
      winnerIndex,
      winnerName: winner.name,
      startedAt: now,
      durationMs: WHEEL_SPIN_DURATION_MS,
      extraRotations: crypto.randomInt(5, 8),
      selectedHunters,
    };

    room.wheelSelectedIds.push(winner.id);
    room.wheelAdvanceAt = now + WHEEL_SPIN_DURATION_MS + WHEEL_REVEAL_PAUSE_MS;
  }

  skipWheel(socketId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a lobby.' };
    const { room, player } = ctx;
    if (!player.isHost) return { ok: false, error: 'Only host can skip wheel.' };
    if (room.phase !== 'WHEEL') return { ok: false, error: 'Wheel is not active.' };

    // Pick any remaining hunter slots immediately
    while (room.wheelSelectedIds.length < room.settings.hunterCount) {
      const remaining = room.players.filter((p) => !room.wheelSelectedIds.includes(p.id));
      if (remaining.length === 0) break;
      const picked = remaining[crypto.randomInt(0, remaining.length)];
      if (picked) room.wheelSelectedIds.push(picked.id);
    }

    this.finishWheelAndStartHeadstart(room);
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  private finishWheelAndStartHeadstart(room: InternalRoom): void {
    const hunterSet = new Set(room.wheelSelectedIds);
    const hunterNames: string[] = [];

    for (const p of room.players) {
      if (hunterSet.has(p.id)) {
        p.role = 'HUNTER';
        hunterNames.push(p.name);
      } else {
        p.role = 'RUNNER';
      }
      p.status = 'ALIVE';
    }

    const now = Date.now();
    room.wheel = null;
    room.wheelAdvanceAt = null;
    room.phase = 'HEADSTART';
    room.headstartEndsAt = now + room.settings.headstartSec * 1000;
    room.lastActivityAt = now;

    this.addEvent(
      room,
      'PHASE',
      `Hunters selected: ${hunterNames.join(', ')}. ${room.settings.headstartSec}s headstart begins!`
    );
  }

  private startActiveHunt(room: InternalRoom): void {
    const now = Date.now();
    room.phase = 'ACTIVE';
    room.headstartEndsAt = null;
    room.gameStartedAt = now;
    room.nextPingAt = now + room.settings.pingIntervalSec * 1000;
    room.lastActivityAt = now;

    this.addEvent(room, 'PHASE', 'HEADSTART OVER — Hunters released!');
  }

  private triggerPingRound(room: InternalRoom): void {
    const now = Date.now();
    room.pingRound += 1;
    room.pingRoundStartedAt = now;
    room.nextPingAt = now + room.settings.pingIntervalSec * 1000;
    room.lastActivityAt = now;

    if (room.settings.mode === 'VIDEO') {
      // Ephemeral cleanup: remove previous round clips when keepVideos is OFF
      if (!room.settings.keepVideos && room.videoPings.length > 0) {
        const toDelete = room.videoPings.map((v) => v.id);
        room.videoPings = [];
        for (const id of toDelete) {
          void this.videoStore.deleteVideo(id);
        }
      }

      const deadlineAt = now + room.settings.videoDeadlineSec * 1000;
      for (const p of room.players) {
        if (p.role === 'RUNNER' && p.status === 'ALIVE') {
          p.pendingPing = {
            round: room.pingRound,
            deadlineAt,
            challengeCode: randomChallengeCode(),
          };
        }
      }

      this.addEvent(
        room,
        'PING_ROUND',
        `Ping #${room.pingRound}: Runners have ${Math.round(room.settings.videoDeadlineSec)}s to send a live 360° video!`
      );
    } else {
      // GPS mode: runners have a short window to push fresh GPS; fallback publishes last known location
      const deadlineAt = now + GPS_FALLBACK_DELAY_MS;
      for (const p of room.players) {
        if (p.role === 'RUNNER' && p.status === 'ALIVE') {
          p.pendingPing = {
            round: room.pingRound,
            deadlineAt,
            challengeCode: 'GPS',
          };
        }
      }

      this.addEvent(room, 'PING_ROUND', `GPS Ping #${room.pingRound} triggered — locating runners...`);
    }
  }

  private tickRoom(room: InternalRoom): void {
    const now = Date.now();
    let changed = false;

    if (room.phase === 'WHEEL' && room.wheelAdvanceAt !== null && now >= room.wheelAdvanceAt) {
      this.startNextWheelSpin(room);
      changed = true;
    } else if (room.phase === 'HEADSTART' && room.headstartEndsAt !== null && now >= room.headstartEndsAt) {
      this.startActiveHunt(room);
      changed = true;
    } else if (room.phase === 'ACTIVE') {
      // 1. Check boundary grace periods
      for (const p of room.players) {
        if (p.role === 'RUNNER' && p.status === 'ALIVE' && p.outOfBoundsSince !== undefined) {
          const graceMs = room.settings.boundaryGraceSec * 1000;
          if (now - p.outOfBoundsSince >= graceMs) {
            this.eliminatePlayer(room, p, 'OUT_OF_BOUNDS', false);
            changed = true;
          }
        }
      }

      // 2. Check pending tag claim timeouts
      for (const p of room.players) {
        if (p.pendingTagClaim && now >= p.pendingTagClaim.expiresAt) {
          p.pendingTagClaim = undefined;
          changed = true;
        }
      }

      // 3. Check video ping deadlines
      if (room.settings.mode === 'VIDEO') {
        for (const p of room.players) {
          if (p.role === 'RUNNER' && p.status === 'ALIVE' && p.pendingPing) {
            if (now >= p.pendingPing.deadlineAt) {
              p.pendingPing = undefined;
              this.eliminatePlayer(room, p, 'MISSED_VIDEO_PING', false);
              changed = true;
            }
          }
        }
      } else if (
        room.settings.mode === 'GPS' &&
        room.pingRound > 0 &&
        room.pingRoundStartedAt !== null &&
        room.gpsFallbackAppliedRound < room.pingRound &&
        now - room.pingRoundStartedAt >= GPS_FALLBACK_DELAY_MS
      ) {
        // Fallback: publish last known GPS for any alive runner who didn't send a fresh ping in time
        room.gpsFallbackAppliedRound = room.pingRound;
        for (const p of room.players) {
          if (
            p.role === 'RUNNER' &&
            p.status === 'ALIVE' &&
            p.pingSubmittedRound !== room.pingRound
          ) {
            p.pendingPing = undefined;
            if (p.lastLocation) {
              room.gpsPings.unshift({
                id: crypto.randomBytes(6).toString('hex'),
                round: room.pingRound,
                playerId: p.id,
                playerName: p.name,
                lat: p.lastLocation.lat,
                lng: p.lastLocation.lng,
                accuracy: p.lastLocation.accuracy,
                createdAt: now,
                isFallbackLastKnown: true,
              });
              p.pingSubmittedRound = room.pingRound;
              this.addEvent(room, 'GPS_SENT', `GPS spot pinged for ${p.name} (last known fix)`);
              changed = true;
            }
          }
        }
      }

      // 4. Trigger next ping cycle
      if (room.phase === 'ACTIVE' && room.nextPingAt !== null && now >= room.nextPingAt) {
        this.triggerPingRound(room);
        changed = true;
      }

      // 5. Check win condition
      if (room.phase === 'ACTIVE') {
        const aliveRunners = room.players.filter((p) => p.role === 'RUNNER' && p.status === 'ALIVE');
        if (aliveRunners.length === 0) {
          this.finishGame(room, 'HUNTERS');
          changed = true;
        }
      }
    }

    if (changed) {
      this.onRoomChanged(room.code);
    }
  }

  updateLocation(
    socketId: string,
    payload: { lat: number; lng: number; accuracy: number; isGpsPing?: boolean }
  ): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (!isValidLatLng(payload.lat, payload.lng)) {
      return { ok: false, error: 'Invalid coordinates.' };
    }

    const now = Date.now();
    // Rate-limit normal location ticks to max 1 per 1.2s (allow immediate explicit GPS ping)
    if (!payload.isGpsPing && now - player.lastLocationEventAt < 1200) {
      return { ok: true };
    }
    player.lastLocationEventAt = now;

    const accuracy =
      typeof payload.accuracy === 'number' && Number.isFinite(payload.accuracy)
        ? Math.max(1, Math.min(5000, Math.round(payload.accuracy)))
        : 50;

    player.lastLocation = {
      lat: payload.lat,
      lng: payload.lng,
      accuracy,
      timestamp: now,
    };
    room.lastActivityAt = now;

    let changed = false;

    // Hunters share live location with teammates
    if (player.role === 'HUNTER' && (room.phase === 'HEADSTART' || room.phase === 'ACTIVE')) {
      changed = true;
    }

    // Boundary check for ALIVE runners during HEADSTART and ACTIVE
    if (
      player.role === 'RUNNER' &&
      player.status === 'ALIVE' &&
      (room.phase === 'HEADSTART' || room.phase === 'ACTIVE') &&
      room.settings.boundary.type !== 'NONE' &&
      accuracy <= MAX_GPS_ACCURACY_FOR_ELIMINATION_M
    ) {
      const check = evaluateBoundary({ lat: payload.lat, lng: payload.lng }, room.settings.boundary);
      if (!check.inside) {
        if (room.settings.boundaryGraceSec === 0) {
          this.eliminatePlayer(room, player, 'OUT_OF_BOUNDS', false);
          changed = true;
        } else if (player.outOfBoundsSince === undefined) {
          player.outOfBoundsSince = now;
          changed = true;
        }
      } else if (player.outOfBoundsSince !== undefined) {
        player.outOfBoundsSince = undefined;
        changed = true;
      }
    }

    // Handle explicit GPS ping response in GPS mode
    if (
      room.phase === 'ACTIVE' &&
      room.settings.mode === 'GPS' &&
      player.role === 'RUNNER' &&
      player.status === 'ALIVE' &&
      room.pingRound > 0 &&
      player.pingSubmittedRound !== room.pingRound &&
      (payload.isGpsPing || player.pendingPing !== undefined)
    ) {
      room.gpsPings.unshift({
        id: crypto.randomBytes(6).toString('hex'),
        round: room.pingRound,
        playerId: player.id,
        playerName: player.name,
        lat: payload.lat,
        lng: payload.lng,
        accuracy,
        createdAt: now,
      });
      if (room.gpsPings.length > 100) {
        room.gpsPings.length = 100;
      }
      player.pingSubmittedRound = room.pingRound;
      player.pendingPing = undefined;
      this.addEvent(room, 'GPS_SENT', `${player.name}'s GPS spot dropped (Ping #${room.pingRound})`);
      changed = true;
    }

    if (changed) {
      this.onRoomChanged(room.code);
    }
    return { ok: true };
  }

  async submitVideoPing(params: {
    roomCode: string;
    playerId: string;
    sessionToken: string;
    pingRound: number;
    challengeCode: string;
    durationMs: number;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ ok: true; item: VideoPingItem } | { ok: false; error: string; status: number }> {
    const room = this.rooms.get(params.roomCode.trim().toUpperCase());
    if (!room) return { ok: false, error: 'Room not found.', status: 404 };

    const player = room.players.find(
      (p) => p.id === params.playerId && p.sessionToken === params.sessionToken
    );
    if (!player) return { ok: false, error: 'Unauthorized player.', status: 401 };

    if (room.phase !== 'ACTIVE' || room.settings.mode !== 'VIDEO') {
      return { ok: false, error: 'Video pings are not active.', status: 400 };
    }

    if (player.role !== 'RUNNER' || player.status !== 'ALIVE') {
      return { ok: false, error: 'Only alive runners submit video pings.', status: 403 };
    }

    if (!player.pendingPing || player.pendingPing.round !== params.pingRound) {
      return { ok: false, error: 'No matching video ping is currently due.', status: 409 };
    }

    if (player.pendingPing.challengeCode !== params.challengeCode.trim()) {
      return { ok: false, error: 'Live verification code mismatch.', status: 400 };
    }

    if (params.durationMs < 1500) {
      return { ok: false, error: 'Video too short (record at least 2 seconds).', status: 400 };
    }

    const stored = await this.videoStore.saveVideo(room.code, params.buffer, params.mimeType);

    const item: VideoPingItem = {
      id: stored.id,
      round: params.pingRound,
      playerId: player.id,
      playerName: player.name,
      createdAt: stored.createdAt,
      durationMs: Math.min(20_000, Math.round(params.durationMs)),
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      url: `/api/videos/${stored.id}`,
      challengeCode: player.pendingPing.challengeCode,
    };

    room.videoPings.unshift(item);
    player.pendingPing = undefined;
    player.pingSubmittedRound = params.pingRound;
    room.lastActivityAt = Date.now();

    this.addEvent(room, 'VIDEO_SENT', `${player.name} sent 360° video (Ping #${params.pingRound})`);
    this.onRoomChanged(room.code);
    return { ok: true, item };
  }

  markSelfCaught(socketId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (room.phase !== 'ACTIVE') return { ok: false, error: 'Match is not active.' };
    if (player.role !== 'RUNNER' || player.status !== 'ALIVE') {
      return { ok: false, error: 'Only alive runners can be marked caught.' };
    }

    this.eliminatePlayer(room, player, 'CAUGHT');
    return { ok: true };
  }

  claimTag(socketId: string, targetRunnerId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (room.phase !== 'ACTIVE') return { ok: false, error: 'Match is not active.' };
    if (player.role !== 'HUNTER' && !player.isHost) {
      return { ok: false, error: 'Only hunters or host can tag runners.' };
    }

    const target = room.players.find((p) => p.id === targetRunnerId);
    if (!target || target.role !== 'RUNNER' || target.status !== 'ALIVE') {
      return { ok: false, error: 'Target runner is not alive.' };
    }

    target.pendingTagClaim = {
      byHunterId: player.id,
      byHunterName: player.name,
      expiresAt: Date.now() + TAG_CLAIM_DURATION_MS,
    };
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  respondTagClaim(socketId: string, accept: boolean): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (!player.pendingTagClaim) return { ok: false, error: 'No pending tag claim.' };
    const claim = player.pendingTagClaim;
    player.pendingTagClaim = undefined;

    if (accept) {
      this.eliminatePlayer(room, player, 'CAUGHT');
    } else {
      this.addEvent(room, 'SYSTEM', `${player.name} disputed tag claim by ${claim.byHunterName}`);
      this.onRoomChanged(room.code);
    }
    return { ok: true };
  }

  hostForceEliminate(socketId: string, targetPlayerId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only host can force-eliminate.' };
    if (room.phase !== 'ACTIVE') return { ok: false, error: 'Match is not active.' };

    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!target || target.role !== 'RUNNER' || target.status !== 'ALIVE') {
      return { ok: false, error: 'Runner not found or already eliminated.' };
    }

    this.eliminatePlayer(room, target, 'CAUGHT');
    return { ok: true };
  }

  endGameEarly(socketId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only host can end the match.' };
    if (room.phase !== 'HEADSTART' && room.phase !== 'ACTIVE') {
      return { ok: false, error: 'No active match to end.' };
    }

    const aliveRunners = room.players.filter((p) => p.role === 'RUNNER' && p.status === 'ALIVE');
    this.finishGame(room, aliveRunners.length > 0 ? 'RUNNERS' : 'HUNTERS');
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  resetToLobby(socketId: string): { ok: boolean; error?: string } {
    const ctx = this.getSessionRoom(socketId);
    if (!ctx) return { ok: false, error: 'Not in a room.' };
    const { room, player } = ctx;

    if (!player.isHost) return { ok: false, error: 'Only host can return to lobby.' };

    this.stopTick(room);
    room.phase = 'LOBBY';
    room.wheel = null;
    room.wheelSelectedIds = [];
    room.wheelAdvanceAt = null;
    room.headstartEndsAt = null;
    room.gameStartedAt = null;
    room.gameEndedAt = null;
    room.winnerSide = null;
    room.pingRound = 0;
    room.pingRoundStartedAt = null;
    room.gpsFallbackAppliedRound = 0;
    room.nextPingAt = null;
    room.videoPings = [];
    room.gpsPings = [];

    for (const p of room.players) {
      p.role = 'UNASSIGNED';
      p.status = 'ALIVE';
      p.eliminatedAt = undefined;
      p.eliminationReason = undefined;
      p.outOfBoundsSince = undefined;
      p.pendingPing = undefined;
      p.pingSubmittedRound = undefined;
      p.pendingTagClaim = undefined;
    }

    // Remove disconnected players when cycling back to lobby
    room.players = room.players.filter((p) => p.connected);
    if (!room.players.some((p) => p.isHost) && room.players[0]) {
      room.players[0].isHost = true;
    }

    void this.videoStore.deleteRoomVideos(room.code);
    this.addEvent(room, 'SYSTEM', 'Returned to lobby for a new round');
    this.onRoomChanged(room.code);
    return { ok: true };
  }

  private eliminatePlayer(
    room: InternalRoom,
    target: InternalPlayer,
    reason: EliminationReason,
    emitNow = true
  ): void {
    if (target.status === 'ELIMINATED') return;
    target.status = 'ELIMINATED';
    target.eliminatedAt = Date.now();
    target.eliminationReason = reason;
    target.outOfBoundsSince = undefined;
    target.pendingPing = undefined;
    target.pendingTagClaim = undefined;

    const reasonText: Record<EliminationReason, string> = {
      CAUGHT: 'was caught!',
      OUT_OF_BOUNDS: 'stepped out of bounds and was eliminated!',
      MISSED_VIDEO_PING: 'missed the 360° video deadline and was eliminated!',
      FORFEIT: 'forfeited the match.',
    };

    this.addEvent(room, 'ELIMINATION', `${target.name} ${reasonText[reason]}`);

    const aliveRunners = room.players.filter((p) => p.role === 'RUNNER' && p.status === 'ALIVE');
    if (aliveRunners.length === 0 && room.phase === 'ACTIVE') {
      this.finishGame(room, 'HUNTERS');
    }

    if (emitNow) {
      this.onRoomChanged(room.code);
    }
  }

  private finishGame(room: InternalRoom, winner: 'HUNTERS' | 'RUNNERS'): void {
    this.stopTick(room);
    room.phase = 'ENDED';
    room.gameEndedAt = Date.now();
    room.winnerSide = winner;
    room.nextPingAt = null;
    for (const p of room.players) {
      p.pendingPing = undefined;
      p.outOfBoundsSince = undefined;
      p.pendingTagClaim = undefined;
    }

    // If keepVideos is OFF, immediately purge clips on match end
    if (!room.settings.keepVideos && room.videoPings.length > 0) {
      room.videoPings = [];
      void this.videoStore.deleteRoomVideos(room.code);
    }

    this.addEvent(
      room,
      'PHASE',
      winner === 'HUNTERS' ? 'MATCH OVER — All runners eliminated! Hunters win!' : 'MATCH OVER — Runners survived!'
    );
  }

  private getSessionRoom(socketId: string): { room: InternalRoom; player: InternalPlayer } | null {
    const session = this.socketToSession.get(socketId);
    if (!session) return null;
    const room = this.rooms.get(session.roomCode);
    if (!room) return null;
    const player = room.players.find((p) => p.id === session.playerId);
    if (!player) return null;
    return { room, player };
  }

  getRoomSockets(roomCode: string): Array<{ socketId: string; playerId: string }> {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    const list: Array<{ socketId: string; playerId: string }> = [];
    for (const p of room.players) {
      if (p.socketId) {
        list.push({ socketId: p.socketId, playerId: p.id });
      }
    }
    return list;
  }

  buildSnapshotFor(roomCode: string, viewerId: string): RoomSnapshot | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const viewer = room.players.find((p) => p.id === viewerId);
    const canSeeHunterLocations =
      room.phase === 'ENDED' ||
      viewer?.role === 'HUNTER' ||
      viewer?.status === 'ELIMINATED';

    const players: PublicPlayer[] = room.players.map((p) => {
      const pub: PublicPlayer = {
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        role: p.role,
        status: p.status,
        eliminatedAt: p.eliminatedAt,
        eliminationReason: p.eliminationReason,
        outOfBoundsSince: p.outOfBoundsSince,
        pingSubmittedRound: p.pingSubmittedRound,
        pendingTagClaim: p.id === viewerId || viewer?.role === 'HUNTER' || viewer?.isHost ? p.pendingTagClaim : undefined,
      };

      if (canSeeHunterLocations && p.role === 'HUNTER' && p.lastLocation) {
        pub.hunterLocation = p.lastLocation;
      }

      if (p.pendingPing) {
        pub.pendingPing = {
          round: p.pendingPing.round,
          deadlineAt: p.pendingPing.deadlineAt,
          // Only reveal live challenge code to the runner who must record it
          challengeCode: p.id === viewerId ? p.pendingPing.challengeCode : undefined,
        };
      }

      return pub;
    });

    return {
      code: room.code,
      serverNow: Date.now(),
      phase: room.phase,
      settings: room.settings,
      players,
      meId: viewerId,
      wheel: room.wheel,
      headstartEndsAt: room.headstartEndsAt,
      gameStartedAt: room.gameStartedAt,
      gameEndedAt: room.gameEndedAt,
      winnerSide: room.winnerSide,
      pingRound: room.pingRound,
      nextPingAt: room.nextPingAt,
      videoPings: room.videoPings,
      gpsPings: room.gpsPings,
      events: room.events,
    };
  }

  private async purgeStaleRooms(): Promise<void> {
    const cutoff = Date.now() - ROOM_IDLE_TTL_MS;
    for (const [code, room] of this.rooms.entries()) {
      const anyConnected = room.players.some((p) => p.connected);
      if (room.lastActivityAt < cutoff && !anyConnected) {
        this.stopTick(room);
        this.rooms.delete(code);
        await this.videoStore.deleteRoomVideos(code);
      }
    }
  }
}
