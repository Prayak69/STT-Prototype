/**
 * Types for the PharmaDesk Medicine Reference API and the local matcher.
 *
 * The upstream schema is defined at https://pharmadesk.accron.in/openapi.yaml.
 * Only fields that are actually published by `GET /v1/search` are modelled here.
 * In particular:
 *   - `ingredients` is omitted from search responses.
 *   - There is no separate `brand` field; `name` is the product name.
 *   - No credential is required (`security: []` in the spec).
 */

/** Markets accepted by the upstream `market` query parameter. */
export const MEDICINE_MARKETS = ["IN", "US", "GB", "EU", "CA", "AU"] as const;
export type MedicineMarket = (typeof MEDICINE_MARKETS)[number];

/** Upstream product lifecycle status. */
export type MedicineProductStatus =
  | "ACTIVE"
  | "DISCONTINUED"
  | "WITHDRAWN"
  | "UNKNOWN";

/** Where an upstream catalogue record came from. */
export interface PharmaDeskSource {
  name: string;
  ref: string | null;
  url: string | null;
}

/**
 * A product exactly as returned inside `results[]` of `GET /v1/search`.
 * Optional upstream fields are typed as nullable because the OpenAPI schema
 * does not mark any property as required; the client validates the fields it
 * relies on and tolerates missing optional data.
 */
export interface PharmaDeskMedicine {
  id: number;
  market: string;
  name: string;
  genericName: string | null;
  manufacturer: string | null;
  dosageForm: string | null;
  route: string | null;
  strength: string | null;
  packSize: string | null;
  prescriptionOnly: boolean | null;
  schedule: string | null;
  status: MedicineProductStatus;
  compositionKey: string | null;
  source: PharmaDeskSource | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/** Successful response body from `GET /v1/search`. */
export interface PharmaDeskSearchResponse {
  ok: true;
  query: string;
  market: string | null;
  count: number;
  results: PharmaDeskMedicine[];
  disclaimer: string | null;
}

/** Error response body published by the API. */
export interface PharmaDeskErrorResponse {
  ok: false;
  error: string;
}

/** Options accepted by the upstream search call. */
export interface PharmaDeskSearchOptions {
  market?: MedicineMarket;
  /** Upstream accepts 1..100 and adjusts out-of-range values. */
  limit?: number;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
}

/** Dependencies that can be injected in tests. */
export interface PharmaDeskClientDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Override the configured timeout in tests. */
  timeoutMs?: number;
}

/** A strength parsed from a query or catalogue product. */
export interface ParsedStrength {
  /** Numeric value after unit normalisation (mcg/g become mg). */
  value: number;
  /** Canonical unit, or null when the source omitted one. */
  unit: string | null;
  /** Unit as written by the source, or null. */
  rawUnit: string | null;
  /** Human-readable source text, e.g. "650 mg". */
  text: string;
}

/** Result of comparing requested strength with catalogue strength. */
export interface StrengthComparison {
  queryStrengths: ParsedStrength[];
  productStrengths: ParsedStrength[];
  /** Null when either side does not publish enough information. */
  match: boolean | null;
  /** How a match was reached, if at all. */
  matchedBy: "component" | "sum" | "none" | null;
}

/** Result of comparing the requested dosage form with the catalogue form. */
export interface DosageFormComparison {
  query: string | null;
  product: string | null;
  match: boolean | null;
}

/** Per-candidate score details, exposed for auditing rather than ranking alone. */
export interface MedicineScoreBreakdown {
  nameSimilarity: number;
  genericSimilarity: number;
  compositionSimilarity: number;
  baseScore: number;
  penalties: string[];
}

/** Conservative match states. Fuzzy similarity alone never yields "matched". */
export type MedicineMatchStatus =
  | "matched"
  | "suggested"
  | "ambiguous"
  | "unmatched";

/** One scored catalogue candidate. */
export interface MedicineMatchCandidate {
  matchStatus: MedicineMatchStatus;
  confidence: number;
  reason: string;

  /** Canonical product name as published by PharmaDesk. */
  canonicalName: string;
  /**
   * The search endpoint does not publish a distinct brand field, so this is
   * null. The product name is returned in `canonicalName`.
   */
  brand: string | null;
  genericName: string | null;
  /** Human-readable generic composition derived from genericName/compositionKey. */
  genericComposition: string | null;
  /** Structured components parsed from `compositionKey`, never inferred. */
  composition: Array<{ name: string; strength: string | null }> | null;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  manufacturer: string | null;
  packSize: string | null;
  prescriptionOnly: boolean | null;
  schedule: string | null;
  market: string;
  apiId: number;
  productStatus: MedicineProductStatus;
  compositionKey: string | null;
  source: PharmaDeskSource | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;

  /** True only for a deterministic product-name match with no risky rewrite. */
  deterministic: boolean;
  /** Alias key used to reach the catalogue, if any. */
  aliasUsed: string | null;
  spellingCorrected: boolean;
  strengthComparison: StrengthComparison;
  dosageFormComparison: DosageFormComparison;
  score: MedicineScoreBreakdown;
  matchedFields: string[];
}

/** Request body for `POST /api/medicines/search`. */
export interface MedicineSearchRequest {
  query: string;
  market?: MedicineMarket;
  limit?: number;
}

/** Response body for `POST /api/medicines/search`. */
export interface MedicineSearchResponse {
  ok: true;
  /** Original query, never mutated. */
  query: string;
  normalizedQuery: string;
  market: MedicineMarket | null;
  status: MedicineMatchStatus;
  count: number;
  results: MedicineMatchCandidate[];
  notices: string[];
  disclaimer: string | null;
}

/** Injectable search function used by the matcher and its tests. */
export type MedicineSearchFn = (
  query: string,
  options?: PharmaDeskSearchOptions,
) => Promise<PharmaDeskSearchResponse>;

/** Dependencies for the matcher (allows a mocked upstream in tests). */
export interface MedicineSearchDependencies {
  search?: MedicineSearchFn;
}
