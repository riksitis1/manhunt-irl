import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  Crosshair,
  Crown,
  Eye,
  LogOut,
  MapPin,
  Minus,
  Play,
  Plus,
  Share2,
  ShieldAlert,
  UserX,
  Users,
  Video,
} from 'lucide-react';
import type { GeoPoint, RoomSettings, RoomSnapshot } from '@shared/types';
import { BoundaryMap } from '../components/BoundaryMap';
import {
  getNotificationPermission,
  requestNotificationPermission,
  unlockAudio,
} from '../lib/alerts';
import { formatDurationShort } from '../lib/geo';
import { unlockRadioAudio } from '../lib/radioAudio';

interface LobbyViewProps {
  room: RoomSnapshot;
  error: string | null;
  onLocationUpdate: (point: GeoPoint, isGpsPing: boolean) => void;
  onUpdateSettings: (patch: Partial<RoomSettings>) => void;
  onKickPlayer: (playerId: string) => void;
  onStartGame: () => void;
  onLeave: () => void;
}

const HEADSTART_OPTIONS = [30, 60, 120, 180, 300];
const PING_INTERVAL_OPTIONS = [60, 120, 180, 300, 600];
const DEADLINE_OPTIONS = [60, 120, 180];
const CLIP_LEN_OPTIONS = [6, 10, 15];
const GRACE_OPTIONS = [0, 5, 10, 15];

export function LobbyView({
  room,
  error,
  onLocationUpdate,
  onUpdateSettings,
  onKickPlayer,
  onStartGame,
  onLeave,
}: LobbyViewProps) {
  const me = room.players.find((p) => p.id === room.meId);
  const isHost = Boolean(me?.isHost);
  const [copiedType, setCopiedType] = useState<'CODE' | 'LINK' | null>(null);
  const [notifPerm, setNotifPerm] = useState(() => getNotificationPermission());
  const [gpsChecking, setGpsChecking] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  const verifyGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsErr('GPS is not supported on this device.');
      return;
    }
    setGpsChecking(true);
    setGpsErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsChecking(false);
        onLocationUpdate(
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 50),
            timestamp: Date.now(),
          },
          false
        );
      },
      (err) => {
        setGpsChecking(false);
        setGpsErr(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enable GPS in browser settings — GPS is required to play.'
            : 'Could not lock GPS yet. Step near a window or outdoors and tap Retry.'
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5000 }
    );
  };

  // Auto-check GPS once if browser already granted permission
  useEffect(() => {
    if (me?.gpsReady) return;
    if ('permissions' in navigator && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'granted') {
            verifyGps();
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnableAlerts = async () => {
    unlockRadioAudio();
    const res = await requestNotificationPermission();
    setNotifPerm(res);
  };

  const shareUrl = `${window.location.origin}/?join=${room.code}`;
  const { settings } = room;

  const copyText = async (text: string, kind: 'CODE' | 'LINK') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(kind);
      window.setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Fallback
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join Manhunt IRL (${room.code})`,
          text: `Join my Manhunt lobby with code ${room.code}`,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled share
      }
    }
    void copyText(shareUrl, 'LINK');
  };

  const canStart = isHost && room.players.length >= 2;
  const effectiveHunters = Math.min(settings.hunterCount, Math.max(1, room.players.length - 1));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-28 pt-4">
      {/* Top Bar */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Lobby Room
          </p>
          <h2 className="text-lg font-black text-white">Pre-Game Setup</h2>
        </div>
        <div className="flex items-center gap-2">
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <button
              type="button"
              onClick={() => void handleEnableAlerts()}
              className="inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/15 px-2.5 py-2 text-xs font-bold text-amber-300 active:scale-95"
            >
              <Bell className="h-3.5 w-3.5" />
              Alerts
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="inline-flex items-center gap-1.5 rounded-xl border border-borderSubtle bg-surface px-3 py-2 text-xs font-bold text-slate-300 active:scale-95"
          >
            <LogOut className="h-3.5 w-3.5" />
            Leave
          </button>
        </div>
      </div>

      {/* Join Code Hero */}
      <div className="mb-4 rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/12 via-surface to-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
              Join Code
            </p>
            <p className="mt-0.5 font-mono text-4xl font-black tracking-[0.22em] text-white">
              {room.code}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void copyText(room.code, 'CODE')}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-borderSubtle bg-obsidian px-3 py-2 text-xs font-bold text-slate-200 active:scale-95"
            >
              {copiedType === 'CODE' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Code
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 active:scale-95"
            >
              {copiedType === 'LINK' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Link Copied
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  Invite Link
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mandatory GPS Readiness Check */}
      <div
        className={`mb-4 rounded-2xl border p-3.5 ${
          me?.gpsReady
            ? 'border-emerald-500/35 bg-emerald-500/10'
            : 'border-amber-500/45 bg-amber-500/12'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Crosshair
              className={`h-5 w-5 shrink-0 ${
                me?.gpsReady ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-white">
                {me?.gpsReady ? 'GPS Verified & Ready' : 'GPS Required To Play'}
              </p>
              <p className="text-[11px] text-slate-300">
                {me?.gpsReady
                  ? 'Your location is locked for boundary & hunt tracking.'
                  : 'All players must enable GPS before entering the match.'}
              </p>
            </div>
          </div>
          {!me?.gpsReady && (
            <button
              type="button"
              disabled={gpsChecking}
              onClick={verifyGps}
              className="shrink-0 rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950 active:scale-95 disabled:opacity-60"
            >
              {gpsChecking ? 'Locking...' : 'Enable GPS'}
            </button>
          )}
        </div>
        {gpsErr && <p className="mt-2 text-[11px] font-semibold text-red-300">{gpsErr}</p>}
      </div>

      {/* Players Roster */}
      <div className="mb-4 rounded-3xl border border-borderSubtle bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Players ({room.players.length} / {settings.maxPlayers})
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-400">
            {effectiveHunters} Hunter{effectiveHunters > 1 ? 's' : ''} ·{' '}
            {Math.max(0, room.players.length - effectiveHunters)} Runner
            {Math.max(0, room.players.length - effectiveHunters) === 1 ? '' : 's'}
          </span>
        </div>

        <div className="space-y-2">
          {room.players.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-2xl border border-borderSubtle/70 bg-obsidian px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    p.connected ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                <span className="truncate text-sm font-bold text-white">
                  {p.name}
                  {p.id === room.meId && (
                    <span className="ml-1.5 text-[11px] font-semibold text-slate-400">(You)</span>
                  )}
                </span>
                {p.isHost && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                    <Crown className="h-3 w-3" />
                    HOST
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    p.gpsReady
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {p.gpsReady ? 'GPS ✓' : 'No GPS'}
                </span>
                {isHost && !p.isHost && (
                  <button
                    type="button"
                    onClick={() => onKickPlayer(p.id)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                    title={`Kick ${p.name}`}
                  >
                    <UserX className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Host Game Rules & Settings */}
      <div className="mb-4 rounded-3xl border border-borderSubtle bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Match Rules
          </h3>
          {!isHost && (
            <span className="text-[11px] font-semibold text-slate-500">Host controls</span>
          )}
        </div>

        {/* Mode Toggle */}
        <div className="mb-4">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-400">Intel Ping Mode</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!isHost}
              onClick={() => onUpdateSettings({ mode: 'VIDEO' })}
              className={`flex flex-col items-start rounded-2xl border p-3 text-left transition ${
                settings.mode === 'VIDEO'
                  ? 'border-amber-500/60 bg-amber-500/12 text-white'
                  : 'border-borderSubtle bg-obsidian text-slate-400'
              } disabled:opacity-80`}
            >
              <Video className={`h-4 w-4 ${settings.mode === 'VIDEO' ? 'text-amber-400' : 'text-slate-500'}`} />
              <span className="mt-1.5 text-xs font-black">360° Live Video</span>
              <span className="mt-0.5 text-[10px] text-slate-400">
                Camera-only clip, no gallery
              </span>
            </button>

            <button
              type="button"
              disabled={!isHost}
              onClick={() => onUpdateSettings({ mode: 'GPS' })}
              className={`flex flex-col items-start rounded-2xl border p-3 text-left transition ${
                settings.mode === 'GPS'
                  ? 'border-red-500/60 bg-red-500/12 text-white'
                  : 'border-borderSubtle bg-obsidian text-slate-400'
              } disabled:opacity-80`}
            >
              <MapPin className={`h-4 w-4 ${settings.mode === 'GPS' ? 'text-red-400' : 'text-slate-500'}`} />
              <span className="mt-1.5 text-xs font-black">GPS Spot Ping</span>
              <span className="mt-0.5 text-[10px] text-slate-400">
                Drops last GPS pin on map
              </span>
            </button>
          </div>
        </div>

        {/* Max Players & Hunters Steppers */}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-borderSubtle bg-obsidian p-3">
            <p className="text-[11px] font-semibold text-slate-400">Max Players</p>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                disabled={!isHost || settings.maxPlayers <= Math.max(2, room.players.length)}
                onClick={() => onUpdateSettings({ maxPlayers: settings.maxPlayers - 1 })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-borderSubtle bg-surface text-white disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-lg font-black text-white">
                {settings.maxPlayers}
              </span>
              <button
                type="button"
                disabled={!isHost || settings.maxPlayers >= 20}
                onClick={() => onUpdateSettings({ maxPlayers: settings.maxPlayers + 1 })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-borderSubtle bg-surface text-white disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-borderSubtle bg-obsidian p-3">
            <p className="text-[11px] font-semibold text-slate-400">Manhunters</p>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                disabled={!isHost || settings.hunterCount <= 1}
                onClick={() => onUpdateSettings({ hunterCount: settings.hunterCount - 1 })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-borderSubtle bg-surface text-white disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-lg font-black text-red-400">
                {settings.hunterCount}
              </span>
              <button
                type="button"
                disabled={!isHost || settings.hunterCount >= settings.maxPlayers - 1}
                onClick={() => onUpdateSettings({ hunterCount: settings.hunterCount + 1 })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-borderSubtle bg-surface text-white disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Headstart */}
        <div className="mb-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">Headstart Time</span>
            <span className="font-mono text-xs font-bold text-emerald-400">
              {formatDurationShort(settings.headstartSec)}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {HEADSTART_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                disabled={!isHost}
                onClick={() => onUpdateSettings({ headstartSec: sec })}
                className={`rounded-xl py-2 font-mono text-xs font-bold transition ${
                  settings.headstartSec === sec
                    ? 'bg-emerald-500 text-slate-950'
                    : 'border border-borderSubtle bg-obsidian text-slate-300'
                } disabled:opacity-80`}
              >
                {formatDurationShort(sec)}
              </button>
            ))}
          </div>
        </div>

        {/* Ping Interval */}
        <div className="mb-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">
              {settings.mode === 'VIDEO' ? '360° Video Every' : 'GPS Spot Ping Every'}
            </span>
            <span className="font-mono text-xs font-bold text-amber-400">
              {formatDurationShort(settings.pingIntervalSec)}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PING_INTERVAL_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                disabled={!isHost}
                onClick={() => onUpdateSettings({ pingIntervalSec: sec })}
                className={`rounded-xl py-2 font-mono text-xs font-bold transition ${
                  settings.pingIntervalSec === sec
                    ? 'bg-amber-500 text-slate-950'
                    : 'border border-borderSubtle bg-obsidian text-slate-300'
                } disabled:opacity-80`}
              >
                {formatDurationShort(sec)}
              </button>
            ))}
          </div>
        </div>

        {/* Video-only settings */}
        {settings.mode === 'VIDEO' && (
          <div className="mb-3.5 space-y-3 rounded-2xl border border-amber-500/20 bg-obsidian/80 p-3">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">
                  Submit Deadline (Miss = Eliminated)
                </span>
                <span className="font-mono text-xs font-bold text-red-400">
                  {formatDurationShort(settings.videoDeadlineSec)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {DEADLINE_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={!isHost}
                    onClick={() => onUpdateSettings({ videoDeadlineSec: sec })}
                    className={`rounded-xl py-2 font-mono text-xs font-bold transition ${
                      settings.videoDeadlineSec === sec
                        ? 'bg-red-500 text-white'
                        : 'border border-borderSubtle bg-surface text-slate-300'
                    } disabled:opacity-80`}
                  >
                    {formatDurationShort(sec)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400">Max 360° Clip Length</span>
                <span className="font-mono text-xs font-bold text-slate-200">
                  {settings.videoMaxDurationSec}s (360p)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {CLIP_LEN_OPTIONS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={!isHost}
                    onClick={() => onUpdateSettings({ videoMaxDurationSec: sec })}
                    className={`rounded-xl py-1.5 font-mono text-xs font-bold transition ${
                      settings.videoMaxDurationSec === sec
                        ? 'bg-slate-100 text-slate-950'
                        : 'border border-borderSubtle bg-surface text-slate-300'
                    } disabled:opacity-80`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <p className="text-xs font-bold text-white">Keep Videos for Match Vault</p>
                <p className="text-[10px] text-slate-400">
                  {settings.keepVideos
                    ? 'Watch & download clips after the match (deleted on new lobby).'
                    : 'Auto-delete clips when the next ping round starts.'}
                </p>
              </div>
              <button
                type="button"
                disabled={!isHost}
                onClick={() => onUpdateSettings({ keepVideos: !settings.keepVideos })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  settings.keepVideos ? 'bg-emerald-500' : 'bg-slate-700'
                } disabled:opacity-70`}
                aria-label="Toggle keep videos"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    settings.keepVideos ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Boundary Grace Period */}
        <div className="mb-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">
              Border GPS Drift Grace
            </span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {settings.boundaryGraceSec === 0 ? 'Instant Out' : `${settings.boundaryGraceSec}s warning`}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {GRACE_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                disabled={!isHost}
                onClick={() => onUpdateSettings({ boundaryGraceSec: sec })}
                className={`rounded-xl py-1.5 font-mono text-xs font-bold transition ${
                  settings.boundaryGraceSec === sec
                    ? 'bg-slate-100 text-slate-950'
                    : 'border border-borderSubtle bg-obsidian text-slate-300'
                } disabled:opacity-80`}
              >
                {sec === 0 ? '0s' : `${sec}s`}
              </button>
            ))}
          </div>
        </div>

        {/* Secret 1-Time Hunter Radar Token */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Secret Hunter Radar Token</p>
              <p className="text-[10px] leading-snug text-violet-200/80">
                1 random runner secretly gets a 1-time scan of hunters&apos; last GPS spots. Only
                they see it — hunters are never notified.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!isHost}
            onClick={() => onUpdateSettings({ hunterRadarToken: !settings.hunterRadarToken })}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              settings.hunterRadarToken ? 'bg-violet-500' : 'bg-slate-700'
            } disabled:opacity-70`}
            aria-label="Toggle secret hunter radar token"
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                settings.hunterRadarToken ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Play Boundary Map */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Play Area Boundary
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              settings.boundary.type !== 'NONE'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {settings.boundary.type === 'NONE'
              ? 'Not Set (Optional)'
              : settings.boundary.type === 'CIRCLE'
                ? `Circle ${settings.boundary.radiusMeters}m`
                : `Polygon (${settings.boundary.points.length} pts)`}
          </span>
        </div>

        <BoundaryMap
          boundary={settings.boundary}
          editable={isHost}
          onChangeBoundary={(b) => onUpdateSettings({ boundary: b })}
          heightClass="h-64"
        />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs font-semibold text-red-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Sticky Start Bar */}
      <div className="safe-bottom fixed bottom-0 left-0 right-0 z-[500] border-t border-borderSubtle bg-obsidian/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          {isHost ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => {
                unlockAudio();
                unlockRadioAudio();
                onStartGame();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 text-sm font-black uppercase tracking-wide text-white shadow-[0_6px_24px_rgba(239,68,68,0.35)] transition active:scale-[0.98] disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
            >
              <Play className="h-4 w-4 fill-current" />
              {room.players.length < 2
                ? 'Waiting for at least 2 players...'
                : `Spin Wheel & Pick ${effectiveHunters} Hunter${effectiveHunters > 1 ? 's' : ''}`}
            </button>
          ) : (
            <div className="rounded-2xl border border-borderSubtle bg-surface py-3.5 text-center text-xs font-bold text-slate-300">
              Waiting for host to start the wheel...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
