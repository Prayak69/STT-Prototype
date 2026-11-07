import { Menu, Plus, ScrollText, Sparkles } from "lucide-react";
import type { ConnectionState } from "../hooks/useAudioStreaming";
import type { AiStatus, PageKey } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

interface HeaderProps {
  page: PageKey;
  connection: ConnectionState;
  onMenu: () => void;
  onNewSession: () => void;
  newSessionDisabled?: boolean;
  aiStatus: AiStatus | null;
  onOpenRail: () => void;
  transcriptCount: number;
}

const PAGE_COPY: Record<PageKey, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Record a consultation and review the live transcript",
  },
  transcriptions: {
    title: "Transcriptions",
    subtitle: "Every consultation captured in this session",
  },
  settings: {
    title: "Settings",
    subtitle: "Language, AI assistance, and privacy preferences",
  },
};

export function Header({
  page,
  connection,
  onMenu,
  onNewSession,
  newSessionDisabled = false,
  aiStatus,
  onOpenRail,
  transcriptCount,
}: HeaderProps) {
  const copy = PAGE_COPY[page];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 lg:hidden"
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-[15px]">
            {copy.title}
          </h1>
          <p className="hidden truncate text-[11px] text-slate-400 sm:block">{copy.subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <StatusBadge connection={connection} />

          <span className="hidden items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 md:inline-flex">
            <Sparkles
              className={`h-3 w-3 ${aiStatus?.configured ? "text-indigo-500" : "text-slate-300"}`}
              aria-hidden="true"
            />
            {aiStatus?.configured ? "Gemini ready" : "AI off"}
          </span>

          <button
            type="button"
            onClick={onOpenRail}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 xl:hidden"
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Transcript</span>
            {transcriptCount > 0 && (
              <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-indigo-700">
                {transcriptCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onNewSession}
            disabled={newSessionDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:py-2 sm:text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">New transcription</span>
          </button>
        </div>
      </div>
    </header>
  );
}
