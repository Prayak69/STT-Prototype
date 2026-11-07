import { config } from "./config";
import { logger } from "./logger";
import type {
  MedicineMarket,
  MedicineProductStatus,
  PharmaDeskClientDependencies,
  PharmaDeskMedicine,
  PharmaDeskSearchOptions,
  PharmaDeskSearchResponse,
  PharmaDeskSource,
} from "./medicineTypes";
import { MEDICINE_MARKETS } from "./medicineTypes";

/**
 * Client for the PharmaDesk Medicine Reference API.
 *
 * Endpoint used: `GET {baseUrl}/v1/search`
 * Authentication: none. The OpenAPI document declares `security: []` and the
 * service explicitly states that no registration or credential is required.
 * Nothing secret is handled here.
 *
 * Licensing: the catalogue is proprietary ("All rights reserved"). Callers
 * must display results transiently and must not persist or redistribute them.
 */

export type PharmaDeskErrorCode =
  | "invalid_request"
  | "bad_request"
  | "not_found"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "timeout"
  | "invalid_response";

export interface PharmaDeskErrorDetails {
  status?: number;
  retryAfterSeconds?: number;
}

export class PharmaDeskError extends Error {
  readonly code: PharmaDeskErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: PharmaDeskErrorCode,
    message: string,
    details: PharmaDeskErrorDetails = {},
  ) {
    super(message);
    this.name = "PharmaDeskError";
    this.code = code;
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const PRODUCT_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "DISCONTINUED",
  "WITHDRAWN",
  "UNKNOWN",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(detail: string): PharmaDeskError {
  return new PharmaDeskError(
    "invalid_response",
    `PharmaDesk returned an unexpected response: ${detail}`,
  );
}

function optionalString(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidResponse(`${field} is not a string`);
  return value;
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw invalidResponse(`${field} is not a boolean`);
  return value;
}

function parseSource(value: unknown): PharmaDeskSource | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw invalidResponse("source is not an object");
  if (typeof value.name !== "string") {
    // A source without a name is unusable, but it is optional in the spec.
    return null;
  }
  return {
    name: value.name,
    ref: optionalString(value.ref, "source.ref"),
    url: optionalString(value.url, "source.url"),
  };
}

function parseMedicine(value: unknown, index: number): PharmaDeskMedicine {
  if (!isRecord(value)) throw invalidResponse(`results[${index}] is not an object`);

  if (typeof value.id !== "number" || !Number.isFinite(value.id)) {
    throw invalidResponse(`results[${index}].id is not a number`);
  }
  if (typeof value.market !== "string" || value.market.length === 0) {
    throw invalidResponse(`results[${index}].market is missing`);
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw invalidResponse(`results[${index}].name is missing`);
  }
  if (typeof value.status !== "string" || !PRODUCT_STATUSES.has(value.status)) {
    throw invalidResponse(`results[${index}].status is not a known value`);
  }

  return {
    id: value.id,
    market: value.market,
    name: value.name,
    genericName: optionalString(value.genericName, "genericName"),
    manufacturer: optionalString(value.manufacturer, "manufacturer"),
    dosageForm: optionalString(value.dosageForm, "dosageForm"),
    route: optionalString(value.route, "route"),
    strength: optionalString(value.strength, "strength"),
    packSize: optionalString(value.packSize, "packSize"),
    prescriptionOnly: optionalBoolean(value.prescriptionOnly, "prescriptionOnly"),
    schedule: optionalString(value.schedule, "schedule"),
    status: value.status as MedicineProductStatus,
    compositionKey: optionalString(value.compositionKey, "compositionKey"),
    source: parseSource(value.source),
    firstSeenAt: optionalString(value.firstSeenAt, "firstSeenAt"),
    lastSeenAt: optionalString(value.lastSeenAt, "lastSeenAt"),
  };
}

/** Validates a successful upstream body instead of trusting its shape. */
export function validateSearchResponse(body: unknown): PharmaDeskSearchResponse {
  if (!isRecord(body)) throw invalidResponse("body is not an object");

  if (body.ok !== true) {
    if (body.ok === false && typeof body.error === "string") {
      throw new PharmaDeskError("upstream_error", body.error);
    }
    throw invalidResponse("ok is not true");
  }

  if (!Array.isArray(body.results)) throw invalidResponse("results is not an array");
  if (typeof body.count !== "number" || !Number.isFinite(body.count)) {
    throw invalidResponse("count is not a number");
  }

  const results = body.results.map((item, index) => parseMedicine(item, index));

  return {
    ok: true,
    query: optionalString(body.query, "query") ?? "",
    market: optionalString(body.market, "market"),
    count: body.count,
    results,
    disclaimer: optionalString(body.disclaimer, "disclaimer"),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses `Retry-After`, which may be a number of seconds or an HTTP date.
 * Returns seconds, or null when the header is absent/unparseable.
 */
export function parseRetryAfter(
  value: string | null,
  now: () => number = Date.now,
): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, (dateMs - now()) / 1000);
  }
  return null;
}

function statusToCode(status: number): PharmaDeskErrorCode {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "upstream_error";
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Fall through to the generic message.
  }
  return `PharmaDesk request failed (${res.status})`;
}

function validateQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new PharmaDeskError(
      "invalid_request",
      "q must be at least 2 characters",
    );
  }
  return trimmed;
}

function validateMarket(market: MedicineMarket | undefined): MedicineMarket | undefined {
  if (market === undefined) return undefined;
  if (!MEDICINE_MARKETS.includes(market)) {
    throw new PharmaDeskError("invalid_request", `Unsupported market: ${market}`);
  }
  return market;
}

function validateLimit(limit: number | undefined): number {
  const value = limit ?? 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new PharmaDeskError("invalid_request", "limit must be an integer between 1 and 100");
  }
  return value;
}

/**
 * Search the catalogue. Retries 429 responses while honouring `Retry-After`.
 *
 * A caller-supplied `fetchImpl` and `sleep` make this testable without network
 * access. No caching is performed: the upstream service already caches for
 * five minutes, and this client must not persist licensed catalogue data.
 */
export async function searchPharmaDesk(
  query: string,
  options: PharmaDeskSearchOptions = {},
  deps: PharmaDeskClientDependencies = {},
): Promise<PharmaDeskSearchResponse> {
  const q = validateQuery(query);
  const market = validateMarket(options.market);
  const limit = validateLimit(options.limit);

  const url = new URL(`${config.medicine.baseUrl}/v1/search`);
  url.searchParams.set("q", q);
  if (market) url.searchParams.set("market", market);
  url.searchParams.set("limit", String(limit));

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? config.medicine.timeoutMs;
  const maxRetries = Math.max(0, config.medicine.maxRetries);

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort);

    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new PharmaDeskError(
          "timeout",
          `PharmaDesk did not respond within ${timeoutMs} ms`,
        );
      }
      if (options.signal?.aborted) {
        throw new PharmaDeskError("network_error", "PharmaDesk request was cancelled");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new PharmaDeskError(
        "network_error",
        `Could not reach PharmaDesk: ${message}`,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }

    if (res.status === 429) {
      const retryAfterSeconds = parseRetryAfter(res.headers.get("retry-after"));
      void res.body?.cancel().catch(() => undefined);

      if (attempt < maxRetries) {
        const waitMs = Math.min(30_000, Math.max(0, retryAfterSeconds ?? 2 + attempt * 2) * 1000);
        logger.warn("PharmaDesk rate limited; retrying", {
          attempt: attempt + 1,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }

      throw new PharmaDeskError(
        "rate_limited",
        "PharmaDesk rate limit reached. Try again shortly.",
        { status: 429, retryAfterSeconds: retryAfterSeconds ?? undefined },
      );
    }

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw new PharmaDeskError(statusToCode(res.status), detail, {
        status: res.status,
      });
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw invalidResponse("body is not valid JSON");
    }

    return validateSearchResponse(body);
  }
}
