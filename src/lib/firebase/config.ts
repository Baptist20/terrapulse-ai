import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, GoogleAuthProvider, getAuth } from "firebase/auth";
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { AI, GoogleAIBackend, getAI } from "firebase/ai";
import {
  AppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
  initializeAppCheck,
} from "firebase/app-check";
import {
  RemoteConfig,
  fetchAndActivate,
  getBoolean,
  getNumber,
  getRemoteConfig,
  getString,
} from "firebase/remote-config";
import { AppCheckTelemetry, RemoteConfigValues } from "@/types/terrapulse";

const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyBXHEIYoc_arWgtqagkAYz8xjTneZpRg1A",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "hybridailearning.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "hybridailearning",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "hybridailearning.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "263665345827",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:263665345827:web:5073e5e1b87e9e96885896",
};

export const DEFAULT_REMOTE_CONFIG: RemoteConfigValues = {
  agri_system_prompt:
    "Agronomy & livestock field triage copilot. Analyze crop, pest, soil, or livestock symptoms and give a concise offline containment step for voice readout.",
  construction_system_prompt:
    "Civil & construction site safety copilot. Classify concrete cracks, seepage, rebar, or trench defects and give a concise offline safety step for voice readout.",
  active_cloud_model: "gemini-3.8-flash",
  triage_max_tokens: 512,
  prompt_config_version: "v1.4-field-ops",
  auto_queue_critical_logs: true,
  agri_audit_template_id: "agri-deep-audit",
  agri_synthesis_template_id: "agri-weekly-synthesis",
  agri_voice_template_id: "agri-voice-briefing",
  site_audit_template_id: "site-deep-audit",
  site_synthesis_template_id: "site-weekly-synthesis",
  site_voice_template_id: "site-voice-briefing",
  source: "default",
  lastFetchedAt: null,
};

const REMOTE_CONFIG_CACHE_KEY = "terrapulse_remote_config_v3";

// 1. Strict top-level FirebaseApp singleton
export const firebaseApp: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedAppCheck: AppCheck | null = null;
let cachedRemoteConfig: RemoteConfig | null = null;

let appCheckTelemetry: AppCheckTelemetry = {
  initialized: false,
  verified: false,
  mode: "uninitialized",
  message: "Initializing App Check...",
};

interface DebugTokenGlobal {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  __TERRAPULSE_APP_CHECK__?: AppCheck | null;
}

export let appCheck: AppCheck | null = null;

export function initFirebaseAppCheck(): AppCheck | null {
  if (typeof window === "undefined") return null;

  const globalScope = self as unknown as DebugTokenGlobal;
  if (globalScope.__TERRAPULSE_APP_CHECK__) {
    cachedAppCheck = globalScope.__TERRAPULSE_APP_CHECK__;
    appCheck = cachedAppCheck;
    return cachedAppCheck;
  }
  if (cachedAppCheck) {
    appCheck = cachedAppCheck;
    return cachedAppCheck;
  }

  const isDevHost =
    process.env.NODE_ENV === "development" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const configuredDebugToken =
    process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim();
  const enterpriseKey = (
    process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY ||
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  )?.trim();
  const v3Key = process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY?.trim();

  try {
    // 2. Set debug token on `self` BEFORE calling initializeAppCheck(...)
    if (isDevHost || configuredDebugToken) {
      const debugValue =
        configuredDebugToken && configuredDebugToken !== "true"
          ? configuredDebugToken
          : true;
      globalScope.FIREBASE_APPCHECK_DEBUG_TOKEN = debugValue;
      console.log(
        "[App Check] Debug token enabled:",
        debugValue === true ? true : "(custom UUID from env)"
      );
    }

    if (isDevHost || configuredDebugToken || enterpriseKey || v3Key) {
      const providerName = enterpriseKey
        ? "ReCaptchaEnterpriseProvider"
        : "ReCaptchaV3Provider";
      const provider = enterpriseKey
        ? new ReCaptchaEnterpriseProvider(enterpriseKey)
        : new ReCaptchaV3Provider(
            v3Key ?? "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
          );

      console.log(`[App Check] Calling initializeAppCheck with ${providerName}...`);
      cachedAppCheck = initializeAppCheck(firebaseApp, {
        provider,
        isTokenAutoRefreshEnabled: true,
      });
      globalScope.__TERRAPULSE_APP_CHECK__ = cachedAppCheck;
      appCheck = cachedAppCheck;
      console.log("[App Check] initializeAppCheck succeeded (isTokenAutoRefreshEnabled: true).");

      appCheckTelemetry = {
        initialized: true,
        verified: false,
        mode:
          isDevHost || configuredDebugToken
            ? "debug_token"
            : "recaptcha_enterprise",
        message:
          isDevHost || configuredDebugToken
            ? "Debug Token Active — check browser console for App Check debug token"
            : enterpriseKey
              ? "reCAPTCHA Enterprise Enforced"
              : "reCAPTCHA v3 Enforced",
      };
    } else {
      appCheckTelemetry = {
        initialized: false,
        verified: false,
        mode: "uninitialized",
        message:
          "Set NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY or NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY for production",
      };
    }
  } catch (err) {
    appCheckTelemetry = {
      initialized: false,
      verified: false,
      mode: "uninitialized",
      message:
        err instanceof Error ? err.message : "App Check initialization deferred",
    };
  }

  return cachedAppCheck;
}

// 3. Initialize App Check on the client BEFORE calling getAI, getFirestore, or getAuth
if (typeof window !== "undefined") {
  initFirebaseAppCheck();
}

// 4. Export exact AI singleton bound to the App-Check-initialized firebaseApp
export const ai: AI = getAI(firebaseApp, {
  backend: new GoogleAIBackend(),
});

export function getFirebaseApp(): FirebaseApp {
  if (typeof window !== "undefined") {
    initFirebaseAppCheck();
  }
  return firebaseApp;
}

export function getFirebaseAuth(): Auth {
  if (typeof window !== "undefined") {
    initFirebaseAppCheck();
  }
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(firebaseApp);
  return cachedAuth;
}

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: "select_account" });

export function getFirebaseDb(): Firestore {
  if (typeof window !== "undefined") {
    initFirebaseAppCheck();
  }
  if (cachedDb) return cachedDb;

  if (typeof window === "undefined") {
    cachedDb = getFirestore(firebaseApp);
    return cachedDb;
  }

  try {
    cachedDb = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
    console.log(
      "[Firestore] Persistent cache initialized (persistentLocalCache + persistentMultipleTabManager)"
    );
  } catch {
    // Already initialized (e.g. Next.js Fast Refresh) — retrieve existing instance
    cachedDb = getFirestore(firebaseApp);
    console.log("[Firestore] Persistent cache reused (existing Firestore instance)");
  }
  return cachedDb;
}

export function getFirebaseAI(): AI {
  if (typeof window !== "undefined") {
    initFirebaseAppCheck();
  }
  return ai;
}

export async function inspectAppCheckStatus(): Promise<AppCheckTelemetry> {
  if (typeof window === "undefined") return appCheckTelemetry;
  const ac = initFirebaseAppCheck();
  if (!ac) return appCheckTelemetry;

  try {
    const tokenRes = await getAppCheckToken(ac, false);
    if (tokenRes.token) {
      appCheckTelemetry = {
        ...appCheckTelemetry,
        initialized: true,
        verified: true,
        message:
          appCheckTelemetry.mode === "debug_token"
            ? "Debug Token Verified (App Check Active)"
            : appCheckTelemetry.message,
      };
    }
  } catch {
    appCheckTelemetry = {
      ...appCheckTelemetry,
      initialized: true,
      verified: false,
      message:
        appCheckTelemetry.mode === "debug_token"
          ? "Copy App Check debug token from browser console into Firebase Console → App Check → Manage debug tokens"
          : "App Check token exchange pending (check network or site key)",
    };
  }

  return appCheckTelemetry;
}

export function getFirebaseRemoteConfig(): RemoteConfig | null {
  if (typeof window === "undefined") return null;
  if (cachedRemoteConfig) return cachedRemoteConfig;

  try {
    const rc = getRemoteConfig(getFirebaseApp());
    rc.settings.minimumFetchIntervalMillis = 60_000;
    rc.defaultConfig = {
      agri_system_prompt: DEFAULT_REMOTE_CONFIG.agri_system_prompt,
      construction_system_prompt:
        DEFAULT_REMOTE_CONFIG.construction_system_prompt,
      active_cloud_model: DEFAULT_REMOTE_CONFIG.active_cloud_model,
      triage_max_tokens: DEFAULT_REMOTE_CONFIG.triage_max_tokens,
      prompt_config_version: DEFAULT_REMOTE_CONFIG.prompt_config_version,
      auto_queue_critical_logs: DEFAULT_REMOTE_CONFIG.auto_queue_critical_logs,
      agri_audit_template_id: DEFAULT_REMOTE_CONFIG.agri_audit_template_id,
      agri_synthesis_template_id:
        DEFAULT_REMOTE_CONFIG.agri_synthesis_template_id,
      agri_voice_template_id: DEFAULT_REMOTE_CONFIG.agri_voice_template_id,
      site_audit_template_id: DEFAULT_REMOTE_CONFIG.site_audit_template_id,
      site_synthesis_template_id:
        DEFAULT_REMOTE_CONFIG.site_synthesis_template_id,
      site_voice_template_id: DEFAULT_REMOTE_CONFIG.site_voice_template_id,
    };
    cachedRemoteConfig = rc;
    return rc;
  } catch {
    return null;
  }
}

export function loadCachedRemoteConfig(): RemoteConfigValues {
  if (typeof window === "undefined") return DEFAULT_REMOTE_CONFIG;
  try {
    const raw = localStorage.getItem(REMOTE_CONFIG_CACHE_KEY);
    if (!raw) return DEFAULT_REMOTE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RemoteConfigValues>;
    return {
      ...DEFAULT_REMOTE_CONFIG,
      ...parsed,
      source: parsed.source ?? "cached",
    };
  } catch {
    return DEFAULT_REMOTE_CONFIG;
  }
}

export async function fetchAndCacheRemoteConfig(): Promise<RemoteConfigValues> {
  const cached = loadCachedRemoteConfig();
  if (typeof window === "undefined" || !navigator.onLine) {
    return { ...cached, source: cached.lastFetchedAt ? "cached" : "default" };
  }

  const rc = getFirebaseRemoteConfig();
  if (!rc) return cached;

  try {
    await fetchAndActivate(rc);
    const values: RemoteConfigValues = {
      agri_system_prompt:
        getString(rc, "agri_system_prompt") ||
        DEFAULT_REMOTE_CONFIG.agri_system_prompt,
      construction_system_prompt:
        getString(rc, "construction_system_prompt") ||
        DEFAULT_REMOTE_CONFIG.construction_system_prompt,
      active_cloud_model:
        getString(rc, "active_cloud_model") ||
        DEFAULT_REMOTE_CONFIG.active_cloud_model,
      triage_max_tokens:
        getNumber(rc, "triage_max_tokens") ||
        DEFAULT_REMOTE_CONFIG.triage_max_tokens,
      prompt_config_version:
        getString(rc, "prompt_config_version") ||
        DEFAULT_REMOTE_CONFIG.prompt_config_version,
      auto_queue_critical_logs: getBoolean(rc, "auto_queue_critical_logs"),
      agri_audit_template_id:
        getString(rc, "agri_audit_template_id") ||
        DEFAULT_REMOTE_CONFIG.agri_audit_template_id,
      agri_synthesis_template_id:
        getString(rc, "agri_synthesis_template_id") ||
        DEFAULT_REMOTE_CONFIG.agri_synthesis_template_id,
      agri_voice_template_id:
        getString(rc, "agri_voice_template_id") ||
        DEFAULT_REMOTE_CONFIG.agri_voice_template_id,
      site_audit_template_id:
        getString(rc, "site_audit_template_id") ||
        DEFAULT_REMOTE_CONFIG.site_audit_template_id,
      site_synthesis_template_id:
        getString(rc, "site_synthesis_template_id") ||
        DEFAULT_REMOTE_CONFIG.site_synthesis_template_id,
      site_voice_template_id:
        getString(rc, "site_voice_template_id") ||
        DEFAULT_REMOTE_CONFIG.site_voice_template_id,
      source: "remote",
      lastFetchedAt: Date.now(),
    };

    try {
      localStorage.setItem(REMOTE_CONFIG_CACHE_KEY, JSON.stringify(values));
    } catch {
      // ignore quota errors
    }

    return values;
  } catch {
    return { ...cached, source: cached.lastFetchedAt ? "cached" : "default" };
  }
}
