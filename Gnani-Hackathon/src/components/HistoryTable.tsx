import { useMemo, useState } from "react";
import { Files, Filter, Search } from "lucide-react";
import { formatDate, formatDuration } from "../lib/format";
import type { SessionRecord } from "../lib/types";

interface HistoryTableProps {
  sessions: SessionRecord[];
  activeId?: string | null;
  onOpen: (record: SessionRecord) => void;
  compact?: boolean;
  limit?: number;
}

function speakerCount(record: SessionRecord): number {
  const speakers = new Set<string>();
  for (const segment of record.segments) {
    if (segment.speakerName) speakers.add(segment.speakerName);
    else if (segment.speakerId !== null && segment.speakerId !== undefined) {
      speakers.add(`speaker-${segment.speakerId}`);
    }
  }
  return speakers.size;
}

function SourceBadge({ record }: { record: SessionRecord }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-200">
      {record.source === "upload" ? "Upload" : "Live"}
    </span>
  );
}

function StatusPill({ status }: { status: SessionRecord["status"] }) {
  const styles: Record<SessionRecord["status"], string> = {
    Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    Processing: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    Failed: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${styles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

const selectClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export function HistoryTable({
  sessions,
  activeId = null,
  onOpen,
  compact = false,
  limit,
}: HistoryTableProps) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [status, setStatus] = useState("all");

  const languages = useMemo(
    () => Array.from(new Set(sessions.map((record) => record.language).filter(Boolean))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = sessions.filter((record) => {
      if (language !== "all" && record.language !== language) return false;
      if (status !== "all" && record.status !== status) return false;
      if (!needle) return true;
      return (
        record.fileName.toLowerCase().includes(needle) ||
        record.language.toLowerCase().includes(needle) ||
        record.status.toLowerCase().includes(needle) ||
        (record.notes ?? "").toLowerCase().includes(needle)
      );
    });
    return typeof limit === "number" ? result.slice(0, limit) : result;
  }, [language, limit, query, sessions, status]);

  if (compact) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <Files className="mb-2 h-5 w-5 text-slate-300" aria-hidden="true" />
            <p className="text-xs font-medium text-slate-500">
              {sessions.length === 0 ? "No sessions yet" : "No sessions match your filters"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {sessions.length === 0
                ? "Record or upload audio to create the first transcript."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => onOpen(record)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 ${
                    record.id === activeId ? "bg-indigo-50/60" : ""
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Files className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-800">
                        {record.fileName}
                      </span>
                      <SourceBadge record={record} />
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span>{formatDate(record.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(record.durationMs)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{record.language}</span>
                    </span>
                  </span>
                  <StatusPill status={record.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search transcriptions</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by file, language, or note…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-700 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <Filter className="h-3 w-3" aria-hidden="true" />
              Filter
            </span>
            <select
              aria-label="Filter by language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className={selectClass}
            >
              <option value="all">All languages</option>
              {languages.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={selectClass}
            >
              <option value="all">All statuses</option>
              <option value="Completed">Completed</option>
              <option value="Processing">Processing</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>

      </div>

      <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_90px_110px_100px] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 md:grid">
        <span>Session</span>
        <span>Language</span>
        <span>Duration</span>
        <span>Date</span>
        <span className="text-right">Status</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Files className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-slate-600">
            {sessions.length === 0 ? "No transcriptions yet" : "No matching transcriptions"}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">
            {sessions.length === 0
              ? "Start a recording or upload an audio file. Finished sessions appear here with their transcript, translation, and summary."
              : "Adjust the search or filters to find a session."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {filtered.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onOpen(record)}
                className={`grid w-full grid-cols-1 items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_90px_110px_100px] md:gap-3 ${
                  record.id === activeId ? "bg-indigo-50/60" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Files className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-800">
                        {record.fileName}
                      </span>
                      <SourceBadge record={record} />
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                      {record.notes ??
                        `${record.segments.length} segments · ${speakerCount(record)} speakers`}
                    </span>
                  </span>
                </span>

                <span className="flex items-center gap-3 text-[11px] text-slate-500 md:block">
                  <span className="md:hidden text-slate-400">Language:</span>
                  {record.language}
                </span>
                <span className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-slate-500 md:block">
                  <span className="font-sans md:hidden text-slate-400">Duration:</span>
                  {formatDuration(record.durationMs)}
                </span>
                <span className="flex items-center gap-3 text-[11px] text-slate-500 md:block">
                  <span className="md:hidden text-slate-400">Date:</span>
                  {formatDate(record.createdAt)}
                </span>
                <span className="flex items-center justify-between gap-2 md:justify-end">
                  <StatusPill status={record.status} />
                  <span className="text-[10px] font-medium text-indigo-600 md:hidden">Open →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
          Showing {filtered.length} of {sessions.length} session
          {sessions.length === 1 ? "" : "s"}. Session history is kept in this browser tab only.
        </div>
      )}
    </div>
  );
}
