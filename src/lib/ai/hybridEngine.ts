import {
  AI,
  type Content,
  HybridParams,
  InferenceMode,
  InferenceSource,
  type Part,
  ResponseModality,
  Schema,
  getGenerativeModel,
  getTemplateGenerativeModel,
} from "firebase/ai";
import { getToken as getAppCheckToken } from "firebase/app-check";
import {
  ai as firebaseAiSingleton,
  appCheck as exportedAppCheck,
  initFirebaseAppCheck,
} from "@/lib/firebase/config";
import { normalizeImageForInlineData } from "@/lib/ai/imageCompression";
import {
  CloudAuditResult,
  FieldDomain,
  FieldLog,
  InlineMediaInput,
  LocalTriageResult,
  RemoteConfigValues,
} from "@/types/terrapulse";

let deviceModelInitialized = false;

function getHybridAI(): AI {
  if (typeof window !== "undefined") {
    initFirebaseAppCheck();
  }
  return firebaseAiSingleton;
}

const OFFLINE_SDK_FALLBACK_TIMEOUT_MS = 15_000;
const LOCAL_NANO_MAX_INPUT_CHARS = 550;
const DEFAULT_CLOUD_MODEL = "gemini-3.8-flash";
const FALLBACK_CLOUD_MODEL = "gemini-3.5-flash-lite";
const TERTIARY_CLOUD_MODEL = "gemini-2.5-flash";
const CLOUD_FALLBACK_CHAIN = [
  DEFAULT_CLOUD_MODEL,
  FALLBACK_CLOUD_MODEL,
  TERTIARY_CLOUD_MODEL,
] as const;

function isRetryableCloudError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("500") ||
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("404") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("occupied") ||
    msg.includes("busy") ||
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("not found") ||
    msg.includes("not_found") ||
    msg.includes("model not found")
  );
}

function buildCloudModelChain(preferredModel?: string): string[] {
  const primary = preferredModel?.trim() || DEFAULT_CLOUD_MODEL;
  const chain = [primary, ...CLOUD_FALLBACK_CHAIN];
  return Array.from(new Set(chain));
}

let appCheckForceRefreshedOnce = false;

/**
 * Forces Firebase App Check to discard any stale/pre-registration IndexedDB token
 * and exchange the active debug/reCAPTCHA credential for a fresh valid token.
 */
export async function ensureFreshAppCheckToken(
  forceRefresh = true
): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const instance = exportedAppCheck ?? initFirebaseAppCheck();
  if (!instance) return null;
  const shouldForce = forceRefresh || !appCheckForceRefreshedOnce;
  const res = await getAppCheckToken(instance, shouldForce);
  appCheckForceRefreshedOnce = true;
  return res.token;
}

function isInvalidAppCheckTokenError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("app check token is invalid") ||
    msg.includes("app-check-token") ||
    msg.includes("appcheck")
  );
}

async function runCloudWithFallbackChain<T>(params: {
  label: string;
  preferredModel?: string;
  execute: (modelName: string) => Promise<T>;
}): Promise<{ result: T; modelUsed: string }> {
  const chain = buildCloudModelChain(params.preferredModel);
  let lastErr: unknown;
  let retriedAppCheck = false;

  for (let i = 0; i < chain.length; i++) {
    const modelName = chain[i];
    const nextModel = chain[i + 1];
    try {
      const result = await params.execute(modelName);
      return { result, modelUsed: modelName };
    } catch (err) {
      lastErr = err;
      if (!retriedAppCheck && isInvalidAppCheckTokenError(err)) {
        retriedAppCheck = true;
        try {
          await ensureFreshAppCheckToken(true);
          i -= 1; // retry the same model with the freshly exchanged App Check token
          continue;
        } catch {
          // proceed to normal error handling
        }
      }
      if (nextModel && isRetryableCloudError(err)) {
        console.warn(
          `[Cloud Router] Model busy/occupied, switching immediately to next available model... (${params.label}: ${modelName} -> ${nextModel})`,
          err
        );
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

function isMultimodalUnsupportedError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("notsupported") ||
    msg.includes("unsupported") ||
    msg.includes("multimodal") ||
    msg.includes("image") ||
    msg.includes("expectedinputs") ||
    msg.includes("modality") ||
    msg.includes("cannot be created") ||
    msg.includes("not supported")
  );
}

function isQuotaExceededError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("quotaexceeded") ||
    msg.includes("input is too large") ||
    msg.includes("too large") ||
    msg.includes("context window") ||
    msg.includes("context length") ||
    msg.includes("token limit") ||
    msg.includes("exceeds the maximum")
  );
}

const COMPACT_SYSTEM_PROMPTS: Record<FieldDomain, string> = {
  agri: "Agronomy & livestock field triage copilot. Analyze symptoms and give a concise offline containment step for voice readout.",
  construction:
    "Civil & construction site safety copilot. Classify structural defects and give a concise offline safety step for voice readout.",
};

function getCompactOnDeviceSystemPrompt(
  domain: FieldDomain,
  remotePrompt?: string
): string {
  const trimmed = remotePrompt?.trim();
  if (trimmed && trimmed.length <= 200) {
    return trimmed;
  }
  return COMPACT_SYSTEM_PROMPTS[domain];
}

/**
 * Caps multi-turn chat/voice history to the last `maxPairs` user+assistant turns
 * so on-device Gemini Nano never overflows its local context window.
 */
export function trimChatHistoryPairs<T>(messages: T[], maxPairs = 2): T[] {
  const maxMessages = Math.max(2, maxPairs * 2);
  return messages.length > maxMessages
    ? messages.slice(messages.length - maxMessages)
    : messages;
}

export interface DeviceModelInitResult {
  initialized: boolean;
  state: NanoAvailabilityState;
  message: string;
}

/**
 * Must be invoked inside a user gesture (e.g. "Launch Live Demo",
 * "Run Instant Triage", or "Warm Up / Check Edge Model") so Chrome's
 * Prompt API can initialize or download Gemini Nano weights.
 * Uses a fresh ephemeral GenerativeModel instance (never shared across submissions).
 */
export async function ensureDeviceModelInitialized(
  onProgress?: (pct: number) => void
): Promise<DeviceModelInitResult> {
  if (typeof window === "undefined") {
    return {
      initialized: false,
      state: "unsupported",
      message: "On-device model initialization is only available in the browser.",
    };
  }

  console.log("[AI Engine] Checking/Initializing device model (ensureDeviceModelInitialized)...");
  try {
    const ai = getHybridAI();
    const runInit = async (includeImageInput: boolean) => {
      const ephemeralModel = getGenerativeModel(ai, {
        mode: InferenceMode.PREFER_ON_DEVICE,
        onDeviceParams: {
          createOptions: {
            expectedInputs: includeImageInput
              ? [{ type: "text" }, { type: "image" }]
              : [{ type: "text" }],
          },
        },
        inCloudParams: {
          model: "gemini-3.8-flash",
        },
      });

      await ephemeralModel.initializeDeviceModel((val) => {
        const pct = Math.round(val * 10000) / 100;
        console.log(`[AI Engine] Gemini Nano download progress: ${pct}%`);
        onProgress?.(pct);
      });
    };

    try {
      await runInit(true);
    } catch (multimodalInitErr) {
      if (isMultimodalUnsupportedError(multimodalInitErr)) {
        console.warn(
          "[AI Engine] Local Nano GPU session is text-only (image_input=0); warming up text-only session instead:",
          multimodalInitErr
        );
        await runInit(false);
      } else {
        throw multimodalInitErr;
      }
    }

    deviceModelInitialized = true;
    const state = await checkNanoAvailability();
    console.log("[AI Engine] Device model warm-up complete:", { state, deviceModelInitialized });
    return {
      initialized: state === "available" || deviceModelInitialized,
      state,
      message:
        state === "available"
          ? "Chrome Gemini Nano initialized and ready for 0 KB offline triage."
          : `Device model check completed (browser status: ${state}). Cloud fallback stays armed online.`,
    };
  } catch (err) {
    console.error("[AI Engine] Device model initialization error:", err);
    const state = await checkNanoAvailability();
    return {
      initialized: false,
      state,
      message:
        err instanceof Error
          ? err.message
          : "On-device Gemini Nano unavailable in this browser; online requests will use Cloud Fallback.",
    };
  }
}

export type NanoAvailabilityState =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable"
  | "unsupported";

type ChromeExpectedModality = {
  type: "text" | "image" | "audio";
  languages?: string[];
};

type ChromePromptContentItem =
  | { type: "text"; value: string }
  | { type: "image"; value: Blob | ImageBitmap };

type ChromePromptInput =
  | string
  | Array<{
      role: "user";
      content: ChromePromptContentItem[];
    }>;

interface ChromeLanguageModelCreateOptions {
  expectedInputs?: ChromeExpectedModality[];
  expectedOutputs?: ChromeExpectedModality[];
  initialPrompts?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

interface ChromeLanguageModelSession {
  prompt: (
    input: ChromePromptInput,
    options?: { responseConstraint?: object }
  ) => Promise<string>;
  promptStreaming?: (input: ChromePromptInput) => AsyncIterable<string>;
  destroy?: () => void;
}

interface ChromeLanguageModelStatic {
  availability?: (
    options?: ChromeLanguageModelCreateOptions
  ) => Promise<string>;
  create?: (
    options?: ChromeLanguageModelCreateOptions
  ) => Promise<ChromeLanguageModelSession>;
}

interface ChromeLanguageModelGlobal {
  LanguageModel?: ChromeLanguageModelStatic;
}

const MULTIMODAL_NANO_OPTIONS: ChromeLanguageModelCreateOptions = {
  expectedInputs: [
    { type: "text", languages: ["en"] },
    { type: "image" },
  ],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function getNativeChromeLanguageModel(): ChromeLanguageModelStatic | null {
  if (typeof window === "undefined") return null;
  const lm = (window as unknown as ChromeLanguageModelGlobal).LanguageModel;
  return lm ?? null;
}

export async function checkLocalMultimodalAvailability(): Promise<NanoAvailabilityState> {
  if (typeof window === "undefined") return "unsupported";
  try {
    const lm = getNativeChromeLanguageModel();
    if (!lm?.availability) return "unsupported";
    const status = (await lm.availability(MULTIMODAL_NANO_OPTIONS)).toLowerCase();
    if (status === "available" || status === "readily") return "available";
    if (status === "downloadable" || status === "after-download")
      return "downloadable";
    if (status === "downloading") return "downloading";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

async function runDirectChromeLanguageModel(params: {
  systemPrompt: string;
  userPrompt: string;
  imageInlineData?: { data: string; mimeType: string } | null;
  onStreamChunk?: (accumulatedText: string) => void;
}): Promise<string> {
  const lm = getNativeChromeLanguageModel();
  if (!lm?.create) {
    throw new Error(
      "Chrome native LanguageModel API is unavailable in this browser."
    );
  }

  const withImage = Boolean(params.imageInlineData);
  console.log(
    `[AI Engine] Creating direct Chrome LanguageModel local session (${
      withImage ? "multimodal text+image" : "text-only"
    }, 0 KB offline)...`
  );

  const createOptions: ChromeLanguageModelCreateOptions = withImage
    ? {
        ...MULTIMODAL_NANO_OPTIONS,
        initialPrompts: [{ role: "system", content: params.systemPrompt }],
      }
    : {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: params.systemPrompt }],
      };

  // Allow cold-start on-device model loading to complete naturally without artificial timeout
  const session = await lm.create(createOptions);

  try {
    let promptInput: ChromePromptInput = params.userPrompt;
    if (params.imageInlineData) {
      const res = await fetch(
        `data:${params.imageInlineData.mimeType};base64,${params.imageInlineData.data}`
      );
      const imageBlob = await res.blob();
      const imageValue =
        typeof createImageBitmap === "function"
          ? await createImageBitmap(imageBlob)
          : imageBlob;

      promptInput = [
        {
          role: "user",
          content: [
            { type: "text", value: params.userPrompt },
            { type: "image", value: imageValue },
          ],
        },
      ];
    }

    if (typeof session.promptStreaming === "function") {
      let accumulated = "";
      const iterable = session.promptStreaming(promptInput);
      for await (const piece of iterable) {
        if (!piece) continue;
        if (accumulated && piece.startsWith(accumulated)) {
          accumulated = piece;
        } else {
          accumulated += piece;
        }
        params.onStreamChunk?.(accumulated);
      }
      return accumulated.trim();
    }

    const full = await session.prompt(promptInput);
    params.onStreamChunk?.(full);
    return full.trim();
  } finally {
    try {
      session.destroy?.();
      console.log("[AI Engine] Direct Chrome LanguageModel session destroyed.");
    } catch {
      // ignore destroy errors
    }
  }
}

export async function checkNanoAvailability(): Promise<NanoAvailabilityState> {
  if (typeof window === "undefined") return "unsupported";
  try {
    const lm = getNativeChromeLanguageModel();
    if (!lm?.availability) return "unsupported";
    const status = (await lm.availability()).toLowerCase();
    if (status === "available" || status === "readily") return "available";
    if (status === "downloadable" || status === "after-download")
      return "downloadable";
    if (status === "downloading") return "downloading";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export interface FieldTriageOutput {
  title: string;
  isActionableFieldIssue: boolean;
  conversationalReply?: string;
  localTriage: LocalTriageResult;
}

interface RawTriageJson {
  title?: unknown;
  issue?: unknown;
  heading?: unknown;
  summary?: unknown;
  diagnosis?: unknown;
  description?: unknown;
  analysis?: unknown;
  severity?: unknown;
  risk?: unknown;
  priority?: unknown;
  confidence?: unknown;
  score?: unknown;
  immediateAction?: unknown;
  immediate_action?: unknown;
  action?: unknown;
  recommendation?: unknown;
  containment?: unknown;
  extractedTags?: unknown;
  extracted_tags?: unknown;
  tags?: unknown;
  keywords?: unknown;
  needsCloudDeepAudit?: unknown;
  needs_cloud_deep_audit?: unknown;
}

function tryParseJsonCandidate<T>(candidate: string): T | null {
  const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1").trim();
  try {
    const parsed: unknown = JSON.parse(withoutTrailingCommas);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return candidates;
}

function repairTruncatedJson<T>(text: string): T | null {
  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) return null;

  let fragment = text.slice(firstBrace).trim();
  // Remove trailing incomplete backslash escape
  if (fragment.endsWith("\\")) {
    fragment = fragment.slice(0, -1);
  }

  let inString = false;
  let escaped = false;
  const stack: Array<"{" | "["> = [];

  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" && stack[stack.length - 1] === "{") {
      stack.pop();
    } else if (ch === "]" && stack[stack.length - 1] === "[") {
      stack.pop();
    }
  }

  if (inString) {
    fragment += '"';
  }

  // Strip trailing dangling comma, colon, or unfinished key without value
  fragment = fragment
    .replace(/,\s*"[^"]*"\s*:\s*$/, "")
    .replace(/,\s*"[^"]*"\s*$/, "")
    .replace(/:\s*$/, ': ""')
    .replace(/,\s*$/, "");

  for (let i = stack.length - 1; i >= 0; i--) {
    fragment += stack[i] === "{" ? "}" : "]";
  }

  return tryParseJsonCandidate<T>(fragment);
}

function extractJsonObject<T>(rawText: string): T {
  const cleaned = rawText
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const direct = tryParseJsonCandidate<T>(cleaned);
  if (direct) return direct;

  // Scan all balanced {...} blocks from last to first (handles models that echo prose
  // or a template before outputting the actual JSON response)
  const candidates = extractBalancedJsonObjects(cleaned);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = tryParseJsonCandidate<T>(candidates[i]);
    if (parsed) return parsed;
  }

  // Repair truncated JSON if Nano hit its output token limit mid-response
  const repaired = repairTruncatedJson<T>(cleaned);
  if (repaired) {
    console.warn("[AI Engine] Repaired truncated JSON output cleanly.");
    return repaired;
  }

  throw new Error(
    `Model returned invalid JSON output: ${cleaned.slice(0, 140)}${cleaned.length > 140 ? "..." : ""}`
  );
}

function pickNonEmptyString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function parseConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(
      1,
      Math.min(100, value <= 1 ? Math.round(value * 100) : Math.round(value))
    );
  }
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric)) {
      return Math.max(
        1,
        Math.min(100, numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric))
      );
    }
  }
  return 85;
}

function normalizeSeverity(value: unknown): "low" | "medium" | "critical" {
  const str = typeof value === "string" ? value.toLowerCase() : "";
  if (str === "critical" || str === "high") return "critical";
  if (str === "medium" || str === "caution" || str === "moderate") return "medium";
  return "low";
}

function normalizeTags(value: unknown, domain: FieldDomain): string[] {
  if (!Array.isArray(value)) {
    return domain === "agri"
      ? ["#agronomy-triage", "#field-log"]
      : ["#site-inspection", "#structural-check"];
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 5)
    .map((tag) => {
      const slug = tag
        .trim()
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9-]+/g, "-");
      return `#${slug}`;
    })
    .filter((tag) => tag.length > 1);

  return normalized.length > 0
    ? normalized
    : domain === "agri"
      ? ["#agronomy-triage"]
      : ["#site-ops"];
}

function parseLabeledTriageResponse(params: {
  rawText: string;
  fallbackObservation: string;
  domain: FieldDomain;
}): {
  title: string;
  isActionableFieldIssue: boolean;
  conversationalReply?: string;
  summary: string;
  severity: "low" | "medium" | "critical";
  confidence: number;
  immediateAction: string;
  extractedTags: string[];
  needsCloudDeepAudit: boolean;
} {
  const { rawText, fallbackObservation, domain } = params;
  const cleaned = rawText
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // If the model returned JSON (e.g., cloud fallback), parse it cleanly too
  if (cleaned.startsWith("{")) {
    const maybeJson = tryParseJsonCandidate<RawTriageJson>(cleaned);
    if (maybeJson) {
      const severity = normalizeSeverity(
        maybeJson.severity ?? maybeJson.risk ?? maybeJson.priority
      );
      const confidence = parseConfidence(maybeJson.confidence ?? maybeJson.score);
      const fallbackTitle =
        fallbackObservation
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(" ")
          .replace(/[.,;:!?]+$/, "") ||
        (domain === "agri" ? "Agri-Field Triage Alert" : "Site-Ops Triage Alert");

      return {
        title:
          pickNonEmptyString(maybeJson.title, maybeJson.issue, maybeJson.heading) ??
          fallbackTitle,
        isActionableFieldIssue: true,
        conversationalReply: undefined,
        summary:
          pickNonEmptyString(
            maybeJson.summary,
            maybeJson.diagnosis,
            maybeJson.description,
            maybeJson.analysis
          ) ?? fallbackObservation,
        severity,
        confidence,
        immediateAction:
          pickNonEmptyString(
            maybeJson.immediateAction,
            maybeJson.immediate_action,
            maybeJson.action,
            maybeJson.containment,
            maybeJson.recommendation
          ) ??
          (domain === "agri"
            ? "Isolate the affected plot area and inspect adjacent plants before applying treatment."
            : "Secure the immediate work perimeter and halt nearby heavy load activity pending structural check."),
        extractedTags: normalizeTags(
          maybeJson.extractedTags ??
            maybeJson.extracted_tags ??
            maybeJson.tags ??
            maybeJson.keywords,
          domain
        ),
        needsCloudDeepAudit:
          typeof (maybeJson.needsCloudDeepAudit ?? maybeJson.needs_cloud_deep_audit) ===
          "boolean"
            ? Boolean(
                maybeJson.needsCloudDeepAudit ?? maybeJson.needs_cloud_deep_audit
              )
            : severity === "critical",
      };
    }
  }

  // Parse plain-text labeled lines:
  // ACTIONABLE / REPLY / TITLE / SEVERITY / CONFIDENCE / SUMMARY / ACTION / TAGS
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*[-*•]\s*/, "").replace(/\*\*/g, "").trim();
    if (!line) continue;

    const match = line.match(
      /^(ACTIONABLE|REPLY|TITLE|SEVERITY|CONFIDENCE|SUMMARY|IMMEDIATE\s+ACTION|ACTION|TAGS)\s*:\s*(.*)$/i
    );
    if (match) {
      const rawKey = match[1].toUpperCase().replace(/\s+/g, "_");
      currentKey = rawKey === "IMMEDIATE_ACTION" ? "ACTION" : rawKey;
      fields[currentKey] = match[2].trim();
    } else if (currentKey) {
      fields[currentKey] = `${fields[currentKey]} ${line}`.trim();
    }
  }

  const actionableRaw = (fields.ACTIONABLE ?? "").toLowerCase().trim();
  const isActionableFieldIssue = !(
    actionableRaw === "no" ||
    actionableRaw === "false" ||
    actionableRaw.startsWith("no ")
  );
  const conversationalReply = fields.REPLY?.trim() || undefined;

  const fallbackTitle =
    fallbackObservation
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join(" ")
      .replace(/[.,;:!?]+$/, "") ||
    (domain === "agri" ? "Agri-Field Triage Alert" : "Site-Ops Triage Alert");

  const severity = normalizeSeverity(fields.SEVERITY);
  const confidence = parseConfidence(fields.CONFIDENCE);
  const title = fields.TITLE?.trim() || fallbackTitle;
  const summary =
    fields.SUMMARY?.trim() ||
    conversationalReply ||
    cleaned.split(/\r?\n/).find((l) => l.trim().length > 15)?.trim() ||
    fallbackObservation;
  const immediateAction =
    fields.ACTION?.trim() ||
    (domain === "agri"
      ? "Isolate the affected plot area and inspect adjacent plants before applying treatment."
      : "Secure the immediate work perimeter and halt nearby heavy load activity pending structural check.");

  const rawTagList = fields.TAGS
    ? fields.TAGS.split(/[,|]+|\s+(?=#)/)
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  return {
    title,
    isActionableFieldIssue,
    conversationalReply,
    summary,
    severity,
    confidence,
    immediateAction,
    extractedTags: normalizeTags(rawTagList, domain),
    needsCloudDeepAudit: isActionableFieldIssue && severity === "critical",
  };
}

const PURE_GREETING_PATTERN =
  /^(hi+|hey+|hello+|yo+|greetings|good\s+(morning|afternoon|evening)|how\s+are\s+you|howdy|sup|what'?s\s+up|test(ing)?(\s+1\s*2\s*3)?|mic\s*(check|test)|check\s*1\s*2|can\s+you\s+hear\s+me|are\s+you\s+there)[!.,?\s]*$/i;

function isPureGreetingOrTest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return false;
  return PURE_GREETING_PATTERN.test(trimmed);
}

export async function runFieldTriage(params: {
  rawInput: string;
  domain: FieldDomain;
  locationTag: string;
  imageBase64?: string | null;
  audioAttachment?: InlineMediaInput | null;
  videoAttachment?: InlineMediaInput | null;
  documentText?: string | null;
  isSimulatedOffline: boolean;
  remoteConfig: RemoteConfigValues;
  onDeviceInitProgress?: (pct: number) => void;
  onStreamChunk?: (accumulatedText: string) => void;
}): Promise<FieldTriageOutput> {
  const {
    rawInput,
    domain,
    locationTag,
    imageBase64,
    audioAttachment,
    videoAttachment,
    documentText,
    isSimulatedOffline,
    remoteConfig,
    onDeviceInitProgress,
    onStreamChunk,
  } = params;

  const ai = getHybridAI();
  const navigatorOnLine =
    typeof navigator !== "undefined" ? navigator.onLine : true;
  const forceOnDevice = isSimulatedOffline || !navigatorOnLine;
  const hasCloudOnlyMedia = Boolean(audioAttachment || videoAttachment);

  if (hasCloudOnlyMedia && forceOnDevice) {
    throw new Error(
      "Audio/Video multimodal analysis requires an internet connection. Remove the audio/video clip or go online to analyze it with Gemini Cloud."
    );
  }

  const hasAnyMediaInput = Boolean(
    imageBase64 || audioAttachment || videoAttachment || documentText?.trim()
  );

  // Strict greeting/test guard: never fabricate crop/site symptoms for casual greetings
  if (!hasAnyMediaInput && isPureGreetingOrTest(rawInput)) {
    const conversationalReply =
      domain === "agri"
        ? `Hello! I'm your TerraPulse Agri-Field copilot for ${locationTag || "your farm"}. Tell me what you're seeing in your crops, soil, or livestock, or ask any agronomy question.`
        : `Hello! TerraPulse Site-Ops copilot standing by for ${locationTag || "your site"}. Describe any structural defect, concrete check, or safety concern whenever you're ready.`;
    return {
      title: "Conversational Greeting",
      isActionableFieldIssue: false,
      conversationalReply,
      localTriage: {
        summary: conversationalReply,
        severity: "low",
        confidence: 100,
        immediateAction: "No field issue reported.",
        extractedTags: [],
        needsCloudDeepAudit: false,
        inferenceSource: forceOnDevice ? "on_device" : "in_cloud",
        processedAt: Date.now(),
        latencyMs: 50,
      },
    };
  }

  const mode = hasCloudOnlyMedia
    ? InferenceMode.ONLY_IN_CLOUD
    : forceOnDevice
      ? InferenceMode.ONLY_ON_DEVICE
      : InferenceMode.PREFER_ON_DEVICE;

  console.log("[AI Engine] 1. Starting request:", {
    operation: "runFieldTriage (plain-text stream)",
    mode,
    domain,
    hasImage: Boolean(imageBase64),
    hasAudio: Boolean(audioAttachment),
    hasVideo: Boolean(videoAttachment),
    hasDocument: Boolean(documentText),
    isSimulatedOffline,
    navigatorOnLine,
  });

  try {
    const remoteSystemPrompt =
      domain === "agri"
        ? remoteConfig.agri_system_prompt
        : remoteConfig.construction_system_prompt;
    const onDeviceSystemPrompt = getCompactOnDeviceSystemPrompt(
      domain,
      remoteSystemPrompt
    );

    const inlineImage = imageBase64
      ? await normalizeImageForInlineData(imageBase64)
      : null;
    const hasImage = Boolean(inlineImage);
    const hasAnyMedia =
      hasImage || Boolean(audioAttachment) || Boolean(videoAttachment);
    const routeMediaDirectToCloud = !forceOnDevice && hasAnyMedia;
    const effectiveMode = routeMediaDirectToCloud
      ? InferenceMode.ONLY_IN_CLOUD
      : mode;

    // When offline with an image, explicitly probe Chrome's multimodal LanguageModel availability.
    // Only degrade to text-only + queued Cloud Vision audit if the device reports unavailable/unsupported.
    let offlineMultimodalAvail: NanoAvailabilityState = "unsupported";
    if (forceOnDevice && hasImage) {
      offlineMultimodalAvail = await checkLocalMultimodalAvailability();
      console.log(
        "[AI Engine] 1b. Offline multimodal Nano availability check:",
        { offlineMultimodalAvail }
      );
    }
    const useLocalOfflineVision =
      forceOnDevice &&
      hasImage &&
      (offlineMultimodalAvail === "available" ||
        offlineMultimodalAvail === "downloadable");

    const combinedObservation = [
      rawInput.trim(),
      documentText?.trim()
        ? `\n[Attached Document Context]:\n${documentText.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const triageMaxTokens = Math.max(768, remoteConfig.triage_max_tokens || 768);
    const localObservation = combinedObservation.slice(
      0,
      LOCAL_NANO_MAX_INPUT_CHARS
    );
    const hasNativeChromeNano = Boolean(getNativeChromeLanguageModel()?.create);

    // Keep ALL behavioral and formatting rules strictly in systemInstruction (never inside the user message)
    const triageSystemPrompt = [
      onDeviceSystemPrompt,
      "STRICT RULES: Never fabricate or invent crop, livestock, or construction symptoms that the user did not report.",
      "If the user's message or audio is ONLY a casual greeting, test phrase (e.g. 'hello', 'hi', 'testing'), or small talk with NO field issue and NO attached photo/video/document showing a problem, output ONLY these 2 lines:",
      "ACTIONABLE: no",
      "REPLY: <1-2 warm domain-appropriate sentences>",
      "Otherwise, output ONLY these 7 labeled lines in plain text:",
      "ACTIONABLE: yes",
      "TITLE: <short 4-6 word title>",
      "SEVERITY: <low | medium | critical>",
      "CONFIDENCE: <number 0-100>",
      "SUMMARY: <2-sentence field diagnosis>",
      "ACTION: <1 concise immediate containment step for voice readout>",
      "TAGS: <comma-separated tags>",
    ].join("\n");

    // Hybrid configuration following Firebase AI Logic Web docs:
    // Enable on-device image input whenever Chrome reports multimodal Nano available/downloadable;
    // otherwise keep on-device session text-only and queue the photo for Cloud Vision upon reconnect.
    const buildHybridParams = (
      overrideMode: InferenceMode,
      enableLocalVision: boolean
    ): HybridParams => ({
      mode: overrideMode,
      onDeviceParams: {
        createOptions: {
          expectedInputs: enableLocalVision
            ? [{ type: "text", languages: ["en"] }, { type: "image" }]
            : [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [
                {
                  type: "text",
                  value: triageSystemPrompt,
                },
              ],
            },
          ],
        },
      },
      inCloudParams: {
        model: remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL,
        systemInstruction: triageSystemPrompt,
        generationConfig: {
          maxOutputTokens: triageMaxTokens,
        },
      },
    });

    // User prompt contains ONLY the user's actual message (plus zone/media context if present)
    const buildUserMessage = (
      observationText: string,
      options: { localVision: boolean; offlineTextOnlyPhotoQueued: boolean }
    ): string =>
      [
        locationTag.trim() ? `Zone: ${locationTag.trim()}` : "",
        observationText.trim(),
        options.offlineTextOnlyPhotoQueued
          ? "[Photo attached — queued for Cloud Vision Deep Audit upon reconnect]"
          : options.localVision || (!forceOnDevice && hasImage)
            ? "[Field photo attached]"
            : "",
        !forceOnDevice && audioAttachment ? "[Field audio clip attached]" : "",
        !forceOnDevice && videoAttachment ? "[Field video clip attached]" : "",
      ]
        .filter(Boolean)
        .join("\n");

    const localTextOnlyPrompt = buildUserMessage(localObservation, {
      localVision: false,
      offlineTextOnlyPhotoQueued: forceOnDevice && hasImage,
    });
    const localUserPrompt = useLocalOfflineVision
      ? buildUserMessage(localObservation, {
          localVision: true,
          offlineTextOnlyPhotoQueued: false,
        })
      : localTextOnlyPrompt;
    const fullCloudUserPrompt = buildUserMessage(combinedObservation, {
      localVision: false,
      offlineTextOnlyPhotoQueued: false,
    });

    // Include inlineData image in localParts ONLY when Chrome reports multimodal Nano available/downloadable
    const localParts: Array<string | Part> = [localUserPrompt];
    if (useLocalOfflineVision && inlineImage) {
      localParts.push({
        type: "inlineData",
        inlineData: {
          data: inlineImage.data,
          mimeType: inlineImage.mimeType,
        },
      });
    }

    const fullCloudParts: Array<string | Part> = [fullCloudUserPrompt];
    if (inlineImage) {
      fullCloudParts.push({
        type: "inlineData",
        inlineData: {
          data: inlineImage.data,
          mimeType: inlineImage.mimeType,
        },
      });
    }
    if (audioAttachment) {
      fullCloudParts.push({
        type: "inlineData",
        inlineData: {
          data: audioAttachment.data,
          mimeType: audioAttachment.mimeType,
        },
      });
    }
    if (videoAttachment) {
      fullCloudParts.push({
        type: "inlineData",
        inlineData: {
          data: videoAttachment.data,
          mimeType: videoAttachment.mimeType,
        },
      });
    }

    const useFastOfflineRace =
      effectiveMode === InferenceMode.ONLY_ON_DEVICE && hasNativeChromeNano;

    const startTime = Date.now();
    let responseText = "";
    let resolvedSource: "on_device" | "in_cloud" = routeMediaDirectToCloud
      ? "in_cloud"
      : forceOnDevice
        ? "on_device"
        : "in_cloud";
    let retriedInCloud = false;
    let usedDirectChromeNano = false;
    let degradedOfflineImageToTextOnly = forceOnDevice && hasImage && !useLocalOfflineVision;

    const streamFromModel = async (
      targetModel: ReturnType<typeof getGenerativeModel>,
      partsToSend: Array<string | Part>,
      timeoutMs?: number
    ): Promise<{
      text: string;
      sdkSource: InferenceSource | undefined;
    }> => {
      const streamPromise = targetModel.generateContentStream(partsToSend);
      const { stream, response } = timeoutMs
        ? await withTimeout(
            streamPromise,
            timeoutMs,
            timeoutMs === OFFLINE_SDK_FALLBACK_TIMEOUT_MS
              ? "firebase/ai generateContentStream exceeded 15s offline threshold"
              : "AI request timed out after 90s — check DevTools Console logs"
          )
        : await streamPromise;

      let accumulated = "";
      for await (const chunk of stream) {
        const piece = chunk.text();
        if (piece) {
          accumulated += piece;
          onStreamChunk?.(accumulated);
        }
      }

      const finalResponse = await response;
      if (!accumulated.trim()) {
        accumulated = finalResponse.text() ?? "";
        if (accumulated) onStreamChunk?.(accumulated);
      }

      return {
        text: accumulated,
        sdkSource: finalResponse.inferenceSource,
      };
    };

    const runNativeOfflineFallback = async (reason: unknown): Promise<void> => {
      console.warn(
        "[AI Engine] 3b. firebase/ai offline path stalled or failed — switching to direct Chrome LanguageModel plain-text stream (0 KB):",
        reason
      );
      if (useLocalOfflineVision && inlineImage) {
        try {
          responseText = await runDirectChromeLanguageModel({
            systemPrompt: triageSystemPrompt,
            userPrompt: localUserPrompt,
            imageInlineData: inlineImage,
            onStreamChunk,
          });
          resolvedSource = "on_device";
          usedDirectChromeNano = true;
          return;
        } catch (visionErr) {
          console.warn(
            "[AI Engine] 3c. On-device multimodal image decoding failed — degrading gracefully to text-only Nano + queued Cloud Vision audit:",
            visionErr
          );
          degradedOfflineImageToTextOnly = true;
        }
      }

      responseText = await runDirectChromeLanguageModel({
        systemPrompt: triageSystemPrompt,
        userPrompt: localTextOnlyPrompt,
        onStreamChunk,
      });
      resolvedSource = "on_device";
      usedDirectChromeNano = true;
    };

    const initFailedOfflineRef = { failed: false, error: null as unknown };

    if (routeMediaDirectToCloud) {
      console.log(
        "[AI Engine] 2. Online multimodal media attached (image/audio/video) — routing directly to InferenceMode.ONLY_IN_CLOUD (skipping local initializeDeviceModel)...",
        {
          hasImage,
          hasAudio: Boolean(audioAttachment),
          hasVideo: Boolean(videoAttachment),
          partsCount: fullCloudParts.length,
        }
      );
      const { result: cloudStreamOut } = await runCloudWithFallbackChain({
        label: "Multimodal Field Triage",
        preferredModel: remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL,
        execute: async (modelName) => {
          console.log(
            `[AI Engine] 3. Streaming multimodal triage via ${modelName} (ONLY_IN_CLOUD)...`
          );
          const cloudModel = getGenerativeModel(ai, {
            mode: InferenceMode.ONLY_IN_CLOUD,
            inCloudParams: {
              model: modelName,
              systemInstruction: triageSystemPrompt,
              generationConfig: { maxOutputTokens: triageMaxTokens },
            },
          });
          return streamFromModel(cloudModel, fullCloudParts);
        },
      });
      responseText = cloudStreamOut.text;
      resolvedSource = "in_cloud";
    } else {
      // Create the exact GenerativeModel instance once, initializeDeviceModel() on THIS instance,
      // and immediately stream with generateContentStream() on THIS SAME instance.
      const model = getGenerativeModel(
        ai,
        buildHybridParams(effectiveMode, useLocalOfflineVision)
      );

      console.log(
        "[AI Engine] 2. Checking/Initializing device model (initializeDeviceModel) on active triage model...",
        { useLocalOfflineVision, offlineMultimodalAvail }
      );
      try {
        const initPromise = model.initializeDeviceModel((val) => {
          const pct = Math.round(val * 10000) / 100;
          console.log(`[AI Engine] 2b. Device model download progress: ${pct}%`);
          onDeviceInitProgress?.(pct);
        });
        if (useFastOfflineRace) {
          await withTimeout(
            initPromise,
            OFFLINE_SDK_FALLBACK_TIMEOUT_MS,
            "firebase/ai initializeDeviceModel exceeded 15s offline threshold"
          );
        } else {
          await initPromise;
        }
        deviceModelInitialized = true;
        console.log(
          "[AI Engine] 2. Device model initialization completed on active model instance."
        );
      } catch (initErr) {
        console.warn(
          "[AI Engine] 2. Device model initialization unavailable/skipped:",
          initErr
        );
        if (forceOnDevice) {
          if (hasNativeChromeNano) {
            initFailedOfflineRef.failed = true;
            initFailedOfflineRef.error = initErr;
          } else {
            throw new Error(
              initErr instanceof Error
                ? `On-device Gemini Nano unavailable while offline: ${initErr.message}`
                : "On-device Gemini Nano is required in Offline Mode (Chrome 139+ with Prompt API enabled)."
            );
          }
        }
      }

      if (initFailedOfflineRef.failed) {
        await runNativeOfflineFallback(initFailedOfflineRef.error);
      } else {
        console.log("[AI Engine] 3. Calling model.generateContentStream(...)", {
          operation: "runFieldTriage",
          mode: effectiveMode,
          partsCount: localParts.length,
          systemPromptChars: onDeviceSystemPrompt.length,
          localInputChars: localObservation.length,
          originalInputChars: rawInput.trim().length,
          promptLength: localUserPrompt.length,
          maxOutputTokens: triageMaxTokens,
          useLocalOfflineVision,
          offlinePhotoQueuedForCloudVision: degradedOfflineImageToTextOnly,
        });

        try {
          // Never impose an artificial client-side timeout on online cloud requests;
          // only race offline SDK calls against the 15s native Nano fallback threshold.
          const streamOut = await streamFromModel(
            model,
            localParts,
            useFastOfflineRace ? OFFLINE_SDK_FALLBACK_TIMEOUT_MS : undefined
          );
          responseText = streamOut.text;
          resolvedSource =
            streamOut.sdkSource === InferenceSource.ON_DEVICE
              ? "on_device"
              : streamOut.sdkSource === InferenceSource.IN_CLOUD
                ? "in_cloud"
                : forceOnDevice
                  ? "on_device"
                  : "in_cloud";
        } catch (genErr) {
          const isQuotaErr = isQuotaExceededError(genErr);
          const isCloudBusyErr = isRetryableCloudError(genErr);
          const canFallbackToCloud =
            !isSimulatedOffline &&
            navigatorOnLine &&
            (isQuotaErr || isCloudBusyErr);

          if (
            effectiveMode === InferenceMode.ONLY_ON_DEVICE &&
            hasNativeChromeNano
          ) {
            await runNativeOfflineFallback(genErr);
          } else if (canFallbackToCloud) {
            console.warn(
              "[Cloud Router] Model busy/occupied or local quota exceeded — switching immediately to cloud fallback chain:",
              genErr
            );
            const { result: cloudOut } = await runCloudWithFallbackChain({
              label: "Field Triage Cloud Fallback",
              preferredModel:
                remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL,
              execute: async (modelName) => {
                const cloudRetryModel = getGenerativeModel(ai, {
                  mode: InferenceMode.ONLY_IN_CLOUD,
                  inCloudParams: {
                    model: modelName,
                    systemInstruction: onDeviceSystemPrompt,
                    generationConfig: {
                      maxOutputTokens: triageMaxTokens,
                    },
                  },
                });
                return streamFromModel(cloudRetryModel, fullCloudParts);
              },
            });
            responseText = cloudOut.text;
            resolvedSource = "in_cloud";
            retriedInCloud = true;
          } else {
            throw genErr;
          }
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    const latencyMs = Math.max(120, elapsedMs);

    console.log("[AI Engine] 4. Raw SDK response received:", {
      operation: "runFieldTriage",
      inferenceSource: resolvedSource,
      retriedInCloud,
      usedDirectChromeNano,
      elapsedMs,
      elapsedSec: `${(elapsedMs / 1000).toFixed(2)}s`,
      rawText: responseText,
    });

    if (!responseText.trim()) {
      throw new Error("AI model returned an empty response.");
    }

    const parsed = parseLabeledTriageResponse({
      rawText: responseText,
      fallbackObservation: localObservation,
      domain,
    });
    console.log("[AI Engine] 5. Parsed triage output:", parsed);

    return {
      title: parsed.title,
      isActionableFieldIssue: parsed.isActionableFieldIssue,
      conversationalReply: parsed.conversationalReply,
      localTriage: {
        summary: parsed.summary,
        severity: parsed.severity,
        confidence: parsed.confidence,
        immediateAction: parsed.immediateAction,
        extractedTags: parsed.extractedTags,
        needsCloudDeepAudit:
          parsed.needsCloudDeepAudit ||
          (parsed.isActionableFieldIssue && degradedOfflineImageToTextOnly),
        inferenceSource: resolvedSource,
        processedAt: Date.now(),
        latencyMs,
      },
    };
  } catch (err) {
    console.error("[AI Engine] FAILED:", err);
    throw err;
  }
}

const CLOUD_AUDIT_RESPONSE_SCHEMA = Schema.object({
  properties: {
    rootCauseAnalysis: Schema.string({
      description:
        "Detailed engineering or agronomic root-cause analysis referencing field symptoms and environmental factors.",
    }),
    stepByStepPlan: Schema.array({
      items: Schema.object({
        properties: {
          step: Schema.string({
            description: "Actionable remediation instruction step.",
          }),
          completed: Schema.boolean({
            description: "Always false initially.",
          }),
        },
      }),
      description: "4-5 ordered remediation checklist steps.",
    }),
    estimatedMaterialsOrInputs: Schema.array({
      items: Schema.object({
        properties: {
          item: Schema.string({ description: "Material, tool, or agronomic input name." }),
          quantity: Schema.string({ description: "Estimated quantity with units." }),
        },
      }),
      description: "3-5 estimated materials or agricultural inputs needed.",
    }),
    safetyOrComplianceNotes: Schema.string({
      description:
        "Mandatory PPE, OSHA/ACI structural standards, or phytosanitary biosecurity precautions.",
    }),
    workflowSteps: Schema.array({
      items: Schema.object({
        properties: {
          phase: Schema.string({ description: "Short phase name (e.g., Phase 1: Isolate)." }),
          action: Schema.string({ description: "Concise 1-sentence field execution step." }),
          timing: Schema.string({ description: "Target execution window (e.g., Immediate, 0-24h, Day 3)." }),
        },
      }),
      description: "3-4 concise visual workflow phases ordered sequentially.",
    }),
  },
});

interface RawCloudAuditJson {
  rootCauseAnalysis?: unknown;
  stepByStepPlan?: unknown;
  estimatedMaterialsOrInputs?: unknown;
  safetyOrComplianceNotes?: unknown;
  workflowSteps?: unknown;
  visualDiagramSvg?: unknown;
}

export function sanitizeSvgMarkup(rawSvg: string | null | undefined): string | null {
  if (!rawSvg || typeof rawSvg !== "string") return null;
  const start = rawSvg.indexOf("<svg");
  const end = rawSvg.lastIndexOf("</svg>");
  if (start < 0 || end < 0 || end <= start) return null;

  let svg = rawSvg.slice(start, end + 6);
  // Strip potentially unsafe elements and event handler attributes
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

  return svg;
}

export async function runCloudDeepAudit(params: {
  log: FieldLog;
  remoteConfig: RemoteConfigValues;
}): Promise<Omit<CloudAuditResult, "completedAt">> {
  const { log, remoteConfig } = params;
  const ai = getHybridAI();
  const primaryModelName =
    remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL;

  try {
    const systemInstruction =
      log.domain === "agri"
        ? `${remoteConfig.agri_system_prompt} Perform a concise Cloud Agronomy Audit. Return root-cause analysis, 4-5 remediation steps, estimated agricultural inputs, biosecurity notes, and 3-4 sequential workflowSteps.`
        : `${remoteConfig.construction_system_prompt} Perform a concise Cloud Civil/Structural Engineering Audit. Return root-cause analysis, 4-5 repair steps, estimated BOQ materials, OSHA/ACI safety notes, and 3-4 sequential workflowSteps.`;

    const inlineImage = log.imageBase64
      ? await normalizeImageForInlineData(log.imageBase64)
      : null;

    const promptText = [
      `Log Title: ${log.title}`,
      `Domain: ${log.domain}`,
      `Location: ${log.locationTag}`,
      `Raw Field Observation: ${log.rawInput}`,
      log.localTriage
        ? `Initial On-Device Triage: ${log.localTriage.summary} (Severity: ${log.localTriage.severity}, Immediate Action: ${log.localTriage.immediateAction})`
        : "",
      "Return concise structured JSON matching the schema with 3-4 workflowSteps (phase, action, timing).",
    ]
      .filter(Boolean)
      .join("\n");

    const parts: Array<string | Part> = inlineImage
      ? [
          promptText,
          {
            type: "inlineData" as const,
            inlineData: {
              data: inlineImage.data,
              mimeType: inlineImage.mimeType,
            },
          },
        ]
      : [promptText];

    const callCloudAuditModel = async (modelName: string) => {
      const model = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: modelName,
          systemInstruction,
          generationConfig: {
            maxOutputTokens: 1536,
            responseMimeType: "application/json",
            responseSchema: CLOUD_AUDIT_RESPONSE_SCHEMA,
          },
        },
      });

      console.log(`[Cloud Audit] 1. Sending request to ${modelName}...`, {
        logId: log.id,
        domain: log.domain,
        promptLength: promptText.length,
        hasImage: Boolean(inlineImage),
        base64Length: inlineImage?.data.length ?? 0,
      });

      return await model.generateContent(parts);
    };

    const startTime = Date.now();
    const auditTemplateId =
      log.domain === "agri"
        ? remoteConfig.agri_audit_template_id || "agri-deep-audit"
        : remoteConfig.site_audit_template_id || "site-deep-audit";

    let responseText = "";
    let modelUsed = primaryModelName;
    let inferenceSourceOut: InferenceSource | undefined = InferenceSource.IN_CLOUD;

    // Try Firebase AI Logic Server Prompt Template first when online (only when no image is required
    // or template handles text inputs cleanly), with graceful fallback to getGenerativeModel.
    let templateSucceeded = false;
    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        console.log(
          `[Cloud Audit] 1. Sending Server Prompt Template request ("${auditTemplateId}")...`,
          { logId: log.id, domain: log.domain, location: log.locationTag }
        );
        const templateModel = getTemplateGenerativeModel(ai);
        const tplResult = await templateModel.generateContent({
          templateId: auditTemplateId,
          templateVariables: {
            location: log.locationTag || "Active Field Zone",
            observation: log.rawInput,
          },
        });
        const tplText = tplResult.response?.text() ?? "";
        if (tplText.trim()) {
          const probe = extractJsonObject<RawCloudAuditJson>(tplText);
          if (
            typeof probe.rootCauseAnalysis === "string" &&
            probe.rootCauseAnalysis.trim().length > 0
          ) {
            responseText = tplText;
            modelUsed = `template:${auditTemplateId}`;
            inferenceSourceOut = tplResult.response?.inferenceSource;
            templateSucceeded = true;
          }
        }
      } catch (tplErr) {
        console.warn(
          `[Cloud Audit] Server Prompt Template "${auditTemplateId}" unavailable or failed — falling back to direct cloud model:`,
          tplErr
        );
      }
    }

    if (!templateSucceeded) {
      const { result, modelUsed: directModel } = await runCloudWithFallbackChain({
        label: "Cloud Audit",
        preferredModel: primaryModelName,
        execute: callCloudAuditModel,
      });
      responseText = result.response?.text() ?? "";
      modelUsed = directModel;
      inferenceSourceOut = result.response?.inferenceSource;
    }

    const elapsedMs = Date.now() - startTime;

    console.log("[Cloud Audit] 2. Raw response received:", {
      model: modelUsed,
      inferenceSource: inferenceSourceOut,
      elapsedMs,
      elapsedSec: `${(elapsedMs / 1000).toFixed(2)}s`,
      rawText: responseText,
    });

    if (!responseText.trim()) {
      throw new Error("Cloud Deep Audit model returned an empty response.");
    }

    const parsed = extractJsonObject<RawCloudAuditJson>(responseText);
    console.log("[Cloud Audit] 3. Parsed JSON output:", parsed);

    if (
      typeof parsed.rootCauseAnalysis !== "string" ||
      !parsed.rootCauseAnalysis.trim()
    ) {
      throw new Error(
        "Cloud Deep Audit returned incomplete JSON (missing rootCauseAnalysis)."
      );
    }

    const stepByStepPlan = Array.isArray(parsed.stepByStepPlan)
      ? parsed.stepByStepPlan
          .map((entry) => {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "step" in entry &&
              typeof (entry as { step: unknown }).step === "string"
            ) {
              return {
                step: (entry as { step: string }).step.trim(),
                completed: false,
              };
            }
            return null;
          })
          .filter(
            (s): s is { step: string; completed: boolean } =>
              s !== null && s.step.length > 0
          )
      : [];

    const estimatedMaterialsOrInputs = Array.isArray(
      parsed.estimatedMaterialsOrInputs
    )
      ? parsed.estimatedMaterialsOrInputs
          .map((entry) => {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "item" in entry &&
              "quantity" in entry &&
              typeof (entry as { item: unknown }).item === "string" &&
              typeof (entry as { quantity: unknown }).quantity === "string"
            ) {
              return {
                item: (entry as { item: string }).item.trim(),
                quantity: (entry as { quantity: string }).quantity.trim(),
              };
            }
            return null;
          })
          .filter(
            (m): m is { item: string; quantity: string } =>
              m !== null && m.item.length > 0
          )
      : [];

    const workflowSteps = Array.isArray(parsed.workflowSteps)
      ? parsed.workflowSteps
          .map((entry) => {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "phase" in entry &&
              "action" in entry &&
              typeof (entry as { phase: unknown }).phase === "string" &&
              typeof (entry as { action: unknown }).action === "string"
            ) {
              const rawTiming =
                "timing" in entry &&
                typeof (entry as { timing: unknown }).timing === "string"
                  ? (entry as { timing: string }).timing.trim()
                  : "Immediate";
              return {
                phase: (entry as { phase: string }).phase.trim(),
                action: (entry as { action: string }).action.trim(),
                timing: rawTiming || "Immediate",
              };
            }
            return null;
          })
          .filter(
            (w): w is { phase: string; action: string; timing: string } =>
              w !== null && w.phase.length > 0 && w.action.length > 0
          )
      : [];

    return {
      rootCauseAnalysis: parsed.rootCauseAnalysis.trim(),
      stepByStepPlan,
      estimatedMaterialsOrInputs,
      safetyOrComplianceNotes:
        typeof parsed.safetyOrComplianceNotes === "string"
          ? parsed.safetyOrComplianceNotes.trim()
          : "",
      workflowSteps,
      modelUsed,
      visualDiagramSvg: null,
      generatedDiagramUrl: null,
    };
  } catch (err) {
    console.error("[Cloud Audit] FAILED:", err);
    throw err;
  }
}

const WEEKLY_SYNTHESIS_SCHEMA = Schema.object({
  properties: {
    executiveSummary: Schema.string({
      description:
        "3-4 sentence executive pattern synthesis correlating root causes across all selected zones.",
    }),
    priorityChecklist: Schema.array({
      items: Schema.object({
        properties: {
          task: Schema.string({ description: "Specific prioritized cross-zone task." }),
          urgency: Schema.enumString({ enum: ["immediate", "this_week", "monitor"] }),
          completed: Schema.boolean({ description: "Always false initially." }),
        },
      }),
      description: "3-5 prioritized action items ordered from highest urgency to lowest.",
    }),
    consolidatedMaterials: Schema.array({
      items: Schema.object({
        properties: {
          item: Schema.string({ description: "Material or agricultural input name." }),
          totalQuantity: Schema.string({ description: "Consolidated quantity across zones." }),
          targetZones: Schema.string({ description: "Comma-separated zones needing this item." }),
        },
      }),
      description: "Consolidated procurement BOQ across all selected logs.",
    }),
  },
});

interface RawSynthesisJson {
  executiveSummary?: unknown;
  priorityChecklist?: unknown;
  consolidatedMaterials?: unknown;
}

export async function runWeeklySynthesis(params: {
  logs: FieldLog[];
  domain: FieldDomain;
  remoteConfig: RemoteConfigValues;
}): Promise<{
  executiveSummary: string;
  priorityChecklist: Array<{
    task: string;
    urgency: "immediate" | "this_week" | "monitor";
    completed: boolean;
  }>;
  consolidatedMaterials: Array<{
    item: string;
    totalQuantity: string;
    targetZones: string;
  }>;
  modelUsed: string;
}> {
  const { logs, domain, remoteConfig } = params;
  const ai = getHybridAI();
  const primaryModelName =
    remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL;

  try {
    const systemInstruction =
      domain === "agri"
        ? "You are a Chief Agronomist synthesizing weekly multi-plot field reports into a concise executive pattern brief, prioritized action checklist, and consolidated procurement table."
        : "You are a Principal Civil Structural Engineer synthesizing weekly multi-zone site inspection reports into a concise executive risk brief, prioritized intervention checklist, and consolidated BOQ procurement table.";

    const digest = logs
      .map(
        (log, idx) =>
          `[${idx + 1}] Title: ${log.title} | Zone: ${log.locationTag} | Severity: ${log.localTriage?.severity ?? "unknown"}\nObservation: ${log.rawInput}\nLocal Action: ${log.localTriage?.immediateAction ?? "N/A"}${
            log.cloudAudit ? `\nCloud Root Cause: ${log.cloudAudit.rootCauseAnalysis}` : ""
          }`
      )
      .join("\n\n");

    const prompt = `Synthesize the following ${logs.length} synced ${domain} field logs into a unified weekly report JSON:\n\n${digest}`;

    const callSynthesisModel = async (modelName: string) => {
      const model = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: modelName,
          systemInstruction,
          generationConfig: {
            maxOutputTokens: 1536,
            responseMimeType: "application/json",
            responseSchema: WEEKLY_SYNTHESIS_SCHEMA,
          },
        },
      });

      console.log(`[Weekly Synthesis] 1. Sending request to ${modelName}...`, {
        domain,
        logCount: logs.length,
        promptLength: prompt.length,
      });

      return await model.generateContent(prompt);
    };

    const startTime = Date.now();
    const synthesisTemplateId =
      domain === "agri"
        ? remoteConfig.agri_synthesis_template_id || "agri-weekly-synthesis"
        : remoteConfig.site_synthesis_template_id || "site-weekly-synthesis";

    const compactLogs = logs.map((log) => ({
      title: log.title,
      location: log.locationTag,
      severity: log.localTriage?.severity ?? "unknown",
      summary: log.localTriage?.summary ?? log.rawInput.slice(0, 200),
      immediateAction: log.localTriage?.immediateAction ?? "",
      rootCause: log.cloudAudit?.rootCauseAnalysis ?? "",
    }));

    let responseText = "";
    let modelUsed = primaryModelName;
    let inferenceSourceOut: InferenceSource | undefined = InferenceSource.IN_CLOUD;
    let templateSucceeded = false;

    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        console.log(
          `[Weekly Synthesis] 1. Sending Server Prompt Template request ("${synthesisTemplateId}")...`,
          { domain, logCount: logs.length }
        );
        const templateModel = getTemplateGenerativeModel(ai);
        const tplResult = await templateModel.generateContent({
          templateId: synthesisTemplateId,
          templateVariables: {
            logsJson: JSON.stringify(compactLogs),
          },
        });
        const tplText = tplResult.response?.text() ?? "";
        if (tplText.trim()) {
          const probe = extractJsonObject<RawSynthesisJson>(tplText);
          if (
            typeof probe.executiveSummary === "string" &&
            probe.executiveSummary.trim().length > 0
          ) {
            responseText = tplText;
            modelUsed = `template:${synthesisTemplateId}`;
            inferenceSourceOut = tplResult.response?.inferenceSource;
            templateSucceeded = true;
          }
        }
      } catch (tplErr) {
        console.warn(
          `[Weekly Synthesis] Server Prompt Template "${synthesisTemplateId}" unavailable or failed — falling back to direct cloud model:`,
          tplErr
        );
      }
    }

    if (!templateSucceeded) {
      const { result, modelUsed: directModel } = await runCloudWithFallbackChain({
        label: "Weekly Synthesis",
        preferredModel: primaryModelName,
        execute: callSynthesisModel,
      });
      responseText = result.response?.text() ?? "";
      modelUsed = directModel;
      inferenceSourceOut = result.response?.inferenceSource;
    }

    const elapsedMs = Date.now() - startTime;

    console.log("[Weekly Synthesis] 2. Raw response received:", {
      model: modelUsed,
      inferenceSource: inferenceSourceOut,
      elapsedMs,
      elapsedSec: `${(elapsedMs / 1000).toFixed(2)}s`,
      rawText: responseText,
    });

    if (!responseText.trim()) {
      throw new Error("Weekly Synthesis model returned an empty response.");
    }

    const parsed = extractJsonObject<RawSynthesisJson>(responseText);
    console.log("[AI Engine] 5. Parsed JSON output:", parsed);

    if (
      typeof parsed.executiveSummary !== "string" ||
      !parsed.executiveSummary.trim()
    ) {
      throw new Error(
        "Weekly Synthesis returned incomplete JSON (missing executiveSummary)."
      );
    }

    const priorityChecklist = Array.isArray(parsed.priorityChecklist)
      ? parsed.priorityChecklist
          .map((entry) => {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "task" in entry &&
              typeof (entry as { task: unknown }).task === "string"
            ) {
              const rawUrg =
                "urgency" in entry &&
                typeof (entry as { urgency: unknown }).urgency === "string"
                  ? (entry as { urgency: string }).urgency
                  : "this_week";
              const urgency: "immediate" | "this_week" | "monitor" =
                rawUrg === "immediate" || rawUrg === "monitor"
                  ? rawUrg
                  : "this_week";
              return {
                task: (entry as { task: string }).task.trim(),
                urgency,
                completed: false,
              };
            }
            return null;
          })
          .filter(
            (
              t
            ): t is {
              task: string;
              urgency: "immediate" | "this_week" | "monitor";
              completed: boolean;
            } => t !== null && t.task.length > 0
          )
      : [];

    const consolidatedMaterials = Array.isArray(parsed.consolidatedMaterials)
      ? parsed.consolidatedMaterials
          .map((entry) => {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "item" in entry &&
              "totalQuantity" in entry &&
              "targetZones" in entry &&
              typeof (entry as { item: unknown }).item === "string" &&
              typeof (entry as { totalQuantity: unknown }).totalQuantity ===
                "string" &&
              typeof (entry as { targetZones: unknown }).targetZones ===
                "string"
            ) {
              return {
                item: (entry as { item: string }).item.trim(),
                totalQuantity: (
                  entry as { totalQuantity: string }
                ).totalQuantity.trim(),
                targetZones: (
                  entry as { targetZones: string }
                ).targetZones.trim(),
              };
            }
            return null;
          })
          .filter(
            (
              m
            ): m is {
              item: string;
              totalQuantity: string;
              targetZones: string;
            } => m !== null && m.item.length > 0
          )
      : [];

    return {
      executiveSummary: parsed.executiveSummary.trim(),
      priorityChecklist,
      consolidatedMaterials,
      modelUsed,
    };
  } catch (err) {
    console.error("[AI Engine] FAILED:", err);
    throw err;
  }
}

export interface AssistantChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  inferenceSource?: "on_device" | "in_cloud";
  latencyMs?: number;
  createdAt: number;
}

export interface StreamFieldAssistantResult {
  text: string;
  inferenceSource: "on_device" | "in_cloud";
  latencyMs: number;
}

async function streamDirectChromeLanguageModel(params: {
  systemPrompt: string;
  history: AssistantChatMessage[];
  message: string;
  onChunk: (accumulatedText: string) => void;
}): Promise<string> {
  const lm = getNativeChromeLanguageModel();
  if (!lm?.create) {
    throw new Error(
      "Chrome native LanguageModel API is unavailable in this browser."
    );
  }

  const initialPrompts: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: params.systemPrompt },
    ...trimChatHistoryPairs(params.history, 2).map((msg) => ({
      role: (msg.role === "model" ? "assistant" : "user") as
        | "user"
        | "assistant",
      content: msg.text.slice(0, 400),
    })),
  ];

  console.log(
    "[AI Engine] Creating direct Chrome LanguageModel streaming session (0 KB offline path)..."
  );
  // Allow cold-start on-device model loading to complete naturally without artificial timeout
  const session = await lm.create({ initialPrompts });

  try {
    if (typeof session.promptStreaming === "function") {
      let accumulated = "";
      const iterable = session.promptStreaming(params.message);
      for await (const piece of iterable) {
        if (!piece) continue;
        // Chrome's promptStreaming yields incremental chunks in newer builds
        // and cumulative text in older builds — handle both cleanly.
        if (accumulated && piece.startsWith(accumulated)) {
          accumulated = piece;
        } else {
          accumulated += piece;
        }
        params.onChunk(accumulated);
      }
      return accumulated.trim();
    }

    const full = await session.prompt(params.message);
    params.onChunk(full);
    return full.trim();
  } finally {
    try {
      session.destroy?.();
      console.log(
        "[AI Engine] Direct Chrome LanguageModel streaming session destroyed."
      );
    } catch {
      // ignore destroy errors
    }
  }
}

/**
 * Streaming multi-turn field assistant powered by official Firebase AI Logic
 * `model.startChat({ history, systemInstruction })` + `chat.sendMessageStream()`.
 * Caps history to the last 2 message pairs to stay within on-device Nano's context window.
 */
export async function streamFieldAssistantChat(params: {
  message: string;
  history: AssistantChatMessage[];
  domain: FieldDomain;
  locationLabel?: string;
  contextSummary?: string;
  isSimulatedOffline: boolean;
  remoteConfig: RemoteConfigValues;
  onChunk: (accumulatedText: string) => void;
  onDeviceInitProgress?: (pct: number) => void;
}): Promise<StreamFieldAssistantResult> {
  const {
    message,
    history,
    domain,
    locationLabel,
    contextSummary,
    isSimulatedOffline,
    remoteConfig,
    onChunk,
    onDeviceInitProgress,
  } = params;

  const ai = getHybridAI();
  const navigatorOnLine =
    typeof navigator !== "undefined" ? navigator.onLine : true;
  const forceOnDevice = isSimulatedOffline || !navigatorOnLine;
  const mode = forceOnDevice
    ? InferenceMode.ONLY_ON_DEVICE
    : InferenceMode.PREFER_ON_DEVICE;

  const trimmedHistory = trimChatHistoryPairs(history, 2);
  const basePersona =
    domain === "agri"
      ? `TerraPulse Agri-Field voice copilot (${locationLabel || "Field"}). Reply in 2-4 concise, practical sentences suitable for spoken readout.`
      : `TerraPulse Site-Ops safety copilot (${locationLabel || "Site"}). Reply in 2-4 concise, safety-first sentences suitable for spoken readout.`;
  const assistantSystemInstruction = contextSummary?.trim()
    ? `${basePersona}\n\nActive Field Log Context:\n${contextSummary.trim().slice(0, forceOnDevice ? 420 : 2400)}`
    : basePersona;

  const condensedMessage = message.trim().slice(0, LOCAL_NANO_MAX_INPUT_CHARS);
  const hasNativeChromeNano = Boolean(getNativeChromeLanguageModel()?.create);
  const useFastOfflineRace =
    mode === InferenceMode.ONLY_ON_DEVICE && hasNativeChromeNano;

  console.log("[AI Engine] 1. Starting request:", {
    operation: "streamFieldAssistantChat",
    mode,
    domain,
    historyMessages: trimmedHistory.length,
    messageChars: condensedMessage.length,
    isSimulatedOffline,
    navigatorOnLine,
  });

  const sdkHistory: Content[] = trimmedHistory.map((item) => ({
    role: item.role,
    parts: [{ type: "text", text: item.text.slice(0, 450) }],
  }));

  const startTime = Date.now();

  try {
    const model = getGenerativeModel(ai, {
      mode,
      onDeviceParams: {
        createOptions: {
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: assistantSystemInstruction }],
            },
          ],
          expectedInputs: [{ type: "text" }],
        },
      },
      inCloudParams: {
        model: remoteConfig.active_cloud_model || "gemini-3.8-flash",
        systemInstruction: assistantSystemInstruction,
        generationConfig: {
          maxOutputTokens: 512,
        },
      },
    });

    console.log(
      "[AI Engine] 2. Checking/Initializing device model (initializeDeviceModel) on active chat model..."
    );
    let initFailedOffline = false;
    let initOfflineError: unknown = null;

    try {
      const chatInitPromise = model.initializeDeviceModel((val) => {
        const pct = Math.round(val * 10000) / 100;
        onDeviceInitProgress?.(pct);
      });
      if (useFastOfflineRace) {
        await withTimeout(
          chatInitPromise,
          OFFLINE_SDK_FALLBACK_TIMEOUT_MS,
          "firebase/ai chat initializeDeviceModel exceeded 15s offline threshold"
        );
      } else {
        await chatInitPromise;
      }
      deviceModelInitialized = true;
    } catch (initErr) {
      console.warn(
        "[AI Engine] 2. Chat device model initialization unavailable/skipped:",
        initErr
      );
      if (forceOnDevice) {
        if (hasNativeChromeNano) {
          initFailedOffline = true;
          initOfflineError = initErr;
        } else {
          throw new Error(
            initErr instanceof Error
              ? `On-device Gemini Nano unavailable while offline: ${initErr.message}`
              : "On-device Gemini Nano is required in Offline Mode."
          );
        }
      }
    }

    let fullText = "";
    let resolvedSource: "on_device" | "in_cloud" = forceOnDevice
      ? "on_device"
      : "in_cloud";

    if (initFailedOffline) {
      console.warn(
        "[AI Engine] 3b. Switching streaming chat to direct Chrome LanguageModel (0 KB offline):",
        initOfflineError
      );
      fullText = await streamDirectChromeLanguageModel({
        systemPrompt: assistantSystemInstruction,
        history: trimmedHistory,
        message: condensedMessage,
        onChunk,
      });
      resolvedSource = "on_device";
    } else {
      console.log(
        "[AI Engine] 3. Calling model.startChat() + chat.sendMessageStream(...)",
        {
          operation: "streamFieldAssistantChat",
          mode,
          historyLength: sdkHistory.length,
          messageLength: condensedMessage.length,
        }
      );

      const runSdkStream = async (
        targetModel: ReturnType<typeof getGenerativeModel>,
        promptToSend: string,
        timeoutMs?: number
      ) => {
        const chat = targetModel.startChat({
          history: sdkHistory,
          systemInstruction: assistantSystemInstruction,
        });
        const sendPromise = chat.sendMessageStream(promptToSend);
        const { stream, response } = timeoutMs
          ? await withTimeout(
              sendPromise,
              timeoutMs,
              "AI chat stream timed out — check DevTools Console logs"
            )
          : await sendPromise;

        let streamed = "";
        for await (const chunk of stream) {
          const piece = chunk.text();
          if (piece) {
            streamed += piece;
            onChunk(streamed);
          }
        }

        const finalResponse = await response;
        if (!streamed.trim()) {
          streamed = finalResponse.text() ?? "";
          if (streamed) onChunk(streamed);
        }

        return {
          text: streamed.trim(),
          sdkSource: finalResponse.inferenceSource,
        };
      };

      try {
        const sdkOut = await runSdkStream(
          model,
          condensedMessage,
          useFastOfflineRace ? OFFLINE_SDK_FALLBACK_TIMEOUT_MS : undefined
        );
        fullText = sdkOut.text;
        resolvedSource =
          sdkOut.sdkSource === InferenceSource.ON_DEVICE
            ? "on_device"
            : sdkOut.sdkSource === InferenceSource.IN_CLOUD
              ? "in_cloud"
              : forceOnDevice
                ? "on_device"
                : "in_cloud";
      } catch (streamErr) {
        if (mode === InferenceMode.ONLY_ON_DEVICE && hasNativeChromeNano) {
          console.warn(
            "[AI Engine] 3b. firebase/ai offline chat stream failed/stalled — switching to direct Chrome LanguageModel:",
            streamErr
          );
          fullText = await streamDirectChromeLanguageModel({
            systemPrompt: assistantSystemInstruction,
            history: trimmedHistory,
            message: condensedMessage,
            onChunk,
          });
          resolvedSource = "on_device";
        } else if (
          !forceOnDevice &&
          (isRetryableCloudError(streamErr) || isQuotaExceededError(streamErr))
        ) {
          const { result: cloudChatOut } = await runCloudWithFallbackChain({
            label: "Field Assistant Chat",
            preferredModel:
              remoteConfig.active_cloud_model || DEFAULT_CLOUD_MODEL,
            execute: async (modelName) => {
              const cloudChatModel = getGenerativeModel(ai, {
                mode: InferenceMode.ONLY_IN_CLOUD,
                inCloudParams: {
                  model: modelName,
                  systemInstruction: assistantSystemInstruction,
                  generationConfig: { maxOutputTokens: 768 },
                },
              });
              return runSdkStream(cloudChatModel, message.trim());
            },
          });
          fullText = cloudChatOut.text;
          resolvedSource = "in_cloud";
        } else {
          throw streamErr;
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log("[AI Engine] 4. Raw SDK response received:", {
      operation: "streamFieldAssistantChat",
      inferenceSource: resolvedSource,
      elapsedMs,
      elapsedSec: `${(elapsedMs / 1000).toFixed(2)}s`,
      responseChars: fullText.length,
    });

    if (!fullText) {
      throw new Error("Assistant returned an empty response.");
    }

    return {
      text: fullText,
      inferenceSource: resolvedSource,
      latencyMs: Math.max(120, elapsedMs),
    };
  } catch (err) {
    console.error("[AI Engine] FAILED:", err);
    throw err;
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Gemini TTS often returns raw linear PCM (`audio/L16;codec=pcm;rate=24000`).
 * Wrapping raw PCM with a standard 44-byte RIFF/WAV header makes it 100% playable
 * in HTML5 <audio> elements across all desktop and mobile browsers.
 */
function buildPlayableAudioBlob(base64: string, mimeType: string): {
  blob: Blob;
  playableMimeType: string;
} {
  const rawBytes = base64ToUint8Array(base64);
  const lower = mimeType.toLowerCase();

  if (lower.includes("pcm") || lower.includes("l16")) {
    const rateMatch = lower.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? Number.parseInt(rateMatch[1], 10) || 24000 : 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeAscii = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + rawBytes.byteLength, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeAscii(36, "data");
    view.setUint32(40, rawBytes.byteLength, true);

    const wavBytes = new Uint8Array(44 + rawBytes.byteLength);
    wavBytes.set(new Uint8Array(header), 0);
    wavBytes.set(rawBytes, 44);
    return {
      blob: new Blob([wavBytes], { type: "audio/wav" }),
      playableMimeType: "audio/wav",
    };
  }

  const normalizedMime = mimeType || "audio/wav";
  const copy = new Uint8Array(rawBytes.byteLength);
  copy.set(rawBytes);
  return {
    blob: new Blob([copy], { type: normalizedMime }),
    playableMimeType: normalizedMime,
  };
}

export interface PersonaSpeechResult {
  audioUrl: string;
  mimeType: string;
  script: string;
  voiceName: "Aoede" | "Fenrir";
  modelUsed: string;
}

/**
 * Generates natural human voice synthesis via Firebase AI Logic Cloud TTS
 * (`ResponseModality.AUDIO` + `speechConfig`) preceded by the domain's published
 * Server Prompt Template (`agri-voice-briefing` or `site-voice-briefing`).
 *
 * Strictly online-only: returns `null` immediately when offline or simulating offline.
 */
export async function generatePersonaSpeech(
  text: string,
  domain: FieldDomain,
  options?: {
    isSimulatedOffline?: boolean;
    remoteConfig?: RemoteConfigValues;
  }
): Promise<PersonaSpeechResult | null> {
  const isSimulatedOffline = options?.isSimulatedOffline ?? false;
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    isSimulatedOffline
  ) {
    console.log("[Cloud TTS] Skipped (offline guard active).");
    return null;
  }

  const cleanBrief = text.trim();
  if (!cleanBrief) return null;

  const ai = getHybridAI();
  const voiceName: "Aoede" | "Fenrir" = domain === "agri" ? "Aoede" : "Fenrir";
  const voiceTemplateId =
    domain === "agri"
      ? options?.remoteConfig?.agri_voice_template_id || "agri-voice-briefing"
      : options?.remoteConfig?.site_voice_template_id || "site-voice-briefing";

  // Step 1: Rewrite briefText via the domain's Server Prompt Template for natural spoken delivery
  let spokenScript = cleanBrief;
  try {
    console.log(
      `[Cloud TTS] 1. Rewriting voice script via Server Prompt Template ("${voiceTemplateId}")...`
    );
    const templateModel = getTemplateGenerativeModel(ai);
    const tplRes = await templateModel.generateContent({
      templateId: voiceTemplateId,
      templateVariables: {
        briefText: cleanBrief,
      },
    });
    const rewritten = tplRes.response?.text()?.trim();
    if (rewritten) {
      spokenScript = rewritten;
      console.log("[Cloud TTS] 1b. Template voice script ready:", {
        templateId: voiceTemplateId,
        chars: spokenScript.length,
      });
    }
  } catch (tplErr) {
    console.warn(
      `[Cloud TTS] Voice template "${voiceTemplateId}" unavailable — using direct persona style:`,
      tplErr
    );
  }

  const personaDirection =
    domain === "agri"
      ? "Speak like a warm, encouraging agricultural instructor and trusted friend:"
      : "Speak like a crisp, authoritative site-ops supervisor and co-worker:";

  const ttsPrompt = `${personaDirection}\n\n${spokenScript}`;
  const ttsModels = [
    "gemini-2.5-flash-preview-tts",
    ...CLOUD_FALLBACK_CHAIN,
  ];

  let lastErr: unknown = null;
  for (let i = 0; i < ttsModels.length; i++) {
    const modelName = ttsModels[i];
    try {
      console.log(
        `[Cloud TTS] 2. Generating audio via ${modelName} (voice: ${voiceName})...`
      );
      const ttsModel = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: modelName,
          generationConfig: {
            responseModalities: [ResponseModality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        },
      });

      const res = await ttsModel.generateContent(ttsPrompt);
      const parts = res.response?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ("inlineData" in part && part.inlineData?.data) {
          const { blob, playableMimeType } = buildPlayableAudioBlob(
            part.inlineData.data,
            part.inlineData.mimeType || "audio/wav"
          );
          const audioUrl = URL.createObjectURL(blob);
          console.log("[Cloud TTS] 3. Audio Blob URL ready:", {
            model: modelName,
            voiceName,
            mimeType: playableMimeType,
            bytes: blob.size,
          });
          return {
            audioUrl,
            mimeType: playableMimeType,
            script: spokenScript,
            voiceName,
            modelUsed: modelName,
          };
        }
      }

      throw new Error(`Model ${modelName} returned no audio inlineData part.`);
    } catch (err) {
      lastErr = err;
      if (i < ttsModels.length - 1) {
        console.warn(
          `[Cloud TTS] ${modelName} failed — falling back to ${ttsModels[i + 1]}:`,
          err
        );
      }
    }
  }

  console.error("[Cloud TTS] FAILED:", lastErr);
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Cloud natural voice synthesis failed.");
}

interface LiveSessionLike {
  sendAudioRealtime?: (chunk: { data: string; mimeType: string }) => Promise<void> | void;
  send?: (input: string) => Promise<void> | void;
  receive?: () => AsyncIterable<{
    type?: string;
    serverContent?: {
      modelTurn?: {
        parts?: Array<{
          text?: string;
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    };
  }>;
  close?: () => Promise<void> | void;
}

interface LiveGenerativeModelLike {
  connect: () => Promise<LiveSessionLike>;
}

interface FirebaseAiLiveModule {
  getLiveGenerativeModel?: (
    ai: AI,
    params: {
      model: string;
      generationConfig: {
        responseModalities: ResponseModality[];
      };
      systemInstruction?: string;
    }
  ) => LiveGenerativeModelLike;
}

export interface LiveVoiceSessionHandle {
  connected: boolean;
  modelUsed?: string;
  fallbackReason?: string;
  stop: () => Promise<void>;
}

function pcmFloat32ToBase64Int16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Attempts real-time bidirectional audio streaming via Firebase AI Logic Live API
 * (`gemini-3.1-flash-live-preview`). Never throws if unavailable or offline — returns
 * `{ connected: false, fallbackReason }` so callers seamlessly fall back to turn-based
 * `MediaRecorder` + `generatePersonaSpeech`.
 */
export async function startGeminiLiveVoiceSession(params: {
  domain: FieldDomain;
  locationLabel?: string;
  isSimulatedOffline?: boolean;
  onAudioReplyUrl?: (audioUrl: string, transcript?: string) => void;
  onStatusChange?: (status: string) => void;
}): Promise<LiveVoiceSessionHandle> {
  const noopStop = async () => {};
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    params.isSimulatedOffline
  ) {
    return {
      connected: false,
      fallbackReason: "Live Cloud Voice requires an internet connection.",
      stop: noopStop,
    };
  }

  try {
    const aiMod = (await import("firebase/ai")) as unknown as FirebaseAiLiveModule;
    if (typeof aiMod.getLiveGenerativeModel !== "function") {
      return {
        connected: false,
        fallbackReason: "Using Turn-Based Voice Mode",
        stop: noopStop,
      };
    }

    const activeAppCheck = exportedAppCheck ?? initFirebaseAppCheck();
    if (activeAppCheck) {
      try {
        await getAppCheckToken(activeAppCheck, false);
      } catch {
        return {
          connected: false,
          fallbackReason: "Using Turn-Based Voice Mode",
          stop: noopStop,
        };
      }
    }

    const ai = getHybridAI();

    const liveModelName = "gemini-3.1-flash-live-preview";
    const systemInstruction =
      params.domain === "agri"
        ? `You are TerraPulse AI, a warm, helpful agricultural instructor for ${params.locationLabel || "the farm"}. Speak naturally in concise 1-3 sentence replies.`
        : `You are TerraPulse AI, a crisp, authoritative construction site-ops supervisor for ${params.locationLabel || "the site"}. Speak naturally in concise 1-3 sentence replies.`;

    params.onStatusChange?.(`Connecting to ${liveModelName}...`);
    const liveModel = aiMod.getLiveGenerativeModel(ai, {
      model: liveModelName,
      generationConfig: {
        responseModalities: [ResponseModality.AUDIO],
      },
      systemInstruction,
    });

    const session = await liveModel.connect();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtxCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    const audioCtx = new AudioCtxCtor({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    let active = true;

    processor.onaudioprocess = (evt) => {
      if (!active || !session.sendAudioRealtime) return;
      const pcmData = evt.inputBuffer.getChannelData(0);
      const base64Pcm = pcmFloat32ToBase64Int16(pcmData);
      Promise.resolve(
        session.sendAudioRealtime({
          data: base64Pcm,
          mimeType: "audio/pcm;rate=16000",
        })
      ).catch(() => {});
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // Listen for incoming audio replies asynchronously
    if (typeof session.receive === "function") {
      (async () => {
        try {
          const iterable = session.receive?.();
          if (!iterable) return;
          for await (const message of iterable) {
            if (!active) break;
            const parts = message.serverContent?.modelTurn?.parts ?? [];
            let transcriptChunk = "";
            for (const part of parts) {
              if (part.text) transcriptChunk += part.text;
              if (part.inlineData?.data) {
                const { blob } = buildPlayableAudioBlob(
                  part.inlineData.data,
                  part.inlineData.mimeType || "audio/pcm;rate=24000"
                );
                const audioUrl = URL.createObjectURL(blob);
                params.onAudioReplyUrl?.(audioUrl, transcriptChunk.trim() || undefined);
              }
            }
          }
        } catch (recvErr) {
          console.warn("[Live Voice] Receive stream ended:", recvErr);
        }
      })();
    }

    params.onStatusChange?.(`Live Voice Active (${liveModelName})`);
    return {
      connected: true,
      modelUsed: liveModelName,
      stop: async () => {
        active = false;
        try {
          processor.disconnect();
          source.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          await audioCtx.close();
          await session.close?.();
        } catch {
          // ignore cleanup errors
        }
      },
    };
  } catch {
    return {
      connected: false,
      fallbackReason: "Using Turn-Based Voice Mode",
      stop: noopStop,
    };
  }
}
