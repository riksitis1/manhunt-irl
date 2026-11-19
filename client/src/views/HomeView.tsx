import { useState } from 'react';
import { ArrowRight, MapPin, Plus, Radar, Shield, Video } from 'lucide-react';

interface HomeViewProps {
  initialJoinCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onCreateLobby: (name: string) => void;
  onJoinLobby: (code: string, name: string) => void;
}

export function HomeView({
  initialJoinCode,
  initialName,
  busy,
  error,
  onCreateLobby,
  onJoinLobby,
}: HomeViewProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialJoinCode);
  const [tab, setTab] = useState<'JOIN' | 'CREATE'>(initialJoinCode ? 'JOIN' : 'CREATE');

  const canSubmit = name.trim().length >= 2 && !busy;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-4 py-6">
      <div>
        {/* Brand header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-500/40 bg-red-500/15 text-red-400">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white">MANHUNT IRL</h1>
              <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
                Real-Life Block Pursuit
              </p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Mobile Ready
          </span>
        </div>

        {/* Main Card */}
        <div className="rounded-3xl border border-borderSubtle bg-surface p-5 shadow-2xl">
          <div className="mb-4 grid grid-cols-2 rounded-2xl border border-borderSubtle bg-obsidian p-1">
            <button
              type="button"
              onClick={() => setTab('CREATE')}
              className={`rounded-xl py-2.5 text-xs font-bold transition ${
                tab === 'CREATE'
                  ? 'bg-surfaceElevated text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Host New Lobby
            </button>
            <button
              type="button"
              onClick={() => setTab('JOIN')}
              className={`rounded-xl py-2.5 text-xs font-bold transition ${
                tab === 'JOIN'
                  ? 'bg-surfaceElevated text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Join With Code
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                Your Name
              </label>
              <input
                type="text"
                maxLength={18}
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-2xl border border-borderSubtle bg-obsidian px-4 py-3.5 text-base font-semibold text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {tab === 'JOIN' && (
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Lobby Join Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  autoCapitalize="characters"
                  placeholder="ABCD"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="w-full rounded-2xl border border-borderSubtle bg-obsidian px-4 py-3.5 text-center font-mono text-2xl font-black tracking-[0.35em] text-emerald-400 placeholder:text-slate-700 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-xs font-semibold text-red-300">
                {error}
              </div>
            )}

            {tab === 'CREATE' ? (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => onCreateLobby(name)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 text-sm font-black uppercase tracking-wide text-slate-950 shadow-[0_6px_24px_rgba(16,185,129,0.3)] transition active:scale-[0.98] disabled:opacity-40"
              >
                <Plus className="h-4 w-4 stroke-[3]" />
                {busy ? 'Creating Lobby...' : 'Create Lobby'}
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSubmit || code.trim().length < 4}
                onClick={() => onJoinLobby(code, name)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 text-sm font-black uppercase tracking-wide text-white shadow-[0_6px_24px_rgba(239,68,68,0.3)] transition active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? 'Joining...' : 'Join Lobby'}
                <ArrowRight className="h-4 w-4 stroke-[3]" />
              </button>
            )}
          </div>
        </div>

        {/* How it works highlights */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <div className="rounded-2xl border border-borderSubtle/80 bg-surface/70 p-3">
            <Shield className="h-4 w-4 text-emerald-400" />
            <p className="mt-2 text-xs font-bold text-white">Block Border</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              Step outside the map boundary and you&apos;re out.
            </p>
          </div>
          <div className="rounded-2xl border border-borderSubtle/80 bg-surface/70 p-3">
            <Video className="h-4 w-4 text-amber-400" />
            <p className="mt-2 text-xs font-bold text-white">Live 360°</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              Camera-only pings every 5m. Miss 2m deadline = out.
            </p>
          </div>
          <div className="rounded-2xl border border-borderSubtle/80 bg-surface/70 p-3">
            <MapPin className="h-4 w-4 text-red-400" />
            <p className="mt-2 text-xs font-bold text-white">GPS Mode</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              Or drop your last GPS spot pin on the hunters&apos; map.
            </p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[11px] text-slate-500">
        OLED dark UI + adaptive GPS polling built to preserve phone battery outdoors.
      </p>
    </div>
  );
}
