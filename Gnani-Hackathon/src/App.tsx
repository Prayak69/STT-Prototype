import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ScrollText, Stethoscope, X } from "lucide-react";
import { DashboardPage } from "./components/DashboardPage";
import { Header } from "./components/Header";
import { HistoryTable } from "./components/HistoryTable";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptRail } from "./components/TranscriptRail";
import { useAiStatus } from "./hooks/useAiStatus";
import { useAudioStreaming } from "./hooks/useAudioStreaming";
import { detectLanguage, metaForRecord } from "./lib/transcript";
import type { TranscriptMeta } from "./lib/transcript";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./lib/settings";
import type {
  AppSettings,
  PageKey,
  RailTab,
  SessionRecord,
} from "./lib/types";

const AUDIO_BUSY = new Set(["requesting", "connecting", "recording", "stopping"]);

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 1280px)").matches;
  });

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const handleChange = () => setIsDesktop(query.matches);
    handleChange();
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}

function liveStatus(state: string): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "requesting":
    case "connecting":
    case "stopping":
      return "Processing";
    case "recording":
      return "Recording";
    case "stopped":
      return "Completed";
    case "error":
      return "Failed";
    default:
      return "Idle";
  }
}

function sortSessions(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export default function App() {
  const audio = useAudioStreaming();
  const aiStatus = useAiStatus();
  const isDesktop = useIsDesktop();

  const [page, setPage] = useState<PageKey>("dashboard");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [savedSessions, setSavedSessions] = useState<SessionRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<RailTab>("transcript");
  const [railOpen, setRailOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(() => new Date().toISOString());

  const liveSavedRef = useRef(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const sessions = useMemo(() => sortSessions(savedSessions), [savedSessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [activeId, sessions],
  );

  const audioBusy = AUDIO_BUSY.has(audio.state);

  // Persist finished live sessions so they appear in history with the rest of
  // the workspace. The guard prevents duplicate records across re-renders.
  useEffect(() => {
    if (audio.state !== "stopped") {
      liveSavedRef.current = false;
      return;
    }
    if (liveSavedRef.current) return;
    liveSavedRef.current = true;
    if (audio.segments.length === 0) return;

    const record: SessionRecord = {
      id: `live-${Date.now()}`,
      fileName: "Live consultation",
      language: detectLanguage(audio.segments),
      durationMs: audio.elapsedMs,
      createdAt: sessionStartedAt,
      status: "Completed",
      source: "live",
      segments: audio.segments,
      notes: `${audio.segments.length} live segments`,
    };
    setSavedSessions((previous) => [record, ...previous]);
  }, [audio.elapsedMs, audio.segments, audio.state, sessionStartedAt]);

  // Reveal the transcript panel as soon as a live session starts.
  useEffect(() => {
    if (audio.state === "recording") setRailOpen(true);
  }, [audio.state]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearCurrentTranscript = useCallback(() => {
    audio.clearTranscript();
  }, [audio]);

  const startRecording = useCallback(() => {
    setActiveId(null);
    setPage("dashboard");
    setRailTab("transcript");
    setSessionStartedAt(new Date().toISOString());
    audio.clearTranscript();
    void audio.prepare();
  }, [audio]);

  const selectFile = useCallback((_file: File) => {
    setActiveId(null);
    setPage("dashboard");
    setRailTab("transcript");
    setSessionStartedAt(new Date().toISOString());
    if (!audioBusy) {
      audio.clearTranscript();
      if (audio.state !== "idle") audio.reset();
    }
  }, [audio, audioBusy]);

  const openRecord = useCallback((record: SessionRecord) => {
    if (!audioBusy) {
      audio.clearTranscript();
      if (audio.state !== "idle") audio.reset();
    }

    setActiveId(record.id);
    setRailTab("transcript");
    setRailOpen(false);
  }, [audio, audioBusy]);

  const newSession = useCallback(() => {
    if (audioBusy) return;
    audio.clearTranscript();
    audio.reset();
    setActiveId(null);
    setPage("dashboard");
    setRailTab("transcript");
    setRailOpen(false);
    setSessionStartedAt(new Date().toISOString());
  }, [audio, audioBusy]);

  const navigate = useCallback((next: PageKey) => {
    setPage(next);
    setSidebarOpen(false);
  }, []);

  const segments = activeSession ? activeSession.segments : audio.segments;

  const meta: TranscriptMeta = useMemo(() => {
    if (activeSession) return metaForRecord(activeSession);

    return {
      fileName:
        audio.state === "idle" || audio.state === "error"
          ? "New consultation"
          : "Live consultation",
      language: detectLanguage(audio.segments),
      durationMs: audio.elapsedMs,
      status: liveStatus(audio.state),
      createdAt: sessionStartedAt,
      sourceLabel: "Live session",
    };
  }, [activeSession, audio.elapsedMs, audio.segments, audio.state, sessionStartedAt]);

  const rail = (
    <TranscriptRail
      sourceKey={activeSession ? `record:${activeSession.id}` : `live:${sessionStartedAt}`}
      segments={segments}
      meta={meta}
      mode={activeSession ? "saved" : "live"}
      isProcessing={audio.isProcessing}
      isRecording={!activeSession && audio.state === "recording"}
      sessionComplete={!activeSession && audio.state === "stopped"}
      settings={settings}
      onSettingsChange={updateSettings}
      onClear={clearCurrentTranscript}
      canClear={!activeSession && segments.length > 0}
      aiStatus={aiStatus}
      tab={railTab}
      onTabChange={setRailTab}
    />
  );

  const newSessionDisabled = audioBusy;

  return (
    <div className="min-h-dvh bg-slate-50">
      <Sidebar
        page={page}
        onNavigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessionCount={sessions.length}
        aiStatus={aiStatus}
      />

      <div className="lg:pl-60">
        <Header
          page={page}
          connection={audio.connection}
          onMenu={() => setSidebarOpen(true)}
          onNewSession={newSession}
          newSessionDisabled={newSessionDisabled}
          aiStatus={aiStatus}
          onOpenRail={() => setRailOpen(true)}
          transcriptCount={segments.length}
        />

        <div className="mx-auto flex w-full max-w-[1560px] gap-5 px-4 py-5 sm:px-6 lg:gap-6">
          <main className="min-w-0 flex-1 pb-14">
            {page === "dashboard" && (
              <DashboardPage
                audio={audio}
                sessions={sessions}
                activeId={activeId}
                onOpenRecord={openRecord}
                onRecord={startRecording}
                onFile={selectFile}
                onClearTranscript={() => audio.clearTranscript()}
                onViewAll={() => setPage("transcriptions")}
                aiStatus={aiStatus}
              />
            )}

            {page === "transcriptions" && (
              <div className="space-y-4">
                <section className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
                      <Stethoscope className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight text-slate-900">
                        Session history
                      </h2>
                      <p className="mt-0.5 max-w-xl text-[11px] leading-5 text-slate-500">
                        Select a session to open its transcript in the side panel.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={newSession}
                    disabled={newSessionDisabled}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                    New transcription
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </section>

                {activeSession && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5">
                    <p className="text-[11px] leading-5 text-indigo-900">
                      <strong className="font-semibold">Open in the side panel:</strong>{" "}
                      {activeSession.fileName}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRailOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 xl:hidden"
                    >
                      Open transcript
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                )}

                <HistoryTable
                  sessions={sessions}
                  activeId={activeId}
                  onOpen={openRecord}
                />
              </div>
            )}

            {page === "settings" && (
              <SettingsPage
                settings={settings}
                onChange={updateSettings}
                onReset={() => setSettings(DEFAULT_SETTINGS)}
                aiStatus={aiStatus}
                sessionCount={savedSessions.length}
              />
            )}

            <footer className="mt-8 flex flex-col items-center justify-between gap-1 border-t border-slate-200/70 pt-4 text-[10px] text-slate-400 sm:flex-row">
              <p>VoxNote · Gnani Prisma v3.0 + Google Gemini</p>
              <p>AI output is a draft for clinician review. Live audio is not stored.</p>
            </footer>
          </main>

          <aside className="hidden w-[380px] shrink-0 xl:block 2xl:w-[420px]">
            <div className="sticky top-16 h-[calc(100dvh-4rem)] py-5">{rail}</div>
          </aside>
        </div>
      </div>

      {railOpen && !isDesktop && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close transcript panel"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-slate-50 p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <ScrollText className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                Session transcript
              </p>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Close transcript panel"
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{rail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
