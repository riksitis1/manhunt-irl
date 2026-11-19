import { useEffect, useRef, useState } from 'react';
import type { WheelSpinState } from '@shared/types';
import { vibrate } from '../lib/geo';

interface SpinWheelProps {
  wheel: WheelSpinState;
  clockOffsetMs: number;
}

const SLICE_COLORS = [
  '#ef4444', // crimson
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
];

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function playTickAudio(ctxRef: React.MutableRefObject<AudioContext | null>): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(760, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.025);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.028);
  } catch {
    // Ignore audio errors
  }
}

export function SpinWheel({ wheel, clockOffsetMs }: SpinWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = Math.max(1, wheel.candidates.length);
    const sliceAngle = (Math.PI * 2) / count;

    // Deterministic slight offset within winning slice so landing feels natural
    let hash = 0;
    for (let i = 0; i < wheel.winnerId.length; i++) {
      hash = (hash * 31 + wheel.winnerId.charCodeAt(i)) | 0;
    }
    const offsetFrac = ((Math.abs(hash) % 40) - 20) / 100; // -0.20 to +0.20 of slice

    const rawTarget = -Math.PI / 2 - (wheel.winnerIndex + 0.5 + offsetFrac) * sliceAngle;
    const normTarget = ((rawTarget % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const finalRotation = wheel.extraRotations * Math.PI * 2 + normTarget;

    const size = 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 14;

    let lastSliceUnderPointer = -1;
    let rafId = 0;
    let finished = false;

    const draw = (rotation: number, highlightWinner: boolean) => {
      ctx.clearRect(0, 0, size, size);

      // Outer tactical ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
      ctx.fillStyle = '#0d111a';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = highlightWinner ? '#ef4444' : '#263147';
      ctx.stroke();

      // Slices
      for (let i = 0; i < count; i++) {
        const candidate = wheel.candidates[i];
        if (!candidate) continue;
        const start = rotation + i * sliceAngle;
        const end = start + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, end);
        ctx.closePath();

        const isWinnerSlice = highlightWinner && i === wheel.winnerIndex;
        ctx.fillStyle = SLICE_COLORS[i % SLICE_COLORS.length] ?? '#3b82f6';
        ctx.globalAlpha = highlightWinner && !isWinnerSlice ? 0.35 : 0.92;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.lineWidth = isWinnerSlice ? 3 : 1.5;
        ctx.strokeStyle = isWinnerSlice ? '#ffffff' : '#06080d';
        ctx.stroke();

        // Label
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + sliceAngle / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = count > 10 ? '700 11px Inter, system-ui, sans-serif' : '700 14px Inter, system-ui, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 4;
        const label = candidate.name.length > 12 ? `${candidate.name.slice(0, 11)}…` : candidate.name;
        ctx.fillText(label, radius - 14, 0);
        ctx.restore();
      }

      // Center hub
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fillStyle = '#06080d';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HUNT', cx, cy);
    };

    const frame = () => {
      const serverNow = Date.now() + clockOffsetMs;
      const elapsed = Math.max(0, serverNow - wheel.startedAt);
      const progress = Math.min(1, elapsed / wheel.durationMs);
      const eased = easeOutQuart(progress);
      const currentRotation = finalRotation * eased;

      // Slice crossing tick
      const pointerAngleInWheel =
        (((-Math.PI / 2 - currentRotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const sliceIdx = Math.floor(pointerAngleInWheel / sliceAngle);
      if (sliceIdx !== lastSliceUnderPointer && progress < 1) {
        lastSliceUnderPointer = sliceIdx;
        playTickAudio(audioCtxRef);
      }

      draw(currentRotation, progress >= 1);

      if (progress < 1) {
        rafId = window.requestAnimationFrame(frame);
      } else if (!finished) {
        finished = true;
        setRevealed(true);
        vibrate([60, 40, 120]);
      }
    };

    rafId = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [wheel, clockOffsetMs]);

  return (
    <div className="relative flex flex-col items-center">
      {/* Top pointer */}
      <div className="z-10 -mb-3 flex flex-col items-center">
        <div
          className="h-0 w-0 border-l-[14px] border-r-[14px] border-t-[24px] border-l-transparent border-r-transparent border-t-red-500 drop-shadow-[0_4px_10px_rgba(239,68,68,0.65)]"
          aria-hidden="true"
        />
      </div>

      <canvas
        ref={canvasRef}
        className="h-[320px] w-[320px] max-w-[88vw] max-h-[88vw] select-none"
      />

      <div className="mt-5 min-h-[72px] text-center">
        {revealed ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-6 py-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-400">
              Hunter #{wheel.spinIndex + 1} Selected
            </p>
            <p className="mt-0.5 text-2xl font-black tracking-tight text-white">
              {wheel.winnerName}
            </p>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-400">
            Selecting Hunter #{wheel.spinIndex + 1} of {wheel.totalSpins}...
          </p>
        )}
      </div>
    </div>
  );
}
