import {
  Bot,
  Check,
  Languages,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { TRANSLATION_LANGUAGES } from "../lib/settings";
import type { AiStatus, AppSettings } from "../lib/types";

interface SettingsPageProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
  aiStatus: AiStatus | null;
  sessionCount: number;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  icon: Icon,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  icon: typeof Sparkles;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-3 transition-colors hover:border-slate-300">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-800">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-600" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function SettingsPage({
  settings,
  onChange,
  onReset,
  aiStatus,
  sessionCount,
}: SettingsPageProps) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/40 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
              <Languages className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              Translation defaults
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Choose the language used when a transcript is translated.
            </p>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Target language
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TRANSLATION_LANGUAGES.map((language) => {
              const selected = settings.targetLanguage === language.value;
              return (
                <label
                  key={language.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                    selected
                      ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-inset ring-indigo-200"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="target-language"
                    value={language.value}
                    checked={selected}
                    onChange={() => onChange({ targetLanguage: language.value })}
                    className="sr-only"
                  />
                  <span
                    className={`flex h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-1 text-[8px] font-bold ${
                      selected
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {selected ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      language.short
                    )}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      selected ? "text-indigo-800" : "text-slate-700"
                    }`}
                  >
                    {language.label}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-3 grid gap-2">
          <Toggle
            checked={settings.autoTranslate}
            onChange={(autoTranslate) => onChange({ autoTranslate })}
            label="Translate automatically when a session ends"
            description="When a recording or upload finishes, the transcript is translated to the target language above. You can always re-translate manually."
            icon={Sparkles}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/40 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
            <Bot className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            AI services
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Clinical summaries and translation are generated by Google Gemini after
            transcription finishes.
          </p>

          <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Provider
              </span>
              <span className="text-xs font-semibold text-slate-700">
                {aiStatus?.provider ?? "Google Gemini"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Model
              </span>
              <span className="font-mono text-[11px] text-slate-600">
                {aiStatus?.model ?? "checking…"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Status
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
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
                {aiStatus?.configured ? "Configured" : "Not configured"}
              </span>
            </div>
          </div>

          <p className="mt-2.5 text-[11px] leading-5 text-slate-400">
            The Gemini API key is stored in the server <code>.env</code> file and is never sent
            to the browser. Summaries and translations require a key.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/40 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900">
            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            Privacy and data
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            How audio and clinical text are handled in this prototype.
          </p>

          <ul className="mt-3 space-y-2.5 text-[11px] leading-5 text-slate-600">
            <li className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-slate-800">Live audio</strong> is streamed
                through the private server proxy to Gnani. It is not written to disk.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-slate-800">Uploaded files</strong> are sent
                to Gnani batch transcription and are subject to that provider's retention policy.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-slate-800">Transcripts and summaries</strong>{" "}
                stay in this browser tab. Refreshing clears {sessionCount} session
                {sessionCount === 1 ? "" : "s"} recorded in this tab.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
              <span>
                <strong className="font-semibold text-slate-800">AI drafts</strong> are for
                clinician review only and must not be treated as a diagnosis.
              </span>
            </li>
          </ul>
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/40 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200">
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-800">Prototype preferences</p>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
              Preferences are saved in this browser only. Reset them to the VoxNote defaults.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset settings
        </button>
      </section>
    </div>
  );
}
