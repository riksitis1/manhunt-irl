import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  Camera,
  Check,
  Crosshair,
  Flag,
  Map as MapIcon,
  MapPin,
  Radio,
  ShieldAlert,
  Skull,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { GeoPoint, RoomSnapshot } from '@shared/types';
import { BoundaryMap } from '../components/BoundaryMap';
import { LiveVideoRecorder } from '../components/LiveVideoRecorder';
import { VideoCard } from '../components/VideoCard';
import { useAdaptiveGps } from '../hooks/useAdaptiveGps';
import { useWakeLock } from '../hooks/useWakeLock';
import { formatCountdown, formatTimeAgo, vibrate } from '../lib/geo';

interface GameViewProps {
  room: RoomSnapshot;
  sessionToken: string;
  clockOffsetMs: number;
  onLocationUpdate: (point: GeoPoint, isGpsPing: boolean) => void;
  onSelfCaught: () => void;
  onClaimTag: (targetPlayerId: string) => void;
  onRespondTag: (accept: boolean) => void;
  onHostEliminate: (targetPlayerId: string) => void;
  onEndGame: () => void;
}

type TabId = 'MAP' | 'INTEL' | 'SQUAD';

export function GameView({
  room,
  sessionToken,
  clockOffsetMs,
  onLocationUpdate,
  onSelfCaught,
  onClaimTag,
  onRespondTag,
  onHostEliminate,
  onEndGame,
}: GameViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('MAP');
  const [batterySaver, setBatterySaver] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [confirmSelfCaught, setConfirmSelfCaught] = useState(false);
  const [confirmEndGame, setConfirmEndGame] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);
  const [seenIntelCount, setSeenIntelCount] = useState(0);

  const me = room.players.find((p) => p.id === room.meId);
  const isHost = Boolean(me?.isHost);
  const isHunter = me?.role === 'HUNTER';
  const isRunner = me?.role === 'RUNNER';
  const isAlive = me?.status === 'ALIVE';
  const isHeadstart = room.phase === 'HEADSTART';

  // 1-second synced clock ticker
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now() + clockOffsetMs);
    }, 1000);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  // Keep screen awake during active game unless Battery Saver is enabled
  const { isAwake } = useWakeLock(
    (room.phase === 'HEADSTART' || room.phase === 'ACTIVE') && !batterySaver
  );

  // Trigger fresh GPS ping whenever a new GPS ping round opens for an alive runner
  const gpsPingKey =
    room.settings.mode === 'GPS' && isRunner && isAlive && me?.pendingPing
      ? me.pendingPing.round
      : 0;

  const handleGpsFix = useCallback(
    (pt: GeoPoint, isForced: boolean) => {
      onLocationUpdate(pt, isForced);
    },
    [onLocationUpdate]
  );

  const gpsEnabled =
    (room.phase === 'HEADSTART' || room.phase === 'ACTIVE') && (isHunter || (isRunner && isAlive));

  const gps = useAdaptiveGps({
    enabled: gpsEnabled,
    boundary: room.settings.boundary,
    batterySaver,
    forcePingKey: gpsPingKey,
    onFix: handleGpsFix,
  });

  // Haptic alerts on phase change, video ping due, or boundary breach
  const prevPhaseRef = useRef(room.phase);
  const prevPingRoundRef = useRef<number>(0);
  const prevOobRef = useRef<boolean>(false);

  useEffect(() => {
    if (prevPhaseRef.current === 'HEADSTART' && room.phase === 'ACTIVE') {
      vibrate([120, 60, 120, 60, 200]);
    }
    prevPhaseRef.current = room.phase;
  }, [room.phase]);

  useEffect(() => {
    const round = me?.pendingPing?.round ?? 0;
    if (round > 0 && round !== prevPingRoundRef.current && room.settings.mode === 'VIDEO') {
      vibrate([180, 80, 180]);
    }
    prevPingRoundRef.current = round;
  }, [me?.pendingPing?.round, room.settings.mode]);

  useEffect(() => {
    const isOob = me?.outOfBoundsSince !== undefined;
    if (isOob && !prevOobRef.current) {
      vibrate([250, 100, 250]);
    }
    prevOobRef.current = isOob;
  }, [me?.outOfBoundsSince]);

  // Unread intel badge tracking
  const totalIntel =
    room.settings.mode === 'VIDEO' ? room.videoPings.length : room.gpsPings.length;

  useEffect(() => {
    if (activeTab === 'INTEL') {
      setSeenIntelCount(totalIntel);
    }
  }, [activeTab, totalIntel]);

  const unreadIntel = activeTab === 'INTEL' ? 0 : Math.max(0, totalIntel - seenIntelCount);

  const hunters = useMemo(
    () => room.players.filter((p) => p.role === 'HUNTER'),
    [room.players]
  );
  const runners = useMemo(
    () => room.players.filter((p) => p.role === 'RUNNER'),
    [room.players]
  );
  const aliveRunnersCount = runners.filter((p) => p.status === 'ALIVE').length;

  const headstartRemainingMs = room.headstartEndsAt ? Math.max(0, room.headstartEndsAt - nowMs) : 0;
  const nextPingRemainingMs = room.nextPingAt ? Math.max(0, room.nextPingAt - nowMs) : 0;

  const oobRemainingMs =
    me?.outOfBoundsSince !== undefined
      ? Math.max(0, me.outOfBoundsSince + room.settings.boundaryGraceSec * 1000 - nowMs)
      : null;

  const videoPingDue =
    room.phase === 'ACTIVE' &&
    room.settings.mode === 'VIDEO' &&
    isRunner &&
    isAlive &&
    me?.pendingPing !== undefined;

  const videoDeadlineMs =
    videoPingDue && me?.pendingPing ? Math.max(0, me.pendingPing.deadlineAt - nowMs) : 0;

  const gpsPingDue =
    room.phase === 'ACTIVE' &&
    room.settings.mode === 'GPS' &&
    isRunner &&
    isAlive &&
    me?.pendingPing !== undefined;

  const roleBadgeClass = !isAlive
    ? 'border-slate-600 bg-slate-800 text-slate-300'
    : isHunter
      ? 'border-red-500/50 bg-red-500/20 text-red-300'
      : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300';

  const roleText = !isAlive ? 'ELIMINATED' : isHunter ? 'MANHUNTER' : 'RUNNER';

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col bg-obsidian">
      {/* Top Tactical Status Header */}
      <header className="shrink-0 border-b border-borderSubtle bg-surface px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`rounded-lg border px-2 py-0.5 text-[11px] font-black tracking-wider ${roleBadgeClass}`}
            >
              {roleText}
            </span>
            <span className="font-mono text-xs font-bold text-slate-400">
              {aliveRunnersCount}/{runners.length} alive
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBatterySaver((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                batterySaver
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-borderSubtle bg-obsidian text-slate-400'
              }`}
              title="Toggle Battery Saver (reduces GPS polling & releases screen wake lock)"
            >
              <BatteryCharging className="h-3.5 w-3.5" />
              {batterySaver ? 'Eco ON' : isAwake ? 'Awake' : 'Eco'}
            </button>

            <div className="rounded-lg border border-borderSubtle bg-obsidian px-2.5 py-1 text-right">
              <p className="text-[9px] font-bold uppercase leading-none text-slate-400">
                {isHeadstart ? 'Headstart' : room.settings.mode === 'VIDEO' ? 'Next 360°' : 'Next GPS'}
              </p>
              <p
                className={`mt-0.5 font-mono text-xs font-black leading-none ${
                  isHeadstart ? 'text-amber-400' : 'text-white'
                }`}
              >
                {isHeadstart ? formatCountdown(headstartRemainingMs) : formatCountdown(nextPingRemainingMs)}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Urgent Action Banners */}
      <div className="shrink-0 space-y-2 px-3 pt-2 empty:hidden">
        {/* Out of bounds emergency countdown */}
        {oobRemainingMs !== null && isRunner && isAlive && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-500 bg-red-600/25 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 animate-bounce text-red-400" />
              <div>
                <p className="text-xs font-black uppercase text-red-200">OUT OF BOUNDS!</p>
                <p className="text-[11px] text-red-100">Step back inside the block border now.</p>
              </div>
            </div>
            <span className="rounded-xl bg-red-600 px-2.5 py-1 font-mono text-base font-black text-white">
              {Math.ceil(oobRemainingMs / 1000)}s
            </span>
          </div>
        )}

        {/* Video ping due alert */}
        {videoPingDue && me?.pendingPing && (
          <div className="rounded-2xl border border-amber-500/70 bg-amber-500/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-amber-300">
                  360° Video Ping #{me.pendingPing.round} Required
                </p>
                <p className="text-[11px] text-amber-100/90">
                  Miss deadline = auto-eliminated · Code{' '}
                  <span className="font-mono font-black text-white">
                    {me.pendingPing.challengeCode}
                  </span>
                </p>
              </div>
              <span className="rounded-lg bg-red-600 px-2 py-1 font-mono text-sm font-black text-white">
                {formatCountdown(videoDeadlineMs)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRecorderOpen(true)}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-xs font-black uppercase tracking-wide text-slate-950 shadow-lg active:scale-[0.98]"
            >
              <Camera className="h-4 w-4" />
              Record Live 360° Video Now
            </button>
          </div>
        )}

        {/* GPS ping manual trigger fallback */}
        {gpsPingDue && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-red-500/50 bg-red-500/15 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 animate-pulse text-red-400" />
              <span className="text-xs font-bold text-red-200">
                GPS Ping #{room.pingRound} — acquiring spot...
              </span>
            </div>
            <button
              type="button"
              onClick={() => gps.triggerFreshFix(true)}
              className="rounded-lg bg-red-500 px-2.5 py-1 text-[11px] font-black text-white"
            >
              Send Now
            </button>
          </div>
        )}

        {/* Pending Tag Claim confirmation */}
        {me?.pendingTagClaim && isAlive && (
          <div className="rounded-2xl border border-red-500/60 bg-surfaceElevated p-3">
            <p className="text-xs font-bold text-white">
              <span className="text-red-400">{me.pendingTagClaim.byHunterName}</span> claims they
              tagged you!
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onRespondTag(true)}
                className="flex items-center justify-center gap-1 rounded-xl bg-red-600 py-2 text-xs font-black text-white"
              >
                <Check className="h-3.5 w-3.5" />
                Confirm Caught
              </button>
              <button
                type="button"
                onClick={() => onRespondTag(false)}
                className="flex items-center justify-center gap-1 rounded-xl border border-borderSubtle bg-obsidian py-2 text-xs font-bold text-slate-300"
              >
                <X className="h-3.5 w-3.5" />
                Not Tagged
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-3 py-3">
        {activeTab === 'MAP' && (
          <div className="space-y-3">
            {/* Hunter Headstart Lock Card */}
            {isHeadstart && isHunter && (
              <div className="rounded-3xl border border-red-500/40 bg-gradient-to-b from-red-500/20 to-surface p-5 text-center">
                <p className="text-xs font-black uppercase tracking-widest text-red-400">
                  Hold Position — Headstart Active
                </p>
                <p className="mt-1 font-mono text-5xl font-black tracking-tight text-white">
                  {formatCountdown(headstartRemainingMs)}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Wait until the timer hits 00:00 before hunting!
                </p>
              </div>
            )}

            {/* Runner Headstart Card */}
            {isHeadstart && isRunner && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/12 px-4 py-3 text-center">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-300">
                  Runners Scatter! · {formatCountdown(headstartRemainingMs)} left
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-100/80">
                  Stay inside the green block boundary.
                </p>
              </div>
            )}

            <BoundaryMap
              boundary={room.settings.boundary}
              editable={false}
              myLocation={gps.location}
              isOutOfBounds={me?.outOfBoundsSince !== undefined || !gps.insideBoundary}
              hunters={isHunter || !isAlive ? hunters.filter((h) => h.id !== room.meId) : []}
              gpsPings={room.settings.mode === 'GPS' ? room.gpsPings : []}
              nowMs={nowMs}
              heightClass="h-[52vh] min-h-[290px]"
            />

            {/* Compact GPS & Border Status Bar */}
            <div className="flex items-center justify-between rounded-2xl border border-borderSubtle bg-surface px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Crosshair
                  className={`h-4 w-4 ${
                    gps.status === 'LOCKED'
                      ? 'text-emerald-400'
                      : gps.status === 'WEAK'
                        ? 'text-amber-400'
                        : gps.status === 'ERROR'
                          ? 'text-red-400'
                          : 'text-slate-400'
                  }`}
                />
                <span className="font-semibold text-slate-200">
                  {gps.status === 'LOCKED' && gps.location
                    ? `GPS ±${gps.location.accuracy}m`
                    : gps.status === 'WEAK' && gps.location
                      ? `Weak GPS ±${gps.location.accuracy}m`
                      : gps.status === 'LOCATING'
                        ? 'Acquiring GPS...'
                        : gps.status === 'ERROR'
                          ? 'GPS Error'
                          : 'GPS Idle'}
                </span>
              </div>

              {room.settings.boundary.type !== 'NONE' && isRunner && isAlive && (
                <span
                  className={`font-mono text-xs font-bold ${
                    gps.insideBoundary ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {Number.isFinite(gps.signedDistanceMeters)
                    ? gps.insideBoundary
                      ? `${Math.round(gps.signedDistanceMeters)}m inside border`
                      : `${Math.round(Math.abs(gps.signedDistanceMeters))}m OUTSIDE`
                    : 'Inside'}
                </span>
              )}
            </div>

            {gps.error && (
              <div className="flex items-center gap-2 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-200">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                {gps.error}
              </div>
            )}

            {/* Latest event ticker */}
            {room.events[0] && (
              <div className="rounded-2xl border border-borderSubtle/70 bg-surface/70 px-3.5 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Latest Update
                </p>
                <p className="mt-0.5 text-xs font-semibold text-slate-200">
                  {room.events[0].message}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'INTEL' && (
          <div className="space-y-3">
            {room.settings.mode === 'VIDEO' ? (
              <>
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Live 360° Video Pings ({room.videoPings.length})
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {room.settings.keepVideos ? 'Saved in session' : 'Auto-clears each round'}
                  </span>
                </div>

                {room.videoPings.length === 0 ? (
                  <div className="rounded-3xl border border-borderSubtle bg-surface p-8 text-center">
                    <Video className="mx-auto h-8 w-8 text-slate-600" />
                    <p className="mt-2 text-sm font-bold text-slate-300">No 360° Pings Yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Next ping triggers in{' '}
                      <span className="font-mono font-bold text-amber-400">
                        {formatCountdown(nextPingRemainingMs)}
                      </span>
                    </p>
                  </div>
                ) : (
                  room.videoPings.map((item) => (
                    <VideoCard
                      key={item.id}
                      item={item}
                      nowMs={nowMs}
                      allowDownload={room.settings.keepVideos}
                    />
                  ))
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    GPS Spot Pings ({room.gpsPings.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('MAP')}
                    className="text-xs font-bold text-emerald-400"
                  >
                    View on Map →
                  </button>
                </div>

                {room.gpsPings.length === 0 ? (
                  <div className="rounded-3xl border border-borderSubtle bg-surface p-8 text-center">
                    <MapPin className="mx-auto h-8 w-8 text-slate-600" />
                    <p className="mt-2 text-sm font-bold text-slate-300">No GPS Pings Yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      First spot drops in{' '}
                      <span className="font-mono font-bold text-red-400">
                        {formatCountdown(nextPingRemainingMs)}
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {room.gpsPings.map((ping) => (
                      <button
                        key={ping.id}
                        type="button"
                        onClick={() => setActiveTab('MAP')}
                        className="flex w-full items-center justify-between rounded-2xl border border-borderSubtle bg-surface px-3.5 py-3 text-left active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
                            <MapPin className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white">{ping.playerName}</p>
                            <p className="text-[11px] text-slate-400">
                              Ping #{ping.round} · ±{ping.accuracy}m
                              {ping.isFallbackLastKnown ? ' · Last known' : ''}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-xs text-slate-400">
                          {formatTimeAgo(ping.createdAt, nowMs)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Match Log */}
            <div className="pt-2">
              <h4 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Match Log
              </h4>
              <div className="space-y-1.5 rounded-2xl border border-borderSubtle bg-surface p-3">
                {room.events.slice(0, 12).map((ev) => (
                  <div key={ev.id} className="flex items-start justify-between gap-2 text-xs">
                    <span
                      className={
                        ev.type === 'ELIMINATION'
                          ? 'font-bold text-red-400'
                          : ev.type === 'PING_ROUND'
                            ? 'font-semibold text-amber-300'
                            : 'text-slate-300'
                      }
                    >
                      {ev.message}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">
                      {formatTimeAgo(ev.timestamp, nowMs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'SQUAD' && (
          <div className="space-y-4">
            {/* Runner Self-Caught Action */}
            {isRunner && isAlive && room.phase === 'ACTIVE' && (
              <div className="rounded-3xl border border-red-500/35 bg-red-500/10 p-4">
                {!confirmSelfCaught ? (
                  <button
                    type="button"
                    onClick={() => setConfirmSelfCaught(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-3.5 text-sm font-black uppercase tracking-wide text-white active:scale-[0.98]"
                  >
                    <Skull className="h-4 w-4" />
                    I Was Caught
                  </button>
                ) : (
                  <div className="space-y-2.5 text-center">
                    <p className="text-xs font-bold text-red-200">
                      Confirm you were tagged by a hunter?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmSelfCaught(false)}
                        className="rounded-xl border border-borderSubtle bg-obsidian py-2.5 text-xs font-bold text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmSelfCaught(false);
                          onSelfCaught();
                        }}
                        className="rounded-xl bg-red-600 py-2.5 text-xs font-black text-white"
                      >
                        Yes, Eliminated
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hunters List */}
            <div>
              <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-red-400">
                Manhunters ({hunters.length})
              </h3>
              <div className="space-y-2">
                {hunters.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-2xl border border-red-500/25 bg-surface px-3.5 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          p.connected ? 'bg-red-500' : 'bg-slate-600'
                        }`}
                      />
                      <span className="text-sm font-bold text-white">
                        {p.name}
                        {p.id === room.meId ? ' (You)' : ''}
                      </span>
                    </div>
                    <span className="text-[11px] font-bold uppercase text-red-400">Hunting</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Runners List */}
            <div>
              <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-emerald-400">
                Runners ({aliveRunnersCount} Alive / {runners.length} Total)
              </h3>
              <div className="space-y-2">
                {runners.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 ${
                      p.status === 'ALIVE'
                        ? 'border-borderSubtle bg-surface'
                        : 'border-borderSubtle/50 bg-surface/40 opacity-65'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            p.status === 'ELIMINATED'
                              ? 'bg-slate-600'
                              : p.outOfBoundsSince
                                ? 'bg-red-500 animate-ping'
                                : 'bg-emerald-400'
                          }`}
                        />
                        <span className="truncate text-sm font-bold text-white">
                          {p.name}
                          {p.id === room.meId ? ' (You)' : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {p.status === 'ELIMINATED'
                          ? p.eliminationReason === 'OUT_OF_BOUNDS'
                            ? 'Eliminated: Out of Bounds'
                            : p.eliminationReason === 'MISSED_VIDEO_PING'
                              ? 'Eliminated: Missed Video'
                              : p.eliminationReason === 'FORFEIT'
                                ? 'Forfeited'
                                : 'Caught by Hunter'
                          : p.pendingPing
                            ? room.settings.mode === 'VIDEO'
                              ? `Video due (${formatCountdown(p.pendingPing.deadlineAt - nowMs)})`
                              : 'GPS ping pending...'
                            : 'Active'}
                      </p>
                    </div>

                    {p.status === 'ALIVE' && room.phase === 'ACTIVE' && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isHunter && (
                          <button
                            type="button"
                            disabled={Boolean(p.pendingTagClaim)}
                            onClick={() => onClaimTag(p.id)}
                            className="rounded-xl border border-red-500/40 bg-red-500/15 px-2.5 py-1.5 text-[11px] font-bold text-red-300 disabled:opacity-50"
                          >
                            {p.pendingTagClaim ? 'Pending...' : 'Tag'}
                          </button>
                        )}
                        {isHost && p.id !== room.meId && (
                          <button
                            type="button"
                            onClick={() => onHostEliminate(p.id)}
                            className="rounded-xl border border-borderSubtle bg-obsidian px-2.5 py-1.5 text-[11px] font-bold text-slate-300"
                            title="Host override: mark caught"
                          >
                            Out
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Host End Match */}
            {isHost && (
              <div className="pt-2">
                {!confirmEndGame ? (
                  <button
                    type="button"
                    onClick={() => setConfirmEndGame(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-borderSubtle bg-surface py-3 text-xs font-bold text-slate-400 hover:text-white"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    End Match Now (Host)
                  </button>
                ) : (
                  <div className="rounded-2xl border border-borderSubtle bg-surface p-3 text-center">
                    <p className="text-xs font-bold text-slate-200">
                      End match early? Surviving runners win.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmEndGame(false)}
                        className="rounded-xl border border-borderSubtle bg-obsidian py-2 text-xs font-bold text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmEndGame(false);
                          onEndGame();
                        }}
                        className="rounded-xl bg-amber-500 py-2 text-xs font-black text-slate-950"
                      >
                        End Match
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Mobile Navigation */}
      <nav className="safe-bottom shrink-0 border-t border-borderSubtle bg-surface/95 px-3 pt-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('MAP')}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold transition ${
              activeTab === 'MAP' ? 'bg-surfaceElevated text-emerald-400' : 'text-slate-400'
            }`}
          >
            <MapIcon className="h-5 w-5" />
            Map
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('INTEL')}
            className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold transition ${
              activeTab === 'INTEL' ? 'bg-surfaceElevated text-amber-400' : 'text-slate-400'
            }`}
          >
            {room.settings.mode === 'VIDEO' ? (
              <Video className="h-5 w-5" />
            ) : (
              <MapPin className="h-5 w-5" />
            )}
            Intel
            {unreadIntel > 0 && (
              <span className="absolute right-6 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                {unreadIntel}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SQUAD')}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-bold transition ${
              activeTab === 'SQUAD' ? 'bg-surfaceElevated text-white' : 'text-slate-400'
            }`}
          >
            <Users className="h-5 w-5" />
            Players
          </button>
        </div>
      </nav>

      {/* Fullscreen Live-Only 360 Video Recorder Modal */}
      {recorderOpen && videoPingDue && me?.pendingPing && me.pendingPing.challengeCode && (
        <LiveVideoRecorder
          roomCode={room.code}
          playerId={room.meId}
          sessionToken={sessionToken}
          pingRound={me.pendingPing.round}
          challengeCode={me.pendingPing.challengeCode}
          deadlineAt={me.pendingPing.deadlineAt}
          maxDurationSec={room.settings.videoMaxDurationSec}
          clockOffsetMs={clockOffsetMs}
          onSuccess={() => setRecorderOpen(false)}
          onClose={() => setRecorderOpen(false)}
        />
      )}
    </div>
  );
}
