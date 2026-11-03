import {
  AudioLines,
  Files,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import type { AiStatus, PageKey } from "../lib/types";

interface SidebarProps {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  open: boolean;
  onClose: () => void;
  sessionCount: number;
  aiStatus: AiStatus | null;
}

const NAV_ITEMS: Array<{
  id: PageKey;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Record and review",
    icon: LayoutDashboard,
  },
  {
    id: "transcriptions",
    label: "Transcriptions",
    description: "Session history",
    icon: Files,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Language and AI",
    icon: Settings,
  },
];

function SidebarContent({
  page,
  onNavigate,
  onClose,
  sessionCount,
  aiStatus,
}: SidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-sm shadow-indigo-600/25">
            <Stethoscope className="h-[18px] w-[18px] text-white" strokeWidth={2.1} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-900">
              VoxNote
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Clinical documentation
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 lg:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Workspace
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === page;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    onClose();
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                      active
                        ? "bg-white text-indigo-600 ring-indigo-200"
                        : "bg-slate-50 text-slate-500 ring-slate-200 group-hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                    <span
                      className={`block truncate text-[10px] ${
                        active ? "text-indigo-500" : "text-slate-400"
                      }`}
                    >
                      {item.description}
                    </span>
                  </span>
                  {item.id === "transcriptions" && sessionCount > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {sessionCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
            AI assistant
          </p>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            {aiStatus?.configured
              ? `Summaries and translation are ready with ${aiStatus.model}.`
              : aiStatus === null
                ? "Checking the AI configuration on the server…"
                : "Add a Gemini key on the server to enable summaries and translation."}
          </p>
          <span
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
              aiStatus?.configured
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-700 ring-amber-200"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                aiStatus?.configured ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {aiStatus?.configured
              ? "Gemini connected"
              : aiStatus === null
                ? "Checking…"
                : "Not configured"}
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200/80 p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            Privacy
          </p>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            Audio streams through the private server proxy. API keys never reach the browser.
          </p>
        </div>
      </nav>

      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 text-[11px] font-semibold text-white">
            CW
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">Clinician workspace</p>
            <p className="truncate text-[10px] text-slate-400">Local session</p>
          </div>
        </div>
        <p className="mt-1 flex items-center gap-1.5 px-2 pb-1 text-[10px] text-slate-400">
          <AudioLines className="h-3 w-3" aria-hidden="true" />
          Gnani Prisma v3.0
        </p>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-slate-200/80 lg:block">
        <SidebarContent {...props} onClose={props.onClose} />
      </aside>

      {props.open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={props.onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            <SidebarContent {...props} />
          </div>
        </div>
      )}
    </>
  );
}
