import { Download, ShieldCheck, Video } from 'lucide-react';
import type { VideoPingItem } from '@shared/types';
import { formatBytes, formatTimeAgo } from '../lib/geo';

interface VideoCardProps {
  item: VideoPingItem;
  nowMs: number;
  allowDownload: boolean;
}

export function VideoCard({ item, nowMs, allowDownload }: VideoCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-borderSubtle bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-borderSubtle/70 px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <Video className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{item.playerName}</p>
            <p className="text-[11px] text-slate-400">
              Ping #{item.round} · {formatTimeAgo(item.createdAt, nowMs)} · {formatBytes(item.sizeBytes)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            title="Server-verified live capture code"
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-400"
          >
            <ShieldCheck className="h-3 w-3" />
            {item.challengeCode}
          </span>
          {allowDownload && (
            <a
              href={`${item.url}?download=1`}
              download
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-borderSubtle bg-surfaceElevated text-slate-200 active:scale-95"
              title="Download clip"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      <div className="relative bg-black">
        <video
          src={item.url}
          controls
          playsInline
          preload="metadata"
          className="max-h-[360px] w-full object-contain"
        />
      </div>
    </div>
  );
}
