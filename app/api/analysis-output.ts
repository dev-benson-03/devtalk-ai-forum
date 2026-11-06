/**
 * Strict validation of AI analysis output, used for fresh model output and
 * for cached entries before they are served. Anything that does not match
 * exactly is rejected; nothing is filtered, padded or invented.
 */

export const ANALYSIS_OUTPUT_LIMITS = {
  summaryMinChars: 10,
  summaryMaxChars: 1_500,
  roadmapSteps: 3,
  stepMinChars: 3,
  stepMaxChars: 300,
} as const;

export interface AnalysisText {
  summary: string;
  actionRoadmap: string[];
}

/** Has at least one letter, so "...", "1️⃣ ..." or "???" don't count as content. */
const HAS_LETTER = /\p{L}/u;

function meaningful(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || !HAS_LETTER.test(trimmed)) return null;
  return trimmed;
}

/** Validates { summary, actionRoadmap }; returns trimmed copies or null. */
export function validateAnalysisText(value: unknown): AnalysisText | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { summary, actionRoadmap } = value as Record<string, unknown>;
  const L = ANALYSIS_OUTPUT_LIMITS;
  const cleanSummary = meaningful(summary, L.summaryMinChars, L.summaryMaxChars);
  if (!cleanSummary || !Array.isArray(actionRoadmap) || actionRoadmap.length !== L.roadmapSteps) return null;
  const steps = actionRoadmap.map((step) => meaningful(step, L.stepMinChars, L.stepMaxChars));
  if (steps.some((step) => step === null)) return null;
  return { summary: cleanSummary, actionRoadmap: steps as string[] };
}

/**
 * Parses the model's reply: optional ```json fences around a single JSON
 * object. Returns null for anything that does not validate.
 */
export function parseModelAnalysis(aiResponse: string): AnalysisText | null {
  const cleaned = aiResponse.replace(/```(?:json)?/gi, "").trim();
  try {
    return validateAnalysisText(JSON.parse(cleaned)); // the whole reply is JSON
  } catch {
    // not pure JSON: fall back to the outermost {...} block
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return validateAnalysisText(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return null;
  }
}
