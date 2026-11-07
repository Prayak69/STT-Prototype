import { config } from "./config";
import { logger } from "./logger";
import { searchPharmaDesk } from "./pharmaDesk";
import type {
  DosageFormComparison,
  MedicineMatchCandidate,
  MedicineMatchStatus,
  MedicineSearchDependencies,
  MedicineSearchResponse,
  ParsedStrength,
  PharmaDeskMedicine,
  PharmaDeskSearchResponse,
  StrengthComparison,
} from "./medicineTypes";
import { MEDICINE_MARKETS } from "./medicineTypes";
import type { MedicineMarket } from "./medicineTypes";

/**
 * Medicine name normalisation and conservative candidate ranking.
 *
 * Design rules:
 *   - The original query/transcript is never rewritten in the response.
 *   - Fuzzy similarity can only produce `suggested` or `ambiguous`; only a
 *     deterministic exact product-name match can produce `matched`.
 *   - Brand aliases are a small, documented search aid, not a claim that a
 *     brand is clinically equivalent to a molecule.
 *   - Strength and dosage form are validated, but no dosage, frequency, route
 *     or duration is inferred from the conversation.
 *   - Catalogue data is used transiently and never persisted.
 */

const SINGLE_DIGITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

/**
 * Limited Devanagari transliteration for common medicine words. This is a
 * search aid only; it is not a general Hindi transliteration engine.
 */
const DEVANAGARI_TOKENS: Record<string, string> = {
  "पैरासिटामोल": "paracetamol",
  "पैरासिटामॉल": "paracetamol",
  "एमोक्सिसिलिन": "amoxicillin",
  "एमॉक्सिसिलिन": "amoxicillin",
  "एजिथ्रोमाइसिन": "azithromycin",
  "अज़िथ्रोमाइसिन": "azithromycin",
  "मेटफॉर्मिन": "metformin",
  "पैंटोप्राजोल": "pantoprazole",
  "पेंटोप्राजोल": "pantoprazole",
  "सेटिरिज़िन": "cetirizine",
  "इबुप्रोफेन": "ibuprofen",
  "डोलो": "dolo",
  "क्रोसिन": "crocin",
  "कैलपोल": "calpol",
  "ऑगमेंटिन": "augmentin",
  "औगमेंटिन": "augmentin",
  "क्लेवम": "clavam",
  "पैन": "pan",
  "गोली": "tablet",
  "सिरप": "syrup",
  "इंजेक्शन": "injection",
  "कैप्सूल": "capsule",
  "दवा": "",
  "दवाई": "",
};

/**
 * Spelling/salt variants that are safe, deterministic molecule names. These
 * are applied before search so the upstream prefix search can find the
 * canonical spelling.
 */
const MOLECULE_EQUIVALENTS: Record<string, string> = {
  paracetmol: "paracetamol",
  paracitamol: "paracetamol",
  paracetemol: "paracetamol",
  paracetamole: "paracetamol",
  amoxycillin: "amoxicillin",
  amoxicilin: "amoxicillin",
  clavulanate: "clavulanic acid",
  azithromycine: "azithromycin",
  azithro: "azithromycin",
  metformine: "metformin",
  pantoprazol: "pantoprazole",
  cetrizine: "cetirizine",
  cetirizin: "cetirizine",
  ibuprofene: "ibuprofen",
  levothyroxin: "levothyroxine",
  amlodipin: "amlodipine",
  atorvastatine: "atorvastatin",
  rosuvastatine: "rosuvastatin",
  ondansetrone: "ondansetron",
  domperidon: "domperidone",
  levocetirizin: "levocetirizine",
  omeprazol: "omeprazole",
  ranitidin: "ranitidine",
  salbutamole: "salbutamol",
};

/** Curated brand-to-generic search hints. Not a clinical equivalence table. */
const BRAND_ALIASES: Record<string, string> = {
  dolo: "paracetamol",
  crocin: "paracetamol",
  calpol: "paracetamol",
  pcm: "paracetamol",
  augmentin: "amoxicillin clavulanic acid",
  clavam: "amoxicillin clavulanic acid",
  moxikind: "amoxicillin clavulanic acid",
  azee: "azithromycin",
  azithral: "azithromycin",
  pan: "pantoprazole",
  "pan d": "pantoprazole domperidone",
  pantop: "pantoprazole",
  glycomet: "metformin",
  combiflam: "ibuprofen paracetamol",
  "montek lc": "montelukast levocetirizine",
  montek: "montelukast",
  montair: "montelukast",
  telma: "telmisartan",
  "telma am": "telmisartan amlodipine",
  atorva: "atorvastatin",
  rosuvas: "rosuvastatin",
  thyronorm: "levothyroxine",
  eltroxin: "levothyroxine",
  omez: "omeprazole",
  rantac: "ranitidine",
  domstal: "domperidone",
  emeset: "ondansetron",
  okacet: "cetirizine",
  levocet: "levocetirizine",
  brufen: "ibuprofen",
  ors: "oral rehydration salts",
};

/** Single-word vocabulary used only for conservative typo correction. */
const COMMON_MEDICINE_TERMS: ReadonlySet<string> = new Set([
  ...Object.keys(BRAND_ALIASES).flatMap((key) => key.split(" ")),
  "paracetamol",
  "amoxicillin",
  "clavulanic",
  "acid",
  "azithromycin",
  "metformin",
  "pantoprazole",
  "cetirizine",
  "ibuprofen",
  "levothyroxine",
  "amlodipine",
  "atorvastatin",
  "rosuvastatin",
  "ondansetron",
  "domperidone",
  "levocetirizine",
  "montelukast",
  "telmisartan",
  "omeprazole",
  "ranitidine",
  "salbutamol",
  "glimepiride",
  "fenofibrate",
  "hydrochloride",
  "sodium",
  "potassium",
  "sulfate",
  "sulphate",
  "tartrate",
  "succinate",
  "citrate",
]);

type DosageFormGroup =
  | "tablet"
  | "capsule"
  | "liquid"
  | "suspension"
  | "injection"
  | "drops"
  | "topical"
  | "inhaler"
  | "patch"
  | "suppository"
  | "spray"
  | "powder";

const DOSAGE_FORM_GROUPS: Array<{
  group: DosageFormGroup;
  terms: ReadonlySet<string>;
}> = [
  {
    group: "injection",
    terms: new Set([
      "injection",
      "inj",
      "infusion",
      "vial",
      "ampoule",
      "iv",
      "im",
      "teeka",
    ]),
  },
  {
    group: "tablet",
    terms: new Set(["tablet", "tablets", "tab", "tabs", "goli", "goliyan"]),
  },
  {
    group: "capsule",
    terms: new Set(["capsule", "capsules", "cap", "caps"]),
  },
  {
    group: "suspension",
    terms: new Set(["suspension", "susp", "suspensions"]),
  },
  {
    group: "liquid",
    terms: new Set([
      "syrup",
      "syp",
      "liquid",
      "solution",
      "elixir",
      "sharbat",
      "oral",
    ]),
  },
  {
    group: "drops",
    terms: new Set(["drops", "drop"]),
  },
  {
    group: "topical",
    terms: new Set(["ointment", "cream", "gel", "lotion", "malham"]),
  },
  {
    group: "inhaler",
    terms: new Set(["inhaler", "inhalation", "aerosol"]),
  },
  {
    group: "patch",
    terms: new Set(["patch", "patches"]),
  },
  {
    group: "suppository",
    terms: new Set(["suppository", "suppositories"]),
  },
  {
    group: "spray",
    terms: new Set(["spray"]),
  },
  {
    group: "powder",
    terms: new Set(["powder", "sachet", "granules"]),
  },
];

const ALL_FORM_TOKENS: ReadonlySet<string> = new Set(
  DOSAGE_FORM_GROUPS.flatMap((item) => [...item.terms]),
);

const SALT_TOKENS: ReadonlySet<string> = new Set([
  "hydrochloride",
  "hcl",
  "sodium",
  "potassium",
  "calcium",
  "besylate",
  "maleate",
  "succinate",
  "tartrate",
  "citrate",
  "mesylate",
  "tosylate",
  "sulfate",
  "sulphate",
  "phosphate",
  "acetate",
  "fumarate",
  "oxalate",
  "dihydrate",
  "monohydrate",
  "anhydrous",
  "hydrate",
]);

const ADMIN_WORDS: ReadonlySet<string> = new Set([
  "daily",
  "twice",
  "thrice",
  "morning",
  "evening",
  "night",
  "after",
  "before",
  "food",
  "meals",
  "empty",
  "stomach",
  "days",
  "day",
  "week",
  "weeks",
  "month",
  "months",
  "medicine",
  "dawa",
  "dawai",
]);

const STOP_WORDS: ReadonlySet<string> = new Set([
  "for",
  "of",
  "with",
  "and",
  "the",
  "a",
  "an",
  "plus",
  "tablet",
  "tablets",
]);

const STRENGTH_UNIT_WORDS: ReadonlySet<string> = new Set([
  "mg",
  "mcg",
  "ug",
  "µg",
  "g",
  "gm",
  "gram",
  "grams",
  "ml",
  "iu",
  "unit",
  "units",
  "%",
]);

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function digitValue(token: string): number | null {
  return SINGLE_DIGITS[token] ?? null;
}

function tensValue(token: string): number | null {
  return TENS[token] ?? null;
}

/**
 * Converts spoken numbers such as "six fifty", "six hundred fifty" and
 * "six two five" into digits. Only patterns that look like strengths are
 * converted; a lone "one" or "two" is left alone.
 */
function normalizeSpokenNumbers(tokens: string[]): {
  tokens: string[];
  changed: boolean;
} {
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const digit = digitValue(token);

    if (digit !== null && tokens[i + 1] === "hundred") {
      let value = digit * 100;
      let next = i + 2;
      if (tokens[next] === "and") next += 1;
      const tens = tensValue(tokens[next] ?? "");
      if (tens !== null) {
        value += tens;
        next += 1;
      } else {
        const ones = digitValue(tokens[next] ?? "");
        if (ones !== null) {
          value += ones;
          next += 1;
        }
      }
      out.push(String(value));
      changed = true;
      i = next - 1;
      continue;
    }

    const tens = tensValue(token);
    if (tens !== null && tens >= 20) {
      const ones = digitValue(tokens[i + 1] ?? "");
      if (ones !== null) {
        out.push(String(tens + ones));
        changed = true;
        i += 1;
        continue;
      }
      out.push(String(tens));
      changed = true;
      continue;
    }

    if (digit !== null && digit >= 1 && digit <= 9) {
      const followingTens = tensValue(tokens[i + 1] ?? "");
      if (followingTens !== null && followingTens >= 20) {
        out.push(String(digit * 100 + followingTens));
        changed = true;
        i += 1;
        continue;
      }

      const second = digitValue(tokens[i + 1] ?? "");
      const third = digitValue(tokens[i + 2] ?? "");
      if (second !== null && third !== null) {
        out.push(`${digit}${second}${third}`);
        changed = true;
        i += 2;
        continue;
      }

      if (STRENGTH_UNIT_WORDS.has(tokens[i + 1] ?? "")) {
        out.push(String(digit));
        changed = true;
        continue;
      }
    }

    out.push(token);
  }

  return { tokens: out, changed };
}

export interface NormalizedMedicineText {
  text: string;
  transformations: string[];
}

/**
 * Normalises medicine text for matching. It does not alter the caller's
 * original query; it only produces a search/matching form.
 */
export function normalizeMedicineText(input: string): NormalizedMedicineText {
  const transformations: string[] = [];
  let text = input.normalize("NFKC");

  const withDigits = text.replace(/[०-९]/g, (char) => DEVANAGARI_DIGITS[char] ?? char);
  if (withDigits !== text) {
    text = withDigits;
    pushUnique(transformations, "devanagari_digits");
  }

  const parts = text.split(/(\s+)/);
  let devanagariChanged = false;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\s*$/.test(part)) continue;
    const cleaned = part.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, "");
    if (cleaned && DEVANAGARI_TOKENS[cleaned] !== undefined) {
      parts[i] = part.replace(cleaned, DEVANAGARI_TOKENS[cleaned]);
      devanagariChanged = true;
    }
  }
  if (devanagariChanged) {
    text = parts.join("");
    pushUnique(transformations, "devanagari_transliteration");
  }

  text = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const numbered = normalizeSpokenNumbers(text.split(" ").filter(Boolean));
  if (numbered.changed) {
    text = numbered.tokens.join(" ");
    pushUnique(transformations, "spoken_number_normalization");
  }

  const replaced: string[] = [];
  let moleculeChanged = false;
  for (const token of text.split(" ").filter(Boolean)) {
    const replacement = MOLECULE_EQUIVALENTS[token];
    if (replacement) {
      replaced.push(...replacement.split(" "));
      moleculeChanged = true;
    } else {
      replaced.push(token);
    }
  }
  if (moleculeChanged) {
    text = replaced.join(" ");
    pushUnique(transformations, "molecule_normalization");
  }

  return { text, transformations };
}

function canonicalUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower === "mcg" || lower === "ug" || lower === "µg") return "mg";
  if (lower === "g" || lower === "gm" || lower === "gram" || lower === "grams") {
    return "mg";
  }
  if (lower === "iu" || lower === "unit" || lower === "units") return "iu";
  return lower;
}

function convertUnitValue(value: number, unit: string): number {
  const lower = unit.toLowerCase();
  if (lower === "mcg" || lower === "ug" || lower === "µg") return value / 1000;
  if (lower === "g" || lower === "gm" || lower === "gram" || lower === "grams") {
    return value * 1000;
  }
  return value;
}

export interface StrengthExtraction {
  strengths: ParsedStrength[];
  /** Tokens that make up strength values/units; remove these for a base name. */
  baseIndexes: Set<number>;
  /** Replacements for a signature: keep digits, drop units. */
  signatureReplacements: Map<number, string | null>;
}

/** Parses strength tokens such as "650 mg", "625", "1000mcg", "500/125". */
export function parseStrengthTokens(tokens: string[]): StrengthExtraction {
  const strengths: ParsedStrength[] = [];
  const baseIndexes = new Set<number>();
  const signatureReplacements = new Map<number, string | null>();

  const addStrength = (
    value: number,
    rawUnit: string | null,
    text: string,
  ): void => {
    const unit = rawUnit ? canonicalUnit(rawUnit) : null;
    const converted = rawUnit ? convertUnitValue(value, rawUnit) : value;
    strengths.push({
      value: converted,
      unit,
      rawUnit,
      text,
    });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const attached = token.match(/^(\d+(?:\.\d+)?)(mg|mcg|ug|µg|g|gm|ml|iu|%)$/i);
    if (attached) {
      const rawUnit = attached[2].toLowerCase();
      addStrength(Number(attached[1]), rawUnit, `${attached[1]} ${rawUnit}`);
      baseIndexes.add(i);
      signatureReplacements.set(i, attached[1]);
      continue;
    }

    if (/^\d+(?:\.\d+)?$/.test(token)) {
      const next = tokens[i + 1]?.toLowerCase() ?? "";
      if (STRENGTH_UNIT_WORDS.has(next)) {
        addStrength(Number(token), next, `${token} ${next}`);
        baseIndexes.add(i);
        baseIndexes.add(i + 1);
        signatureReplacements.set(i, token);
        signatureReplacements.set(i + 1, null);
        i += 1;
        continue;
      }

      const value = Number(token);
      if (value >= 20) {
        addStrength(value, null, token);
        baseIndexes.add(i);
        signatureReplacements.set(i, token);
      }
      continue;
    }

    if (STRENGTH_UNIT_WORDS.has(token)) {
      baseIndexes.add(i);
      signatureReplacements.set(i, null);
    }
  }

  const seen = new Set<string>();
  const unique = strengths.filter((item) => {
    const key = `${item.value}|${item.unit ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { strengths: unique, baseIndexes, signatureReplacements };
}

export interface DosageFormExtraction {
  form: string | null;
  group: DosageFormGroup | null;
}

function findDosageForm(tokens: string[]): DosageFormExtraction {
  for (const item of DOSAGE_FORM_GROUPS) {
    for (const token of tokens) {
      if (item.terms.has(token)) {
        return { form: token, group: item.group };
      }
    }
  }
  return { form: null, group: null };
}

function tokensToSignature(
  tokens: string[],
  extraction: StrengthExtraction,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (extraction.signatureReplacements.has(i)) {
      const replacement = extraction.signatureReplacements.get(i);
      if (replacement) out.push(replacement);
      continue;
    }
    if (
      ALL_FORM_TOKENS.has(token) ||
      ADMIN_WORDS.has(token) ||
      STOP_WORDS.has(token)
    ) {
      continue;
    }
    out.push(token);
  }
  return out;
}

function tokensToBase(tokens: string[], extraction: StrengthExtraction): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (extraction.baseIndexes.has(i)) continue;
    if (
      ALL_FORM_TOKENS.has(token) ||
      ADMIN_WORDS.has(token) ||
      STOP_WORDS.has(token)
    ) {
      continue;
    }
    out.push(token);
  }
  return out;
}

export interface CompositionComponent {
  name: string;
  strength: string | null;
}

export function parseCompositionKey(
  compositionKey: string | null,
): CompositionComponent[] {
  if (!compositionKey) return [];
  return compositionKey
    .split("|")
    .map((part) => {
      const at = part.lastIndexOf("@");
      if (at < 0) return { name: part.trim(), strength: null };
      return {
        name: part.slice(0, at).trim(),
        strength: part.slice(at + 1).trim() || null,
      };
    })
    .filter((component) => component.name.length > 0);
}

export interface QueryAnalysis {
  original: string;
  normalized: string;
  searchText: string;
  base: string;
  moleculeBase: string;
  baseTokens: string[];
  moleculeBaseTokens: string[];
  signature: string;
  signatureTokens: string[];
  strengths: ParsedStrength[];
  dosageForm: string | null;
  dosageFormGroup: DosageFormGroup | null;
  aliasKey: string | null;
  riskyTransformations: string[];
  transformations: string[];
}

const RISKY_TRANSFORMATIONS: ReadonlySet<string> = new Set([
  "devanagari_transliteration",
  "spoken_number_normalization",
  "salt_normalization",
]);

function findAliasKey(base: string): string | null {
  if (BRAND_ALIASES[base]) return base;

  const baseTokens = base.split(" ").filter(Boolean);
  if (baseTokens.length === 0) return null;

  let best: string | null = null;
  for (const key of Object.keys(BRAND_ALIASES)) {
    const keyTokens = key.split(" ");
    if (keyTokens.length > baseTokens.length) continue;
    const isPrefix = keyTokens.every((token, index) => baseTokens[index] === token);
    if (!isPrefix) continue;
    if (!best || keyTokens.length > best.split(" ").length) best = key;
  }
  return best;
}

function analyzeQuery(query: string): QueryAnalysis {
  const normalizedResult = normalizeMedicineText(query);
  const normalized = normalizedResult.text;
  const tokens = normalized.split(" ").filter(Boolean);

  const extraction = parseStrengthTokens(tokens);
  const dosageForm = findDosageForm(tokens);

  const baseTokens = tokensToBase(tokens, extraction);
  const signatureTokens = tokensToSignature(tokens, extraction);

  const moleculeBaseTokens = baseTokens.filter((token) => !SALT_TOKENS.has(token));
  const transformations = [...normalizedResult.transformations];
  if (moleculeBaseTokens.length !== baseTokens.length) {
    pushUnique(transformations, "salt_normalization");
  }

  const base = baseTokens.join(" ");
  const aliasKey = findAliasKey(base);

  return {
    original: query,
    normalized,
    searchText: normalized,
    base,
    moleculeBase: moleculeBaseTokens.join(" "),
    baseTokens,
    moleculeBaseTokens,
    signature: signatureTokens.join(" "),
    signatureTokens,
    strengths: extraction.strengths,
    dosageForm: dosageForm.form,
    dosageFormGroup: dosageForm.group,
    aliasKey,
    riskyTransformations: transformations.filter((item) =>
      RISKY_TRANSFORMATIONS.has(item),
    ),
    transformations,
  };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      const substitution = previous[j] + (a[i] === b[j] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[b.length];
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Conservative single-token spelling correction against a static vocabulary. */
function correctSpelling(base: string): {
  text: string;
  changed: boolean;
  corrections: string[];
} {
  const tokens = base.split(" ").filter(Boolean);
  const vocabulary = [...COMMON_MEDICINE_TERMS].filter((term) => !term.includes(" "));
  const corrections: string[] = [];
  let changed = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length < 5 || COMMON_MEDICINE_TERMS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;

    let bestTerm: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let tie = false;

    for (const term of vocabulary) {
      if (Math.abs(term.length - token.length) > 2) continue;
      const distance = levenshtein(token, term);
      if (distance > 2) continue;
      if (stringSimilarity(token, term) < 0.8) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTerm = term;
        tie = false;
      } else if (distance === bestDistance) {
        tie = true;
      }
    }

    if (!bestTerm || tie) continue;
    tokens[i] = bestTerm;
    corrections.push(`${token}->${bestTerm}`);
    changed = true;
  }

  return { text: tokens.join(" "), changed, corrections };
}

function strengthText(strengths: ParsedStrength[]): string {
  return strengths
    .map((item) => (item.unit ? `${item.value}${item.unit}` : String(item.value)))
    .join(" ");
}

export interface QueryVariant {
  query: string;
  kind: "original" | "alias" | "spelling" | "base";
  aliasKey: string | null;
  spellingCorrected: boolean;
}

function aliasQueryFor(
  aliasKey: string,
  strengths: ParsedStrength[],
  dosageForm: string | null,
): string {
  return [
    BRAND_ALIASES[aliasKey],
    strengthText(strengths),
    dosageForm ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildQueryVariants(analysis: QueryAnalysis): QueryVariant[] {
  const variants: QueryVariant[] = [];
  const seen = new Set<string>();

  const add = (variant: QueryVariant): void => {
    const key = variant.query.trim().toLowerCase();
    if (key.length < 2 || seen.has(key)) return;
    seen.add(key);
    variants.push({ ...variant, query: variant.query.trim() });
  };

  add({
    query: analysis.searchText,
    kind: "original",
    aliasKey: null,
    spellingCorrected: false,
  });

  const spelling = correctSpelling(analysis.base);
  const correctedSearchText = spelling.changed
    ? [spelling.text, strengthText(analysis.strengths), analysis.dosageForm ?? ""]
        .filter(Boolean)
        .join(" ")
    : null;

  if (correctedSearchText) {
    add({
      query: correctedSearchText,
      kind: "spelling",
      aliasKey: null,
      spellingCorrected: true,
    });
  }

  const aliasBase = spelling.changed ? spelling.text : analysis.base;
  const aliasKey = findAliasKey(aliasBase);
  if (aliasKey) {
    add({
      query: aliasQueryFor(aliasKey, analysis.strengths, analysis.dosageForm),
      kind: "alias",
      aliasKey,
      spellingCorrected: false,
    });
  }

  if (analysis.base && analysis.base !== analysis.searchText) {
    add({
      query: analysis.base,
      kind: "base",
      aliasKey: null,
      spellingCorrected: false,
    });
  }

  return variants.slice(0, 3);
}

interface ProductAnalysis {
  medicine: PharmaDeskMedicine;
  normalizedName: string;
  nameTokens: string[];
  nameBaseTokens: string[];
  nameFuzzyTokens: string[];
  nameBase: string;
  signature: string;
  genericName: string | null;
  genericBase: string;
  compositionComponents: CompositionComponent[];
  compositionTokens: string[];
  strengths: ParsedStrength[];
  dosageForm: string | null;
  dosageFormGroup: DosageFormGroup | null;
}

function dedupeStrengths(items: ParsedStrength[]): ParsedStrength[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.value}|${item.unit ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function analyzeProduct(medicine: PharmaDeskMedicine): ProductAnalysis {
  const normalizedName = normalizeMedicineText(medicine.name).text;
  const nameTokens = normalizedName.split(" ").filter(Boolean);
  const nameExtraction = parseStrengthTokens(nameTokens);
  const nameBaseTokens = tokensToBase(nameTokens, nameExtraction);
  const nameFuzzyTokens = nameBaseTokens.filter((token) => !SALT_TOKENS.has(token));
  const nameSignatureTokens = tokensToSignature(nameTokens, nameExtraction);
  const nameForm = findDosageForm(nameTokens);

  const genericName = medicine.genericName;
  const genericNormalized = genericName ? normalizeMedicineText(genericName).text : "";
  const genericTokens = genericNormalized.split(" ").filter(Boolean);
  const genericExtraction = parseStrengthTokens(genericTokens);
  const genericBase = tokensToBase(genericTokens, genericExtraction)
    .filter((token) => !SALT_TOKENS.has(token))
    .join(" ");

  const compositionComponents = parseCompositionKey(medicine.compositionKey);
  const compositionTokens = [
    ...new Set(
      compositionComponents
        .flatMap((component) =>
          normalizeMedicineText(component.name).text.split(" ").filter(Boolean),
        )
        .filter((token) => !SALT_TOKENS.has(token)),
    ),
  ];

  let strengths: ParsedStrength[] = [];
  for (const component of compositionComponents) {
    if (!component.strength) continue;
    const parsed = parseStrengthTokens(
      normalizeMedicineText(component.strength).text.split(" ").filter(Boolean),
    );
    strengths.push(...parsed.strengths);
  }
  if (strengths.length === 0) strengths = nameExtraction.strengths;
  if (strengths.length === 0 && medicine.strength) {
    strengths = parseStrengthTokens(
      normalizeMedicineText(medicine.strength).text.split(" ").filter(Boolean),
    ).strengths;
  }

  const formNormalized = medicine.dosageForm
    ? normalizeMedicineText(medicine.dosageForm).text
    : "";
  const formExtraction = findDosageForm(formNormalized.split(" ").filter(Boolean));

  return {
    medicine,
    normalizedName,
    nameTokens,
    nameBaseTokens,
    nameFuzzyTokens,
    nameBase: nameBaseTokens.join(" "),
    signature: nameSignatureTokens.join(" "),
    genericName,
    genericBase,
    compositionComponents,
    compositionTokens:
      compositionTokens.length > 0
        ? compositionTokens
        : genericBase.split(" ").filter(Boolean),
    strengths: dedupeStrengths(strengths),
    dosageForm: medicine.dosageForm,
    dosageFormGroup: formExtraction.group ?? nameForm.group,
  };
}

function tokenSetSimilarity(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const targetToken of targetTokens) {
      if (queryToken === targetToken) {
        best = 1;
        break;
      }
      best = Math.max(best, stringSimilarity(queryToken, targetToken));
    }
    if (best >= 0.8) total += best;
  }
  return total / queryTokens.length;
}

function containsAll(queryTokens: string[], targetTokens: string[]): boolean {
  if (queryTokens.length === 0) return false;
  return queryTokens.every((token) => targetTokens.includes(token));
}

function approximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

/** Compares requested strength values with catalogue strength values. */
export function compareStrengths(
  queryStrengths: ParsedStrength[],
  productStrengths: ParsedStrength[],
): StrengthComparison {
  if (queryStrengths.length === 0 || productStrengths.length === 0) {
    return {
      queryStrengths,
      productStrengths,
      match: null,
      matchedBy: null,
    };
  }

  const remaining = [...productStrengths];
  let allMatched = true;
  let matchedBy: "component" | "sum" | "none" = "none";

  for (const query of queryStrengths) {
    const componentIndex = remaining.findIndex(
      (product) =>
        (query.unit === null || product.unit === null || query.unit === product.unit) &&
        approximatelyEqual(query.value, product.value),
    );
    if (componentIndex >= 0) {
      remaining.splice(componentIndex, 1);
      if (matchedBy === "none") matchedBy = "component";
      continue;
    }

    // "Augmentin 625" is one strength in speech but two catalogue components.
    const sameUnit = productStrengths.every(
      (product) => product.unit === productStrengths[0].unit,
    );
    if (queryStrengths.length === 1 && productStrengths.length > 1 && sameUnit) {
      const sum = productStrengths.reduce((total, item) => total + item.value, 0);
      const unitCompatible =
        query.unit === null ||
        productStrengths[0].unit === null ||
        query.unit === productStrengths[0].unit;
      if (unitCompatible && approximatelyEqual(query.value, sum)) {
        matchedBy = "sum";
        continue;
      }
    }

    allMatched = false;
  }

  return {
    queryStrengths,
    productStrengths,
    match: allMatched,
    matchedBy: allMatched ? matchedBy : "none",
  };
}

function compareDosageForms(
  analysis: QueryAnalysis,
  product: ProductAnalysis,
): DosageFormComparison {
  if (!analysis.dosageFormGroup || !product.dosageFormGroup) {
    return {
      query: analysis.dosageForm,
      product: product.dosageForm,
      match: null,
    };
  }
  return {
    query: analysis.dosageForm,
    product: product.dosageForm,
    match: analysis.dosageFormGroup === product.dosageFormGroup,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatStrengthList(items: ParsedStrength[]): string {
  return items.length > 0 ? items.map((item) => item.text).join(" + ") : "not published";
}

function buildGenericComposition(
  medicine: PharmaDeskMedicine,
  components: CompositionComponent[],
): string | null {
  if (medicine.genericName) return medicine.genericName;
  if (components.length === 0) return null;
  return components
    .map((component) =>
      component.strength
        ? `${component.name} ${component.strength}`
        : component.name,
    )
    .join(" + ");
}

interface ScoredCandidate {
  result: MedicineMatchCandidate;
  rejected: boolean;
  exactFullName: boolean;
  exactSignature: boolean;
  exactGeneric: boolean;
}

function scoreCandidate(
  analysis: QueryAnalysis,
  medicine: PharmaDeskMedicine,
  variant: QueryVariant,
): ScoredCandidate | null {
  const product = analyzeProduct(medicine);

  const exactFullName =
    analysis.normalized.length > 0 && analysis.normalized === product.normalizedName;
  const exactSignature =
    analysis.signature.length > 0 && analysis.signature === product.signature;
  const exactGeneric =
    analysis.moleculeBase.length > 0 && analysis.moleculeBase === product.genericBase;

  let nameSimilarity = 0;
  if (exactFullName || exactSignature) {
    nameSimilarity = 1;
  } else if (analysis.moleculeBaseTokens.length > 0) {
    const tokenScore = tokenSetSimilarity(
      analysis.moleculeBaseTokens,
      product.nameFuzzyTokens,
    );
    const wholeScore = stringSimilarity(analysis.moleculeBase, product.nameBase);
    const containment = containsAll(analysis.moleculeBaseTokens, product.nameTokens)
      ? 0.95
      : 0;
    nameSimilarity = Math.max(tokenScore, wholeScore * 0.9, containment);
  }

  const genericSimilarity = exactGeneric
    ? 1
    : Math.max(
        tokenSetSimilarity(analysis.moleculeBaseTokens, product.genericBase.split(" ")),
        stringSimilarity(analysis.moleculeBase, product.genericBase) * 0.9,
      );

  const compositionSimilarity = tokenSetSimilarity(
    analysis.moleculeBaseTokens,
    product.compositionTokens,
  );

  let baseScore = exactFullName || exactSignature
    ? 1
    : 0.55 * nameSimilarity + 0.25 * genericSimilarity + 0.2 * compositionSimilarity;

  const strengthComparison = compareStrengths(analysis.strengths, product.strengths);
  const dosageFormComparison = compareDosageForms(analysis, product);

  const penalties: string[] = [];
  let rejected = false;

  if (strengthComparison.match === false) {
    baseScore *= 0.25;
    penalties.push("strength_mismatch");
    rejected = true;
  }
  if (dosageFormComparison.match === false) {
    baseScore *= 0.4;
    penalties.push("dosage_form_mismatch");
    rejected = true;
  }

  if (!rejected && !exactFullName && !exactSignature && baseScore < 0.35) {
    return null;
  }
  if (rejected && nameSimilarity < 0.5) return null;

  const deterministic =
    !rejected &&
    (exactFullName || exactSignature) &&
    analysis.riskyTransformations.length === 0 &&
    !variant.aliasKey &&
    !variant.spellingCorrected;

  const matchedFields: string[] = [];
  if (exactFullName) matchedFields.push("name");
  else if (exactSignature) matchedFields.push("name_signature");
  if (exactGeneric) matchedFields.push("genericName");
  if (strengthComparison.match === true) matchedFields.push("strength");
  if (dosageFormComparison.match === true) matchedFields.push("dosageForm");
  if (compositionSimilarity >= 0.99) matchedFields.push("composition");
  if (variant.aliasKey) matchedFields.push("alias");
  if (variant.spellingCorrected) matchedFields.push("spelling");

  let reason: string;
  if (strengthComparison.match === false) {
    reason = `Strength mismatch: requested ${formatStrengthList(
      analysis.strengths,
    )}; catalogue shows ${formatStrengthList(product.strengths)}.`;
  } else if (dosageFormComparison.match === false) {
    reason = `Dosage form mismatch: requested ${
      analysis.dosageForm ?? "unknown"
    }; catalogue shows ${product.dosageForm ?? "unknown"}.`;
  } else if (exactFullName) {
    reason = "Exact product name match.";
  } else if (exactSignature) {
    reason = "Exact product name and strength match.";
  } else if (variant.aliasKey) {
    reason = `Brand alias "${variant.aliasKey}" was used as a search hint; verify the product.`;
  } else if (variant.spellingCorrected) {
    reason = "Spelling was corrected for search; verify the product.";
  } else if (exactGeneric) {
    reason = "Generic composition matches, but product selection is not deterministic.";
  } else {
    reason = "Fuzzy candidate; verify the product before use.";
  }

  const composition = product.compositionComponents;

  const result: MedicineMatchCandidate = {
    matchStatus: "ambiguous",
    confidence: round3(baseScore),
    reason,
    canonicalName: medicine.name,
    brand: null,
    genericName: medicine.genericName,
    genericComposition: buildGenericComposition(medicine, composition),
    composition: composition.length > 0 ? composition : null,
    strength: medicine.strength,
    dosageForm: medicine.dosageForm,
    route: medicine.route,
    manufacturer: medicine.manufacturer,
    packSize: medicine.packSize,
    prescriptionOnly: medicine.prescriptionOnly,
    schedule: medicine.schedule,
    market: medicine.market,
    apiId: medicine.id,
    productStatus: medicine.status,
    compositionKey: medicine.compositionKey,
    source: medicine.source,
    firstSeenAt: medicine.firstSeenAt,
    lastSeenAt: medicine.lastSeenAt,
    deterministic,
    aliasUsed: variant.aliasKey,
    spellingCorrected: variant.spellingCorrected,
    strengthComparison,
    dosageFormComparison,
    score: {
      nameSimilarity: round3(nameSimilarity),
      genericSimilarity: round3(genericSimilarity),
      compositionSimilarity: round3(compositionSimilarity),
      baseScore: round3(baseScore),
      penalties,
    },
    matchedFields,
  };

  return {
    result,
    rejected,
    exactFullName,
    exactSignature,
    exactGeneric,
  };
}

interface FinalizedCandidates {
  status: MedicineMatchStatus;
  results: MedicineMatchCandidate[];
}

function finalizeCandidates(candidates: ScoredCandidate[]): FinalizedCandidates {
  const sorted = [...candidates].sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1;
    return b.result.confidence - a.result.confidence;
  });

  const eligible = sorted.filter(
    (candidate) => !candidate.rejected && candidate.result.confidence >= 0.5,
  );
  const rejected = sorted.filter(
    (candidate) => candidate.rejected || candidate.result.confidence < 0.5,
  );

  let status: MedicineMatchStatus = "unmatched";

  if (eligible.length === 0) {
    for (const candidate of rejected) {
      candidate.result.matchStatus = "unmatched";
      candidate.result.confidence = Math.min(candidate.result.confidence, 0.5);
    }
    status = "unmatched";
  } else {
    const deterministic = eligible.filter((candidate) => candidate.result.deterministic);

    if (deterministic.length === 1) {
      const chosen = deterministic[0];
      const close = eligible.filter(
        (candidate) =>
          candidate !== chosen &&
          candidate.result.confidence >= chosen.result.confidence - 0.08,
      );

      if (close.length === 0) {
        chosen.result.matchStatus = "matched";
        chosen.result.confidence = Math.max(0.95, chosen.result.confidence);
        chosen.result.reason = "Exact product name match.";
        for (const candidate of eligible) {
          if (candidate === chosen) continue;
          candidate.result.matchStatus = "ambiguous";
          candidate.result.confidence = Math.min(candidate.result.confidence, 0.75);
        }
        status = "matched";
      } else {
        for (const candidate of eligible) {
          candidate.result.matchStatus = "ambiguous";
          candidate.result.confidence = Math.min(candidate.result.confidence, 0.75);
          candidate.result.reason =
            "Multiple products match the requested name and strength; choose explicitly.";
        }
        status = "ambiguous";
      }
    } else if (deterministic.length > 1) {
      for (const candidate of eligible) {
        candidate.result.matchStatus = "ambiguous";
        candidate.result.confidence = Math.min(candidate.result.confidence, 0.75);
        candidate.result.reason =
          "Multiple products have an exact name match; choose explicitly.";
      }
      status = "ambiguous";
    } else if (eligible.length === 1) {
      const only = eligible[0];
      only.result.matchStatus =
        only.result.confidence >= 0.7 ? "suggested" : "ambiguous";
      only.result.confidence = Math.min(
        only.result.confidence,
        only.result.matchStatus === "suggested" ? 0.85 : 0.75,
      );
      status = only.result.matchStatus;
    } else {
      const gap = eligible[0].result.confidence - eligible[1].result.confidence;
      if (gap < 0.08) {
        for (const candidate of eligible) {
          candidate.result.matchStatus = "ambiguous";
          candidate.result.confidence = Math.min(candidate.result.confidence, 0.75);
          candidate.result.reason =
            "Multiple products are plausible matches; choose explicitly.";
        }
        status = "ambiguous";
      } else {
        const best = eligible[0];
        best.result.matchStatus = "suggested";
        best.result.confidence = Math.min(best.result.confidence, 0.85);
        for (const candidate of eligible.slice(1)) {
          candidate.result.matchStatus = "ambiguous";
          candidate.result.confidence = Math.min(candidate.result.confidence, 0.75);
          candidate.result.reason =
            "Multiple products are plausible matches; choose explicitly.";
        }
        status = "ambiguous";
      }
    }

    for (const candidate of rejected) {
      candidate.result.matchStatus = "unmatched";
      candidate.result.confidence = Math.min(candidate.result.confidence, 0.5);
    }
  }

  return {
    status,
    results: sorted.map((candidate) => candidate.result),
  };
}

function buildNotices(
  analysis: QueryAnalysis,
  results: MedicineMatchCandidate[],
  status: MedicineMatchStatus,
): string[] {
  const notices: string[] = [
    "PharmaDesk does not publish a separate brand field; canonicalName is the catalogue product name.",
    "Catalogue strength and route are product metadata, not a prescribed dose. Dosage instructions must come from the original conversation.",
    "Reference data is licensed for transient display only; do not persist or redistribute it.",
  ];

  if (analysis.riskyTransformations.includes("spoken_number_normalization")) {
    notices.push("Spoken numbers were normalised for search only; verify the strength.");
  }
  if (analysis.riskyTransformations.includes("devanagari_transliteration")) {
    notices.push(
      "Hindi/Devanagari text was transliterated for search only; verify the medicine name.",
    );
  }
  if (results.some((result) => result.aliasUsed)) {
    notices.push(
      "A curated brand alias was used as a search hint. It is not a verified clinical equivalence.",
    );
  }
  if (results.some((result) => result.spellingCorrected)) {
    notices.push("Spelling was corrected for search only; verify the medicine name.");
  }

  const strengthRejected = results.filter(
    (result) =>
      result.matchStatus === "unmatched" &&
      result.strengthComparison.match === false,
  ).length;
  if (strengthRejected > 0) {
    notices.push(
      `${strengthRejected} candidate(s) were rejected because the strength did not match.`,
    );
  }

  const formRejected = results.filter(
    (result) =>
      result.matchStatus === "unmatched" &&
      result.dosageFormComparison.match === false,
  ).length;
  if (formRejected > 0) {
    notices.push(
      `${formRejected} candidate(s) were rejected because the dosage form did not match.`,
    );
  }

  if (status === "ambiguous") {
    notices.push("No medicine was selected automatically; choose from the candidates.");
  }
  if (results.length === 0) {
    notices.push(
      "No catalogue match was found. Do not substitute a medicine based on similarity alone.",
    );
  }

  return notices;
}

/** Input validation error for the HTTP layer. */
export class MedicineSearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MedicineSearchInputError";
  }
}

export interface ValidatedMedicineSearchRequest {
  query: string;
  market: MedicineMarket;
  limit: number;
}

export function validateMedicineSearchRequest(
  input: unknown,
): ValidatedMedicineSearchRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MedicineSearchInputError("Request body must be a JSON object.");
  }

  const body = input as Record<string, unknown>;
  if (typeof body.query !== "string") {
    throw new MedicineSearchInputError("query must be a string.");
  }

  const query = body.query.trim();
  if (query.length < 2) {
    throw new MedicineSearchInputError("query must be at least 2 characters.");
  }
  if (query.length > 300) {
    throw new MedicineSearchInputError("query must be at most 300 characters.");
  }

  let market: MedicineMarket = "IN";
  if (body.market !== undefined && body.market !== null) {
    if (typeof body.market !== "string") {
      throw new MedicineSearchInputError("market must be a string.");
    }
    const upper = body.market.toUpperCase();
    if (!(MEDICINE_MARKETS as readonly string[]).includes(upper)) {
      throw new MedicineSearchInputError(
        `market must be one of: ${MEDICINE_MARKETS.join(", ")}.`,
      );
    }
    market = upper as MedicineMarket;
  }

  let limit = Math.min(50, Math.max(1, config.medicine.defaultLimit));
  if (body.limit !== undefined && body.limit !== null) {
    if (
      typeof body.limit !== "number" ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > 50
    ) {
      throw new MedicineSearchInputError(
        "limit must be an integer between 1 and 50.",
      );
    }
    limit = body.limit;
  }

  return { query, market, limit };
}

/**
 * Analyse the query, search one or more conservative variants, score every
 * candidate, and return the ranked list without auto-selecting a medicine.
 */
export async function searchMedicineMatches(
  input: unknown,
  deps: MedicineSearchDependencies = {},
): Promise<MedicineSearchResponse> {
  const request = validateMedicineSearchRequest(input);
  const analysis = analyzeQuery(request.query);
  const search = deps.search ?? searchPharmaDesk;
  const apiLimit = Math.min(100, Math.max(10, request.limit));
  const variants = buildQueryVariants(analysis);

  const merged = new Map<number, ScoredCandidate>();
  let disclaimer: string | null = null;
  let firstError: unknown = null;

  for (const variant of variants) {
    const variantAnalysis = analyzeQuery(variant.query);
    const scoringAnalysis: QueryAnalysis = {
      ...variantAnalysis,
      original: request.query,
      strengths:
        analysis.strengths.length > 0
          ? analysis.strengths
          : variantAnalysis.strengths,
      dosageForm: analysis.dosageForm ?? variantAnalysis.dosageForm,
      dosageFormGroup:
        analysis.dosageFormGroup ?? variantAnalysis.dosageFormGroup,
      riskyTransformations: [
        ...new Set([
          ...analysis.riskyTransformations,
          ...variantAnalysis.riskyTransformations,
          ...(variant.aliasKey ? ["alias_expansion"] : []),
          ...(variant.spellingCorrected ? ["spelling_correction"] : []),
        ]),
      ],
    };

    let response: PharmaDeskSearchResponse;
    try {
      response = await search(variant.query, {
        market: request.market,
        limit: apiLimit,
      });
    } catch (error) {
      if (merged.size === 0) {
        firstError = error;
        break;
      }
      logger.warn("Medicine variant search failed; using earlier candidates", {
        query: variant.query,
        error: (error as Error).message,
      });
      break;
    }

    disclaimer = response.disclaimer ?? disclaimer;

    for (const medicine of response.results) {
      const scored = scoreCandidate(scoringAnalysis, medicine, variant);
      if (!scored) continue;
      const existing = merged.get(medicine.id);
      if (!existing || scored.result.confidence > existing.result.confidence) {
        merged.set(medicine.id, scored);
      }
    }

    const best = [...merged.values()]
      .filter((candidate) => !candidate.rejected)
      .reduce((max, candidate) => Math.max(max, candidate.result.confidence), 0);
    if (best >= 0.85) break;
  }

  if (firstError && merged.size === 0) throw firstError;

  const finalized = finalizeCandidates([...merged.values()]);
  const results = finalized.results.slice(0, request.limit);
  const notices = buildNotices(analysis, results, finalized.status);

  return {
    ok: true,
    query: request.query,
    normalizedQuery: analysis.normalized,
    market: request.market,
    status: finalized.status,
    count: results.length,
    results,
    notices,
    disclaimer,
  };
}
