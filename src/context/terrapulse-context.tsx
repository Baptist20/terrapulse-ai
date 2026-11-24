"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_REMOTE_CONFIG,
  fetchAndCacheRemoteConfig,
  getFirebaseDb,
  inspectAppCheckStatus,
  loadCachedRemoteConfig,
} from "@/lib/firebase/config";
import {
  runCloudDeepAudit,
  runFieldTriage,
  runWeeklySynthesis,
} from "@/lib/ai/hybridEngine";
import {
  AppCheckTelemetry,
  CloudAuditResult,
  FieldDomain,
  FieldLog,
  InlineMediaInput,
  RemoteConfigValues,
  SynthesisReport,
  UserProfile,
} from "@/types/terrapulse";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

export interface AddFieldLogResult {
  log: FieldLog | null;
  isActionableFieldIssue: boolean;
  conversationalReply?: string;
  inferenceSource: "on_device" | "in_cloud";
}

interface TerraPulseContextValue {
  user: UserProfile;
  domain: FieldDomain;
  isRoleLocked: boolean;
  setDomain: (d: FieldDomain) => void;
  updateProfile: (partial: Partial<UserProfile>) => void;
  isOffline: boolean;
  browserOffline: boolean;
  simulateOffline: boolean;
  setSimulateOffline: (val: boolean) => void;
  checkConnectivityNow: () => Promise<boolean>;
  logs: FieldLog[];
  logsLoading: boolean;
  synthesisReports: SynthesisReport[];
  pendingSyncCount: number;
  lastError: string | null;
  clearLastError: () => void;
  remoteConfig: RemoteConfigValues;
  refreshRemoteConfig: () => Promise<RemoteConfigValues>;
  appCheckStatus: AppCheckTelemetry;
  refreshAppCheckStatus: () => Promise<AppCheckTelemetry>;
  addFieldLog: (input: {
    rawInput: string;
    locationTag: string;
    domain: FieldDomain;
    imageBase64?: string | null;
    audioAttachment?: InlineMediaInput | null;
    videoAttachment?: InlineMediaInput | null;
    documentAttachment?: { name: string; text: string } | null;
    autoQueueCloudAudit?: boolean;
    onDeviceInitProgress?: (pct: number) => void;
    onStreamChunk?: (accumulatedText: string) => void;
  }) => Promise<AddFieldLogResult>;
  runOrQueueCloudAudit: (logId: string) => Promise<void>;
  setLogAuditState: (
    logId: string,
    status: FieldLog["cloudAuditStatus"]
  ) => Promise<void>;
  updateLogTitle: (logId: string, title: string) => Promise<void>;
  deleteFieldLog: (logId: string) => Promise<void>;
  toggleRemediationStep: (logId: string, stepIndex: number) => Promise<void>;
  generateVisualDiagram: (logId: string) => Promise<void>;
  generateSynthesisReport: (
    selectedLogIds: string[]
  ) => Promise<SynthesisReport | null>;
  toggleSynthesisTask: (reportId: string, taskIndex: number) => Promise<void>;
  loadSampleData: () => Promise<void>;
  resetData: () => Promise<void>;
}

const SIM_OFFLINE_KEY = "terrapulse_sim_offline_v1";

const FALLBACK_USER: UserProfile = {
  uid: "unauthenticated",
  displayName: "Field Operator",
  email: null,
  defaultDomain: "agri",
  zone: "",
  locationLabel: "",
  onboardingCompleted: false,
  isAnonymous: true,
  createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
};

const TerraPulseContext = createContext<TerraPulseContextValue | null>(null);

function toEpochSeconds(ts: { seconds: number } | undefined): number {
  return typeof ts?.seconds === "number" ? ts.seconds : 0;
}

interface NetworkInformationLike extends EventTarget {
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

async function probeInternetConnectivity(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(`https://www.gstatic.com/generate_204?t=${Date.now()}`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function TerraPulseProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, effectiveUid, profile, updateUserProfile } = useAuth();

  const [domainOverride, setDomainOverride] = useState<FieldDomain | null>(null);
  const [browserOffline, setBrowserOffline] = useState(false);
  const [simulateOffline, setSimulateOfflineState] = useState(false);
  const [logs, setLogs] = useState<FieldLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [synthesisReports, setSynthesisReports] = useState<SynthesisReport[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<RemoteConfigValues>(
    DEFAULT_REMOTE_CONFIG
  );
  const [appCheckStatus, setAppCheckStatus] = useState<AppCheckTelemetry>({
    initialized: false,
    verified: false,
    mode: "uninitialized",
    message: "Checking App Check status...",
  });

  const processingAuditIdsRef = useRef<Set<string>>(new Set());

  const user: UserProfile = profile ?? FALLBACK_USER;
  const assignedDomain: FieldDomain | null =
    profile?.domain === "agri" || profile?.domain === "construction"
      ? profile.domain
      : null;
  const isRoleLocked = Boolean(assignedDomain);
  const domain: FieldDomain =
    assignedDomain ?? domainOverride ?? user.defaultDomain;
  const isOffline = browserOffline || simulateOffline;

  const checkConnectivityNow = useCallback(async (): Promise<boolean> => {
    const online = await probeInternetConnectivity();
    setBrowserOffline((prev) => {
      if (prev && online) {
        fetchAndCacheRemoteConfig().then(setRemoteConfig).catch(() => {});
        inspectAppCheckStatus().then(setAppCheckStatus).catch(() => {});
      }
      return !online;
    });
    return online;
  }, []);

  // Hydrate offline flag, global automatic network detection, Remote Config & App Check
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const storedSim = localStorage.getItem(SIM_OFFLINE_KEY);
        if (storedSim === "1") setSimulateOfflineState(true);
      } catch {
        // ignore
      }
      setBrowserOffline(!navigator.onLine);
      setRemoteConfig(loadCachedRemoteConfig());
    });

    probeInternetConnectivity()
      .then((online) => setBrowserOffline(!online))
      .catch(() => {});
    fetchAndCacheRemoteConfig().then(setRemoteConfig).catch(() => {});
    inspectAppCheckStatus().then(setAppCheckStatus).catch(() => {});

    const handleOnline = () => {
      setBrowserOffline(false);
      void checkConnectivityNow();
    };
    const handleOffline = () => {
      setBrowserOffline(true);
    };
    const handleVisibilityOrFocus = () => {
      if (typeof document === "undefined" || !document.hidden) {
        void checkConnectivityNow();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    const navConnection = (navigator as NavigatorWithConnection).connection;
    navConnection?.addEventListener("change", handleVisibilityOrFocus);

    // Periodic 4-second reachability probe handles cases where Windows/Chrome
    // keeps navigator.onLine === true despite Wi-Fi or upstream internet dropping.
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void checkConnectivityNow();
      }
    }, 4000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      navConnection?.removeEventListener("change", handleVisibilityOrFocus);
      window.clearInterval(intervalId);
    };
  }, [checkConnectivityNow]);

  const setSimulateOffline = useCallback((val: boolean) => {
    setSimulateOfflineState(val);
    try {
      localStorage.setItem(SIM_OFFLINE_KEY, val ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  // Real-time Firestore listener for user's fieldLogs (with metadata.fromCache)
  useEffect(() => {
    if (!effectiveUid) {
      queueMicrotask(() => {
        setLogs([]);
        setSynthesisReports([]);
        setLogsLoading(false);
      });
      return;
    }

    const db = getFirebaseDb();
    const logsQuery = query(
      collection(db, "fieldLogs"),
      where("userId", "==", effectiveUid)
    );

    const unsubLogs = onSnapshot(
      logsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextLogs: FieldLog[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Omit<
            FieldLog,
            "id" | "isSyncedToCloud"
          >;
          const synced =
            !docSnap.metadata.fromCache && !docSnap.metadata.hasPendingWrites;
          return {
            ...data,
            id: docSnap.id,
            isSyncedToCloud: synced,
          };
        });

        nextLogs.sort(
          (a, b) => toEpochSeconds(b.createdAt) - toEpochSeconds(a.createdAt)
        );
        setLogs(nextLogs);
        setLogsLoading(false);
      },
      (err) => {
        setLastError(formatUserFacingError(err));
        setLogsLoading(false);
      }
    );

    const reportsQuery = query(
      collection(db, "synthesisReports"),
      where("userId", "==", effectiveUid)
    );

    const unsubReports = onSnapshot(
      reportsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextReports: SynthesisReport[] = snapshot.docs.map((docSnap) => ({
          ...(docSnap.data() as Omit<SynthesisReport, "id">),
          id: docSnap.id,
        }));
        nextReports.sort(
          (a, b) => toEpochSeconds(b.createdAt) - toEpochSeconds(a.createdAt)
        );
        setSynthesisReports(nextReports);
      },
      () => {
        // Ignore transient synthesis listener errors offline
      }
    );

    return () => {
      unsubLogs();
      unsubReports();
    };
  }, [effectiveUid]);

  const executeCloudAudit = useCallback(
    async (targetLog: FieldLog, rethrowOnError = false) => {
      if (processingAuditIdsRef.current.has(targetLog.id)) return;
      processingAuditIdsRef.current.add(targetLog.id);

      const db = getFirebaseDb();
      const logRef = doc(db, "fieldLogs", targetLog.id);

      try {
        console.log(
          `[Firestore] 1. Updating fieldLogs/${targetLog.id} cloudAuditStatus -> "processing"...`
        );
        await Promise.race([
          updateDoc(logRef, {
            cloudAuditStatus: "processing",
            cloudAuditError: null,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 4000)),
        ]);

        const auditData = await runCloudDeepAudit({
          log: targetLog,
          remoteConfig,
        });

        const completedAudit: CloudAuditResult = {
          ...auditData,
          completedAt: Timestamp.now(),
        };

        console.log(
          `[Firestore] 1. Writing completed Cloud Audit to fieldLogs/${targetLog.id}...`
        );
        await updateDoc(logRef, {
          cloudAuditStatus: "completed",
          cloudAuditError: null,
          cloudAudit: completedAudit,
        });
        console.log(
          `[Firestore] 2. Document write resolved with ID: ${targetLog.id} (cloudAuditStatus: completed)`
        );
      } catch (err) {
        const message = formatUserFacingError(err);
        setLastError(message);
        const recoveryStatus: FieldLog["cloudAuditStatus"] =
          typeof navigator !== "undefined" && !navigator.onLine
            ? "queued_offline"
            : "failed";
        await Promise.race([
          updateDoc(logRef, {
            cloudAuditStatus: recoveryStatus,
            cloudAuditError: message,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]).catch((writeErr) =>
          console.error("[Firestore] Failed to reset cloudAuditStatus:", writeErr)
        );
        if (rethrowOnError) {
          throw err;
        }
      } finally {
        processingAuditIdsRef.current.delete(targetLog.id);
      }
    },
    [remoteConfig]
  );

  // Global Background Auto-Sync Queue Listener:
  // Automatically runs Gemini 3.8 Flash Cloud Deep Audit for queued_offline logs
  // the exact moment navigator.onLine === true AND simulateOffline === false.
  useEffect(() => {
    if (!firebaseUser || isOffline) return;

    const queued = logs.filter(
      (log) =>
        log.cloudAuditStatus === "queued_offline" &&
        !processingAuditIdsRef.current.has(log.id)
    );

    if (queued.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of queued) {
        if (cancelled) break;
        await executeCloudAudit(item);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, isOffline, logs, executeCloudAudit]);

  const setDomain = useCallback(
    (d: FieldDomain) => {
      if (isRoleLocked) return;
      setDomainOverride(d);
      if (firebaseUser) {
        updateUserProfile({ domain: d, defaultDomain: d }).catch(() => {});
      }
    },
    [firebaseUser, isRoleLocked, updateUserProfile]
  );

  const updateProfile = useCallback(
    (partial: Partial<UserProfile>) => {
      const sanitized: Partial<UserProfile> = { ...partial };
      if (isRoleLocked) {
        delete sanitized.domain;
        delete sanitized.defaultDomain;
      } else if (sanitized.defaultDomain || sanitized.domain) {
        setDomainOverride(sanitized.domain ?? sanitized.defaultDomain ?? null);
      }
      updateUserProfile(sanitized).catch(() => {});
    },
    [isRoleLocked, updateUserProfile]
  );

  const addFieldLog = useCallback(
    async (input: {
      rawInput: string;
      locationTag: string;
      domain: FieldDomain;
      imageBase64?: string | null;
      audioAttachment?: InlineMediaInput | null;
      videoAttachment?: InlineMediaInput | null;
      documentAttachment?: { name: string; text: string } | null;
      autoQueueCloudAudit?: boolean;
      onDeviceInitProgress?: (pct: number) => void;
      onStreamChunk?: (accumulatedText: string) => void;
    }): Promise<AddFieldLogResult> => {
      if (!effectiveUid) {
        throw new Error("Sign in or launch demo before creating a field log.");
      }
      setLastError(null);

      const triage = await runFieldTriage({
        rawInput: input.rawInput,
        domain: input.domain,
        locationTag: input.locationTag,
        imageBase64: input.imageBase64,
        audioAttachment: input.audioAttachment,
        videoAttachment: input.videoAttachment,
        documentText: input.documentAttachment?.text ?? null,
        isSimulatedOffline: isOffline,
        remoteConfig,
        onDeviceInitProgress: input.onDeviceInitProgress,
        onStreamChunk: input.onStreamChunk,
      });

      const persistedRawInput = [
        input.rawInput.trim(),
        input.documentAttachment
          ? `[Document: ${input.documentAttachment.name}]\n${input.documentAttachment.text.slice(0, 1200)}`
          : "",
        input.audioAttachment
          ? `[Audio Clip Analyzed: ${input.audioAttachment.name ?? input.audioAttachment.mimeType}]`
          : "",
        input.videoAttachment
          ? `[Video Clip Analyzed: ${input.videoAttachment.name ?? input.videoAttachment.mimeType}]`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      // Smart casual greeting / non-issue guard: respond conversationally without creating a fake Firestore FieldLog
      if (!triage.isActionableFieldIssue) {
        const resolvedDomain = assignedDomain ?? input.domain;
        const fallbackReply =
          resolvedDomain === "agri"
            ? "Hi there! I'm ready whenever you spot a crop symptom, pest, or soil issue — describe it or snap a photo and I'll log a field diagnosis."
            : "Hey there! Standing by for your site inspection — describe a structural defect, hazard, or concrete issue whenever you're ready to log it.";
        return {
          log: null,
          isActionableFieldIssue: false,
          conversationalReply: triage.conversationalReply || fallbackReply,
          inferenceSource: triage.localTriage.inferenceSource,
        };
      }

      const shouldAutoQueue =
        Boolean(input.autoQueueCloudAudit) ||
        (remoteConfig.auto_queue_critical_logs &&
          triage.localTriage.severity === "critical");

      const initialAuditStatus: FieldLog["cloudAuditStatus"] = shouldAutoQueue
        ? "queued_offline"
        : "none";

      const resolvedDomain = assignedDomain ?? input.domain;
      const createdAt = Timestamp.now();
      const payload: Omit<FieldLog, "id" | "isSyncedToCloud"> = {
        userId: effectiveUid,
        domain: resolvedDomain,
        title: triage.title,
        rawInput: persistedRawInput || input.rawInput,
        imageBase64: input.imageBase64 ?? null,
        locationTag:
          input.locationTag.trim() ||
          user.zone ||
          user.locationLabel ||
          "Active Field Zone",
        localTriage: triage.localTriage,
        cloudAuditStatus: initialAuditStatus,
        cloudAuditError: null,
        cloudAudit: null,
        createdAt,
      };

      const db = getFirebaseDb();
      const docRef = doc(collection(db, "fieldLogs"));
      console.log("[Firestore] 1. Writing document to fieldLogs...", {
        id: docRef.id,
        domain: payload.domain,
        title: payload.title,
        hasImage: Boolean(payload.imageBase64),
        cloudAuditStatus: payload.cloudAuditStatus,
        isOffline,
      });

      const writePromise = setDoc(docRef, payload);
      if (isOffline) {
        // Offline persistent cache commits locally synchronously so onSnapshot updates immediately
        // without blocking the UI waiting for server acknowledgment.
        console.log(
          "[Firestore] 2. Document queued locally in IndexedDB (offline) with ID:",
          docRef.id
        );
        writePromise
          .then(() =>
            console.log(
              "[Firestore] 2b. Offline document synced to cloud with ID:",
              docRef.id
            )
          )
          .catch((writeErr) =>
            console.error("[Firestore] Offline document write failed:", writeErr)
          );
      } else {
        await Promise.race([
          writePromise.then(() => {
            console.log(
              "[Firestore] 2. Document write resolved with ID:",
              docRef.id
            );
          }),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              console.log(
                "[Firestore] 2. Document committed to local cache (cloud ACK pending) with ID:",
                docRef.id
              );
              resolve();
            }, 5000)
          ),
        ]);
      }

      return {
        log: {
          ...payload,
          id: docRef.id,
          isSyncedToCloud: !isOffline,
        },
        isActionableFieldIssue: true,
        inferenceSource: triage.localTriage.inferenceSource,
      };
    },
    [assignedDomain, effectiveUid, isOffline, remoteConfig, user.locationLabel, user.zone]
  );

  const runOrQueueCloudAudit = useCallback(
    async (logId: string) => {
      const target = logs.find((l) => l.id === logId);
      if (!target) return;

      const db = getFirebaseDb();
      if (isOffline) {
        console.log(
          `[Firestore] 1. Queueing fieldLogs/${logId} for Cloud Audit offline...`
        );
        updateDoc(doc(db, "fieldLogs", logId), {
          cloudAuditStatus: "queued_offline",
          cloudAuditError: null,
        })
          .then(() =>
            console.log(
              `[Firestore] 2. Queued status synced for ID: ${logId}`
            )
          )
          .catch((err) =>
            console.error("[Firestore] Offline queue update failed:", err)
          );
        return;
      }

      await executeCloudAudit(target, true);
    },
    [executeCloudAudit, isOffline, logs]
  );

  const setLogAuditState = useCallback(
    async (logId: string, status: FieldLog["cloudAuditStatus"]) => {
      const target = logs.find((l) => l.id === logId);
      if (!target) return;

      const db = getFirebaseDb();
      const logRef = doc(db, "fieldLogs", logId);

      if (status === "completed" && !target.cloudAudit && !isOffline) {
        await executeCloudAudit(target, true);
        return;
      }

      console.log(`[Firestore] 1. Updating fieldLogs/${logId} status -> ${status}`);
      const statusWrite = updateDoc(logRef, {
        cloudAuditStatus: status,
        cloudAuditError: null,
      });
      if (isOffline) {
        statusWrite.catch((err) =>
          console.error("[Firestore] Offline status update failed:", err)
        );
      } else {
        await statusWrite;
      }
      console.log(`[Firestore] 2. Document write resolved with ID: ${logId}`);
    },
    [executeCloudAudit, isOffline, logs]
  );

  const updateLogTitle = useCallback(async (logId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const db = getFirebaseDb();
    await updateDoc(doc(db, "fieldLogs", logId), { title: trimmed });
  }, []);

  const deleteFieldLog = useCallback(
    async (logId: string) => {
      if (!effectiveUid || !logId) return;
      const db = getFirebaseDb();
      const logRef = doc(db, "fieldLogs", logId);
      const deletePromise = deleteDoc(logRef);
      if (isOffline) {
        deletePromise.catch((err) =>
          console.error("[Firestore] Offline deleteFieldLog failed:", err)
        );
        return;
      }
      await Promise.race([
        deletePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ]);
    },
    [effectiveUid, isOffline]
  );

  const toggleRemediationStep = useCallback(
    async (logId: string, stepIndex: number) => {
      const target = logs.find((l) => l.id === logId);
      if (!target?.cloudAudit) return;

      const updatedPlan = target.cloudAudit.stepByStepPlan.map((item, idx) =>
        idx === stepIndex ? { ...item, completed: !item.completed } : item
      );

      const db = getFirebaseDb();
      await updateDoc(doc(db, "fieldLogs", logId), {
        "cloudAudit.stepByStepPlan": updatedPlan,
      });
    },
    [logs]
  );

  const generateVisualDiagram = useCallback(
    async (logId: string) => {
      const target = logs.find((l) => l.id === logId);
      if (!target || isOffline) return;
      await executeCloudAudit(target, true);
    },
    [executeCloudAudit, isOffline, logs]
  );

  const generateSynthesisReport = useCallback(
    async (selectedLogIds: string[]): Promise<SynthesisReport | null> => {
      if (!firebaseUser || isOffline || selectedLogIds.length === 0) return null;
      setLastError(null);

      const included = logs.filter((l) => selectedLogIds.includes(l.id));
      if (included.length === 0) return null;
      const targetDomain = included[0]?.domain ?? domain;

      const synthesized = await runWeeklySynthesis({
        logs: included,
        domain: targetDomain,
        remoteConfig,
      });

      const createdAt = Timestamp.now();
      const payload: Omit<SynthesisReport, "id"> = {
        userId: firebaseUser.uid,
        domain: targetDomain,
        logIdsIncluded: selectedLogIds,
        executiveSummary: synthesized.executiveSummary,
        priorityChecklist: synthesized.priorityChecklist,
        consolidatedMaterials: synthesized.consolidatedMaterials,
        modelUsed: synthesized.modelUsed,
        createdAt,
      };

      const db = getFirebaseDb();
      const reportRef = doc(collection(db, "synthesisReports"));
      console.log("[Firestore] 1. Writing document to synthesisReports...", {
        id: reportRef.id,
        domain: targetDomain,
        logCount: selectedLogIds.length,
      });
      await setDoc(reportRef, payload);
      console.log("[Firestore] 2. Document write resolved with ID:", reportRef.id);
      return { ...payload, id: reportRef.id };
    },
    [domain, firebaseUser, isOffline, logs, remoteConfig]
  );

  const toggleSynthesisTask = useCallback(
    async (reportId: string, taskIndex: number) => {
      const target = synthesisReports.find((r) => r.id === reportId);
      if (!target) return;

      const updatedChecklist = target.priorityChecklist.map((item, idx) =>
        idx === taskIndex ? { ...item, completed: !item.completed } : item
      );

      const db = getFirebaseDb();
      await updateDoc(doc(db, "synthesisReports", reportId), {
        priorityChecklist: updatedChecklist,
      });
    },
    [synthesisReports]
  );

  // Seeds 2 realistic Nigerian agriculture logs + 2 construction site logs into Firestore
  const loadSampleData = useCallback(async () => {
    if (!firebaseUser) return;
    const db = getFirebaseDb();
    const batch = writeBatch(db);
    const nowSec = Math.floor(Date.now() / 1000);

    const sampleLogs: Array<Omit<FieldLog, "id" | "isSyncedToCloud">> = [
      {
        userId: firebaseUser.uid,
        domain: "agri",
        title: "Cassava Bacterial Blight — Abia Plot B-4",
        rawInput:
          "Angular water-soaked leaf lesions spreading rapidly across cassava rows in Umudike / Abia Zone B after heavy tropical rain, with brown stem exudate and tip dieback.",
        imageBase64: "/images/agri-field-blight.jpg",
        locationTag: "Abia State, Zone B • Plot B-4",
        localTriage: {
          summary:
            "High-probability Xanthomonas phaseoli (Cassava Bacterial Blight) outbreak triggered by rain splash in humid canopy.",
          severity: "critical",
          confidence: 94,
          immediateAction:
            "Isolate Plot B-4 immediately. Prune infected stalks 15cm below lowest lesion and sterilize cutlasses with 70% alcohol between plants. Do not compost debris.",
          extractedTags: ["#cassava-blight", "#abia-zone-b", "#quarantine"],
          needsCloudDeepAudit: true,
          inferenceSource: "on_device",
          processedAt: Date.now() - 1000 * 60 * 12,
          latencyMs: 1280,
        },
        cloudAuditStatus: isOffline ? "queued_offline" : "none",
        cloudAuditError: null,
        cloudAudit: null,
        createdAt: Timestamp.fromMillis((nowSec - 720) * 1000),
      },
      {
        userId: firebaseUser.uid,
        domain: "agri",
        title: "Maize Fall Armyworm Whorl Damage — Oyo Ridge 2",
        rawInput:
          "Ragged window-pane leaf holes and sawdust-like frass inside vegetative maize funnels across 20% of Ridge 2 following warm evening winds.",
        imageBase64: null,
        locationTag: "Ibadan Farm Block • Maize Ridge 2",
        localTriage: {
          summary:
            "Early-instar Spodoptera frugiperda (Fall Armyworm) feeding inside vegetative maize whorls.",
          severity: "medium",
          confidence: 89,
          immediateAction:
            "Scout adjacent rows at dusk, crush visible egg clusters, and direct neem extract or Bt spray straight into affected whorls.",
          extractedTags: ["#fall-armyworm", "#maize-whorl", "#pest-alert"],
          needsCloudDeepAudit: false,
          inferenceSource: "on_device",
          processedAt: Date.now() - 1000 * 60 * 55,
          latencyMs: 1140,
        },
        cloudAuditStatus: "none",
        cloudAuditError: null,
        cloudAudit: null,
        createdAt: Timestamp.fromMillis((nowSec - 3300) * 1000),
      },
      {
        userId: firebaseUser.uid,
        domain: "construction",
        title: "Diagonal Shear Crack — North Retaining Wall [Sector 7B]",
        rawInput:
          "45-degree diagonal shear fracture widening to 6mm along reinforced concrete retaining wall section 7B with continuous groundwater seepage and white efflorescence.",
        imageBase64: "/images/site-ops-crack.jpg",
        locationTag: "Site Sector 7B • North Retaining Wall",
        localTriage: {
          summary:
            "Critical hydrostatic lateral pressure buildup causing diagonal shear fracture and overturning hazard on Retaining Wall 7B.",
          severity: "critical",
          confidence: 96,
          immediateAction:
            "Lock out upper equipment bench within 5m radius immediately, evacuate toe personnel, install crack tell-tale gauge, and clear blocked weep holes.",
          extractedTags: ["#shear-crack", "#hydrostatic-load", "#evacuate"],
          needsCloudDeepAudit: true,
          inferenceSource: "on_device",
          processedAt: Date.now() - 1000 * 60 * 24,
          latencyMs: 1390,
        },
        cloudAuditStatus: "completed",
        cloudAuditError: null,
        cloudAudit: {
          rootCauseAnalysis:
            "Post-storm groundwater accumulation behind Retaining Wall 7B obstructed 50mm weep outlets, elevating lateral hydrostatic pressure beyond design shear resistance.",
          stepByStepPlan: [
            {
              step: "Lock out upper equipment bench within 5m radius and mount mechanical tell-tale crack gauges",
              completed: true,
            },
            {
              step: "Excavate controlled toe relief trench and flush blocked 50mm PVC weep holes",
              completed: false,
            },
            {
              step: "Inject low-viscosity structural epoxy resin per ACI 224.1R once seepage subsides",
              completed: false,
            },
            {
              step: "Obtain structural engineer sign-off prior to restoring surcharge loads",
              completed: false,
            },
          ],
          estimatedMaterialsOrInputs: [
            { item: "Low-Viscosity Structural Epoxy Injection Kit", quantity: "3 kits" },
            { item: "Perforated PVC Drainage Weep Liners (50mm)", quantity: "8 units" },
            { item: "Tell-Tale Crack Monitoring Gauges", quantity: "4 gauges" },
          ],
          safetyOrComplianceNotes:
            "Enforce OSHA 1926 Subpart P & ACI 546R guidelines. No excavation below wall toe while active hydrostatic discharge persists.",
          visualDiagramSvg: `<svg viewBox="0 0 640 320" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="320" fill="#0D0E0F" rx="8"/><text x="24" y="34" fill="#10B981" font-family="monospace" font-size="13" font-weight="bold">STRUCTURAL CROSS-SECTION: RETAINING WALL 7B REMEDIATION</text><rect x="220" y="65" width="70" height="190" fill="#292A2A" stroke="#C4C7C7" stroke-width="2"/><polygon points="290,90 560,90 560,255 290,255" fill="#1F2020" stroke="#444748"/><path d="M225 110 L282 178" stroke="#EF4444" stroke-width="4" stroke-dasharray="6,3"/><text x="35" y="142" fill="#EF4444" font-family="monospace" font-size="11">6mm SHEAR CRACK</text><text x="35" y="158" fill="#E3E2E2" font-family="monospace" font-size="10">Epoxy Injection Ports</text><line x1="155" y1="145" x2="245" y2="145" stroke="#EF4444" stroke-width="1.5"/><rect x="215" y="210" width="90" height="12" fill="#10B981" rx="2"/><text x="320" y="220" fill="#10B981" font-family="monospace" font-size="11">1. CLEAR 50mm PVC WEEP DRAIN</text><path d="M490 125 L315 125" stroke="#F59E0B" stroke-width="2"/><polygon points="315,125 327,119 327,131" fill="#F59E0B"/><text x="330" y="114" fill="#F59E0B" font-family="monospace" font-size="11">HYDROSTATIC LATERAL LOAD</text><rect x="30" y="255" width="190" height="14" fill="#F59E0B" fill-opacity="0.25" stroke="#F59E0B"/><text x="42" y="288" fill="#FEF3C7" font-family="monospace" font-size="11">5m EXCLUSION ZONE &amp; TOE RELIEF</text></svg>`,
          generatedDiagramUrl: null,
          completedAt: Timestamp.fromMillis((nowSec - 1200) * 1000),
        },
        createdAt: Timestamp.fromMillis((nowSec - 1440) * 1000),
      },
      {
        userId: firebaseUser.uid,
        domain: "construction",
        title: "Surface Spalling & Exposed Stirrups — Bridge Pier Cap 3",
        rawInput:
          "Concrete cover delamination on Pier Cap 3 underside exposing lightly rusted 16mm stirrups across a 0.6m span near deck expansion joint.",
        imageBase64: null,
        locationTag: "Site Sector 4 • Bridge Pier Cap 3",
        localTriage: {
          summary:
            "Localized carbonation and moisture runoff causing shallow cover spalling and surface rebar oxidation.",
          severity: "low",
          confidence: 91,
          immediateAction:
            "Sound surrounding concrete with a hammer to mark delaminated perimeter, wire-brush rust, and schedule zinc-rich primer coat.",
          extractedTags: ["#rebar-exposure", "#surface-spall", "#pier-3"],
          needsCloudDeepAudit: false,
          inferenceSource: "on_device",
          processedAt: Date.now() - 1000 * 60 * 110,
          latencyMs: 1210,
        },
        cloudAuditStatus: "none",
        cloudAuditError: null,
        cloudAudit: null,
        createdAt: Timestamp.fromMillis((nowSec - 6600) * 1000),
      },
    ];

    for (const item of sampleLogs) {
      const ref = doc(collection(db, "fieldLogs"));
      batch.set(ref, item);
    }

    await batch.commit();
  }, [firebaseUser, isOffline]);

  const resetData = useCallback(async () => {
    setSimulateOffline(false);
    setLastError(null);
    if (!firebaseUser) return;

    const db = getFirebaseDb();
    const batch = writeBatch(db);

    const [logsSnap, reportsSnap] = await Promise.all([
      getDocs(
        query(collection(db, "fieldLogs"), where("userId", "==", firebaseUser.uid))
      ),
      getDocs(
        query(
          collection(db, "synthesisReports"),
          where("userId", "==", firebaseUser.uid)
        )
      ),
    ]);

    logsSnap.forEach((docSnap) => batch.delete(docSnap.ref));
    reportsSnap.forEach((docSnap) => batch.delete(docSnap.ref));

    await batch.commit();
  }, [firebaseUser, setSimulateOffline]);

  const refreshRemoteConfig = useCallback(async () => {
    const fresh = await fetchAndCacheRemoteConfig();
    setRemoteConfig(fresh);
    return fresh;
  }, []);

  const refreshAppCheckStatus = useCallback(async () => {
    const status = await inspectAppCheckStatus();
    setAppCheckStatus(status);
    return status;
  }, []);

  const clearLastError = useCallback(() => setLastError(null), []);

  const pendingSyncCount = logs.filter(
    (l) => !l.isSyncedToCloud || l.cloudAuditStatus === "queued_offline"
  ).length;

  return (
    <TerraPulseContext.Provider
      value={{
        user,
        domain,
        isRoleLocked,
        setDomain,
        updateProfile,
        isOffline,
        browserOffline,
        simulateOffline,
        setSimulateOffline,
        checkConnectivityNow,
        logs,
        logsLoading,
        synthesisReports,
        pendingSyncCount,
        lastError,
        clearLastError,
        remoteConfig,
        refreshRemoteConfig,
        appCheckStatus,
        refreshAppCheckStatus,
        addFieldLog,
        runOrQueueCloudAudit,
        setLogAuditState,
        updateLogTitle,
        deleteFieldLog,
        toggleRemediationStep,
        generateVisualDiagram,
        generateSynthesisReport,
        toggleSynthesisTask,
        loadSampleData,
        resetData,
      }}
    >
      {children}
    </TerraPulseContext.Provider>
  );
}

export function useTerraPulse() {
  const ctx = useContext(TerraPulseContext);
  if (!ctx) {
    throw new Error("useTerraPulse must be used within TerraPulseProvider");
  }
  return ctx;
}
