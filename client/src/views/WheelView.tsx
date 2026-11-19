import { FastForward, Skull } from 'lucide-react';
import type { RoomSnapshot } from '@shared/types';
import { SpinWheel } from '../components/SpinWheel';

interface WheelViewProps {
  room: RoomSnapshot;
  clockOffsetMs: number;
  onSkipWheel: () => void;
}

export function WheelView({ room, clockOffsetMs, onSkipWheel }: WheelViewProps) {
  const me = room.players.find((p) => p.id === room.meId);
  const isHost = Boolean(me?.isHost);
  const wheel = room.wheel;

  if (!wheel) return null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-between px-4 py-6">
      <div className="w-full text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-red-400">
          <Skull className="h-3.5 w-3.5" />
          Hunter Selection Wheel
        </span>
        <h2 className="mt-2 text-2xl font-black text-white">Who&apos;s Hunting?</h2>
        <p className="mt-1 text-xs text-slate-400">
          Synced live across all {room.players.length} phones
        </p>
      </div>

      <div className="my-4 w-full flex justify-center">
        <SpinWheel
          key={`${wheel.spinIndex}-${wheel.startedAt}`}
          wheel={wheel}
          clockOffsetMs={clockOffsetMs}
        />
      </div>

      <div className="w-full space-y-3">
        {wheel.selectedHunters.length > 0 && (
          <div className="rounded-2xl border border-borderSubtle bg-surface p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Locked In Hunters
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {wheel.selectedHunters.map((h) => (
                <span
                  key={h.id}
                  className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1 text-xs font-black text-red-300"
                >
                  {h.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {isHost && (
          <button
            type="button"
            onClick={onSkipWheel}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-borderSubtle bg-surface py-3 text-xs font-bold text-slate-400 hover:text-white active:scale-98"
          >
            <FastForward className="h-3.5 w-3.5" />
            Skip Remaining Spins
          </button>
        )}
      </div>
    </div>
  );
}
