import { RotateCcw, Skull, Trophy, Video } from 'lucide-react';
import type { RoomSnapshot } from '@shared/types';
import { VideoCard } from '../components/VideoCard';
import { formatDurationShort } from '../lib/geo';

interface SummaryViewProps {
  room: RoomSnapshot;
  onBackToLobby: () => void;
  onLeave: () => void;
}

export function SummaryView({ room, onBackToLobby, onLeave }: SummaryViewProps) {
  const me = room.players.find((p) => p.id === room.meId);
  const isHost = Boolean(me?.isHost);
  const huntersWon = room.winnerSide === 'HUNTERS';

  const durationSec =
    room.gameStartedAt && room.gameEndedAt
      ? Math.max(1, Math.round((room.gameEndedAt - room.gameStartedAt) / 1000))
      : 0;

  const hunters = room.players.filter((p) => p.role === 'HUNTER');
  const runners = room.players.filter((p) => p.role === 'RUNNER');
  const nowMs = Date.now();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-28 pt-6">
      {/* Winner Hero */}
      <div
        className={`rounded-3xl border p-6 text-center ${
          huntersWon
            ? 'border-red-500/40 bg-gradient-to-b from-red-500/20 to-surface'
            : 'border-emerald-500/40 bg-gradient-to-b from-emerald-500/20 to-surface'
        }`}
      >
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            huntersWon ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
          }`}
        >
          {huntersWon ? <Skull className="h-7 w-7" /> : <Trophy className="h-7 w-7" />}
        </div>
        <p className="mt-3 text-xs font-black uppercase tracking-widest text-slate-400">
          Match Complete · {formatDurationShort(durationSec)}
        </p>
        <h2 className="mt-1 text-3xl font-black text-white">
          {huntersWon ? 'MANHUNTERS WIN' : 'RUNNERS SURVIVED'}
        </h2>
        <p className="mt-1.5 text-xs text-slate-300">
          Hunters: {hunters.map((h) => h.name).join(', ')}
        </p>
      </div>

      {/* Results Breakdown */}
      <div className="mt-4 rounded-3xl border border-borderSubtle bg-surface p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Runners Summary
        </h3>
        <div className="space-y-2">
          {runners.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-2xl border border-borderSubtle/70 bg-obsidian px-3.5 py-2.5"
            >
              <span className="text-sm font-bold text-white">{r.name}</span>
              <span
                className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                  r.status === 'ALIVE'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {r.status === 'ALIVE'
                  ? 'SURVIVED'
                  : r.eliminationReason === 'OUT_OF_BOUNDS'
                    ? 'OUT OF BOUNDS'
                    : r.eliminationReason === 'MISSED_VIDEO_PING'
                      ? 'MISSED VIDEO'
                      : 'CAUGHT'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Post-Game Video Vault (when Keep Videos was ON) */}
      {room.settings.mode === 'VIDEO' && room.settings.keepVideos && room.videoPings.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Match Video Vault ({room.videoPings.length})
              </h3>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">
              Tap download before next round
            </span>
          </div>

          {room.videoPings.map((clip) => (
            <VideoCard key={clip.id} item={clip} nowMs={nowMs} allowDownload />
          ))}
        </div>
      )}

      {/* Sticky Footer Actions */}
      <div className="safe-bottom fixed bottom-0 left-0 right-0 z-[500] border-t border-borderSubtle bg-obsidian/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-2.5">
          <button
            type="button"
            onClick={onLeave}
            className="rounded-2xl border border-borderSubtle bg-surface px-4 py-3.5 text-xs font-bold text-slate-300"
          >
            Leave
          </button>
          {isHost ? (
            <button
              type="button"
              onClick={onBackToLobby}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-black uppercase tracking-wide text-slate-950 active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4 stroke-[2.5]" />
              Play Again (Lobby)
            </button>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-borderSubtle bg-surface text-xs font-bold text-slate-400">
              Waiting for host to start next round...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
