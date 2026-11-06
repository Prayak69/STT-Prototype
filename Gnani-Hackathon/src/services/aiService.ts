import type {
  AiInsightRequestPayload,
  AiStatus,
  ConsultationSummary,
  InsightsPayload,
} from "../lib/types";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    const response = await fetch("/api/ai/status");
    if (!response.ok) {
      return { configured: false, provider: "Google Gemini", model: "unavailable" };
    }
    return (await response.json()) as AiStatus;
  } catch {
    return { configured: false, provider: "Google Gemini", model: "unavailable" };
  }
}

/**
 * One Gemini request returns both the clinical summary and the segment
 * translation. The UI still exposes them on separate tabs/buttons.
 */
export async function requestInsights(payload: AiInsightRequestPayload): Promise<InsightsPayload> {
  const response = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Summary and translation failed. Please try again."));
  }

  return (await response.json()) as InsightsPayload;
}

export function isConsultationSummary(value: unknown): value is ConsultationSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.headline === "string" &&
    typeof record.chiefComplaint === "string" &&
    Array.isArray(record.symptoms) &&
    typeof record.history === "string" &&
    Array.isArray(record.medications) &&
    typeof record.assessment === "string" &&
    Array.isArray(record.plan) &&
    typeof record.followUp === "string" &&
    Array.isArray(record.redFlags)
  );
}
