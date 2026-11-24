"use client";

const SAFE_AUTH_MESSAGES: Array<{ patterns: string[]; message: string }> = [
  {
    patterns: [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
    ],
    message: "Invalid email or password.",
  },
  {
    patterns: [
      "auth/email-already-in-use",
      "auth/credential-already-in-use",
    ],
    message: "An account with this email already exists. Try signing in instead.",
  },
  {
    patterns: ["auth/weak-password"],
    message: "Password must be at least 6 characters.",
  },
  {
    patterns: ["auth/invalid-email"],
    message: "Please enter a valid email address.",
  },
  {
    patterns: ["auth/popup-closed-by-user"],
    message: "Google sign-in was closed before completion.",
  },
  {
    patterns: ["auth/too-many-requests"],
    message: "Too many attempts. Please wait a moment and try again.",
  },
];

const NETWORK_ERROR_PATTERNS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "auth/network-request-failed",
  "appcheck/fetch-network-error",
  "err_internet_disconnected",
  "err_network",
  "load failed",
  "networkerror when attempting to fetch",
  "unavailable",
  "client is offline",
];

const TECHNICAL_LEAK_PATTERNS = [
  "firebaseerror",
  "firebase:",
  "ai/",
  "appcheck/",
  "app check",
  "firestore/",
  "http ",
  "status 500",
  "status 503",
  "status 429",
  "status 404",
  "status 403",
  "status 401",
  "500",
  "503",
  "429",
  "404",
  "quota",
  "resource_exhausted",
  "permission_denied",
  "unauthenticated",
  "generativelanguage",
  "googleapis",
  "websocket",
  "stack",
];

function extractRawErrorText(error: unknown): string {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown };
    const codePart = typeof withCode.code === "string" ? `${withCode.code} ` : "";
    return `${codePart}${error.name} ${error.message}`.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  if (typeof error === "object" && error !== null) {
    const obj = error as { code?: unknown; message?: unknown };
    const parts = [
      typeof obj.code === "string" ? obj.code : "",
      typeof obj.message === "string" ? obj.message : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return String(error ?? "");
}

function mapErrorToFriendlyText(raw: string): string {
  const lower = raw.toLowerCase();

  // 1. Expected user-actionable Auth errors
  for (const entry of SAFE_AUTH_MESSAGES) {
    if (entry.patterns.some((p) => lower.includes(p))) {
      return entry.message;
    }
  }

  // 2. Network / Offline drops
  const isNavigatorOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (
    isNavigatorOffline ||
    NETWORK_ERROR_PATTERNS.some((p) => lower.includes(p))
  ) {
    return "Network connection lost. Please check your signal and try again.";
  }

  // 3. All server, App Check, quota, model, or unexpected SDK errors
  return "Server error, please try again later.";
}

/**
 * Logs raw developer error details to the console and returns a sanitized,
 * user-friendly message safe to display in any TerraPulse AI UI element.
 */
export function formatUserFacingError(error: unknown): string {
  console.error("[TerraPulse Internal Error]", error);
  const raw = extractRawErrorText(error);
  return mapErrorToFriendlyText(raw);
}

/**
 * Sanitizes an already-stored error string (e.g. legacy Firestore `cloudAuditError`)
 * before rendering it in the DOM so raw Firebase/SDK codes never appear in the UI.
 */
export function sanitizeStoredErrorMessage(
  rawMessage: string | null | undefined
): string | null {
  if (!rawMessage || !rawMessage.trim()) return null;
  const trimmed = rawMessage.trim();
  const lower = trimmed.toLowerCase();
  if (
    trimmed === "Server error, please try again later." ||
    trimmed === "Network connection lost. Please check your signal and try again."
  ) {
    return trimmed;
  }
  if (TECHNICAL_LEAK_PATTERNS.some((p) => lower.includes(p))) {
    return mapErrorToFriendlyText(trimmed);
  }
  return mapErrorToFriendlyText(trimmed);
}
