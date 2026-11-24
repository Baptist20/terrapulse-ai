"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Download,
  HardHat,
  Loader2,
  Lock,
  RefreshCw,
  Sprout,
  Trash2,
  User,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthModal } from "@/components/auth/auth-modal";
import { usePwaStatus } from "@/components/PwaRegistrar";
import { useAuth } from "@/context/AuthContext";
import { useTerraPulse } from "@/context/terrapulse-context";
import {
  NanoAvailabilityState,
  checkNanoAvailability,
  ensureDeviceModelInitialized,
} from "@/lib/ai/hybridEngine";
import { FieldDomain } from "@/types/terrapulse";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const { firebaseUser, profile, updateUserProfile, signOutUser } = useAuth();
  const pwa = usePwaStatus();
  const {
    user,
    domain,
    isOffline,
    browserOffline,
    simulateOffline,
    setSimulateOffline,
    pendingSyncCount,
    remoteConfig,
    refreshRemoteConfig,
    appCheckStatus,
    refreshAppCheckStatus,
    loadSampleData,
    resetData,
  } = useTerraPulse();

  const [zoneDraft, setZoneDraft] = useState<string>(profile?.zone ?? user.zone ?? "");
  const [zoneEditing, setZoneEditing] = useState(false);
  const [savingZone, setSavingZone] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(true);
  const [nanoState, setNanoState] = useState<NanoAvailabilityState>("unavailable");
  const [storageText, setStorageText] = useState<string>(
    "Local Allocated: 0.0 MB / IndexedDB Persistent Cache Ready"
  );
  const [refreshingTelemetry, setRefreshingTelemetry] = useState(false);
  const [warmingUpEdge, setWarmingUpEdge] = useState(false);
  const [edgeDownloadPct, setEdgeDownloadPct] = useState<number | null>(null);
  const [edgeInitMessage, setEdgeInitMessage] = useState<string | null>(null);
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);

  const runHardwareProbe = async () => {
    const nextNano = await checkNanoAvailability();

    let nextStorage: string | null = null;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        const usedMb = ((est.usage ?? 0) / (1024 * 1024)).toFixed(1);
        const quotaGb = ((est.quota ?? 1.2 * 1024 ** 3) / 1024 ** 3).toFixed(1);
        nextStorage = `Local Allocated: ${usedMb} MB / Quota ${quotaGb} GB Available`;
      }
    } catch {
      // keep fallback estimate
    }

    return { nextNano, nextStorage };
  };

  const probeHardwareTelemetry = async () => {
    setRefreshingTelemetry(true);
    const [{ nextNano, nextStorage }] = await Promise.all([
      runHardwareProbe(),
      refreshAppCheckStatus(),
    ]);
    setNanoState(nextNano);
    if (nextStorage) setStorageText(nextStorage);
    setTimeout(() => setRefreshingTelemetry(false), 300);
  };

  const handleWarmUpEdgeModel = async () => {
    if (warmingUpEdge) return;
    setWarmingUpEdge(true);
    setEdgeDownloadPct(0);
    setEdgeInitMessage("Initializing Chrome Gemini Nano on user gesture...");
    try {
      const res = await ensureDeviceModelInitialized((pct) => {
        setEdgeDownloadPct(pct);
        setNanoState(pct < 100 ? "downloading" : "available");
      });
      setNanoState(res.state);
      setEdgeInitMessage(res.message);
      if (res.initialized) {
        setEdgeDownloadPct(100);
      }
      flashToast(res.message);
    } finally {
      setWarmingUpEdge(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    runHardwareProbe().then(({ nextNano, nextStorage }) => {
      if (cancelled) return;
      setNanoState(nextNano);
      if (nextStorage) setStorageText(nextStorage);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashToast = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 2600);
  };

  const displayedZone = zoneEditing ? zoneDraft : (profile?.zone ?? user.zone ?? "");

  const handleCommitZone = async (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setZoneDraft(profile?.zone ?? user.zone ?? "");
      setZoneEditing(false);
      return;
    }
    setSavingZone(true);
    try {
      await updateUserProfile({ zone: trimmed, locationLabel: trimmed });
      setZoneDraft(trimmed);
      setZoneEditing(false);
      setLocationSaved(true);
      setTimeout(() => setLocationSaved(false), 1600);
    } finally {
      setSavingZone(false);
    }
  };

  const handleFetchRemoteConfig = async () => {
    setFetchingRemote(true);
    try {
      const updated = await refreshRemoteConfig();
      flashToast(
        updated.source === "remote"
          ? `Remote Config ${updated.prompt_config_version} synced from Firebase & cached locally.`
          : `Serving cached Remote Config ${updated.prompt_config_version} (${updated.source}).`
      );
    } finally {
      setFetchingRemote(false);
    }
  };

  const handleLoadSamples = async () => {
    setBusyAction(true);
    try {
      await loadSampleData();
      flashToast("Seeded two agriculture logs and two construction logs into Firestore.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleResetWorkspace = async () => {
    setBusyAction(true);
    try {
      await resetData();
      flashToast("All user field logs and synthesis reports cleared from Firestore.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleSignOut = async () => {
    setBusyAction(true);
    try {
      if (firebaseUser?.isAnonymous) {
        await resetData();
      }
      await signOutUser();
      try {
        sessionStorage.removeItem("terrapulse_theme_manual");
      } catch {
        // ignore
      }
      router.push("/");
    } finally {
      setBusyAction(false);
    }
  };

  const nanoLabel =
    nanoState === "available"
      ? "AVAILABLE • CHROME GEMINI NANO READY"
      : nanoState === "downloadable"
        ? "DOWNLOADABLE • CHROME PROMPT API"
        : nanoState === "downloading"
          ? "DOWNLOADING • GEMINI NANO WEIGHTS"
          : "CLOUD FALLBACK • CHROME 139+ FOR NANO";

  const activePromptTab: FieldDomain = domain;

  const activePromptJson = JSON.stringify(
    {
      role: "system",
      prompt_config_version: remoteConfig.prompt_config_version,
      source: remoteConfig.source,
      domain:
        activePromptTab === "agri"
          ? "PRECISION_AGRONOMY_FIELD_TRIAGE"
          : "CIVIL_SITE_OPS_STRUCTURAL_TRIAGE",
      systemInstruction:
        activePromptTab === "agri"
          ? remoteConfig.agri_system_prompt
          : remoteConfig.construction_system_prompt,
      routing: {
        online: "prefer_on_device",
        offline: "only_on_device",
        cloudModel: remoteConfig.active_cloud_model,
        maxOutputTokens: remoteConfig.triage_max_tokens,
      },
    },
    null,
    2
  );

  return (
    <AppShell title="Settings">
      <div className="mx-auto w-full max-w-[896px] flex flex-col gap-6 py-2">
        {/* SECTION 1: CONTEXT HEADER */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-3 border-b border-[#E2E8F0] dark:border-[#343535]">
          <div className="flex flex-col gap-1 max-w-[672px]">
            <h1 className="font-display text-2xl font-semibold leading-8 tracking-[-0.6px] uppercase text-[#0F172A] dark:text-[#E3E2E2]">
              Hybrid Diagnostics &amp; Settings
            </h1>
            <p className="text-sm leading-[23px] text-[#475569] dark:text-[#C4C7C7]">
              Inspect on-device Gemini Nano availability, simulate dead-zone network failures, and
              verify Firebase App Check &amp; Remote Config parameters.
            </p>
          </div>

          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 shrink-0 self-start sm:self-auto",
              isOffline
                ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-[#FBBF24]"
                : "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.5)] border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isOffline ? "bg-[#FBBF24]" : "bg-[#34D399]"
              )}
            />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px]">
              {browserOffline
                ? "DEVICE OFFLINE • EDGE ONLY"
                : isOffline
                  ? "OFFLINE SIMULATION ACTIVE"
                  : "HYBRID SYSTEM NOMINAL"}
            </span>
          </div>
        </section>

        {actionToast && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 font-mono text-xs text-emerald-700 dark:text-[#34D399]">
            {actionToast}
          </div>
        )}

        {/* CARD 1: FIELD SIMULATION CONTROLS */}
        <section className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#1B1C1C] border border-amber-500/40 p-6 shadow-xl flex flex-col">
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-32 opacity-5"
            style={{
              background:
                "radial-gradient(70.71% 70.71% at 50% 50%, #F59E0B 12%, rgba(245, 158, 11, 0) 70%)",
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E2E8F0] dark:border-[#343535]">
            <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
              Field Simulation Controls
            </h2>
            <span className="rounded-full bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[1.1px] text-amber-800 dark:text-[#FBBF24]">
              TEST SANDBOX
            </span>
          </div>

          <div className="flex flex-col divide-y divide-[#E2E8F0] dark:divide-[#343535]">
            {/* Row 1: Simulate Offline Mode */}
            <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="max-w-[576px] space-y-1">
                <h3 className="text-base font-semibold leading-6 text-[#0F172A] dark:text-[#E3E2E2]">
                  Simulate Offline Mode
                </h3>
                <p className="text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                  Forces local{" "}
                  <code className="rounded-md bg-[#F1F5F9] dark:bg-[#343535] px-1.5 py-0.5 font-mono text-[12px] font-medium text-amber-700 dark:text-[#FBBF24]">
                    only_on_device
                  </code>{" "}
                  execution, triggers Offline Guard on cloud routes, and queues Firestore writes in
                  IndexedDB.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="rounded-full bg-[#F1F5F9] dark:bg-[#1F2020] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#475569] dark:text-[#C4C7C7]">
                  {simulateOffline ? "DEAD ZONE ON" : "LIVE NETWORK"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={simulateOffline}
                  aria-label="Simulate Offline Mode"
                  onClick={() => {
                    const next = !simulateOffline;
                    setSimulateOffline(next);
                    flashToast(
                      next
                        ? "Simulated Offline Mode enabled — Edge-only Gemini Nano active."
                        : "Connectivity restored — queued audits syncing automatically."
                    );
                  }}
                  className={cn(
                    "relative inline-flex h-8 w-16 items-center rounded-full p-0.5 transition-colors cursor-pointer",
                    simulateOffline ? "bg-[#F59E0B]" : "bg-[#CBD5E1] dark:bg-[#343535]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-7 w-7 rounded-full bg-white dark:bg-[#E3E2E2] shadow-sm transition-transform",
                      simulateOffline ? "translate-x-8" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Row 2: Populate Sample Field Logs */}
            <div className="py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="max-w-[576px] space-y-1">
                <h3 className="text-base font-semibold leading-6 text-[#0F172A] dark:text-[#E3E2E2]">
                  Populate Sample Field Logs
                </h3>
                <p className="text-xs leading-4 text-[#475569] dark:text-[#C4C7C7]">
                  Seeds two agriculture logs and two construction logs into Firestore
                </p>
              </div>

              <button
                type="button"
                disabled={busyAction}
                onClick={handleLoadSamples}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#444748] px-4 text-sm text-[#0F172A] dark:text-[#E3E2E2] disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Database className="h-4 w-4 text-[#475569] dark:text-[#C4C7C7]" />
                <span>Load Sample Data</span>
              </button>
            </div>

            {/* Row 3: Reset all data */}
            <div className="pt-5 pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="max-w-[576px] space-y-1">
                <h3 className="text-base font-semibold leading-6 text-[#0F172A] dark:text-[#E3E2E2]">
                  Reset all data
                </h3>
                <p className="text-xs leading-4 text-[#475569] dark:text-[#C4C7C7]">
                  Deletes all of your test field logs and synthesis reports from Firestore and
                  resets simulation toggles.
                </p>
              </div>

              <button
                type="button"
                disabled={busyAction}
                onClick={handleResetWorkspace}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600/10 hover:bg-red-600/20 dark:bg-[rgba(69,10,10,0.2)] dark:hover:bg-[rgba(69,10,10,0.45)] border border-red-500/40 px-4 text-sm text-red-700 dark:text-[#FCA5A5] disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Trash2 className="h-4 w-4 text-red-500 dark:text-[#F87171]" />
                <span>Reset Data</span>
              </button>
            </div>
          </div>
        </section>

        {/* CARD 1B: OFFLINE PWA & INSTALL FOR FIELD USE */}
        <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#343535] p-6 shadow-md flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0] dark:border-[#343535]">
            <div>
              <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                Installable PWA &amp; Offline App Shell
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                Install TerraPulse on tablets or desktops and reload pages offline in zero-signal zones.
              </p>
            </div>

            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.55px]",
                pwa.swReady
                  ? "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] border-emerald-500/35 text-emerald-700 dark:text-[#34D399]"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-[#FBBF24]"
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                {pwa.swReady
                  ? "Ready for Offline Use (App Shell Cached)"
                  : "Registering Offline Service Worker..."}
              </span>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-[540px]">
              <h3 className="text-sm font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                {pwa.isInstalled
                  ? "Installed as Standalone Field App"
                  : "Install App for Field Offline Use"}
              </h3>
              <p className="text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                Caches <span className="font-mono">/dashboard</span>,{" "}
                <span className="font-mono">/logs</span>,{" "}
                <span className="font-mono">/synthesis</span>,{" "}
                <span className="font-mono">/settings</span>, and static chunks locally while
                letting Firestore IndexedDB handle field log sync cleanly.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {pwa.canInstall && !pwa.isInstalled && (
                <button
                  type="button"
                  onClick={async () => {
                    const outcome = await pwa.promptInstall();
                    if (outcome === "accepted") {
                      flashToast("TerraPulse AI installed for offline field use.");
                    }
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-4 font-mono text-xs font-semibold text-white dark:text-[#090D16] transition-colors cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Install App for Field Offline Use</span>
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  const ok = await pwa.warmAppShell();
                  flashToast(
                    ok
                      ? "Offline App Shell refreshed in Service Worker cache."
                      : "Service Worker is still initializing — try again in a moment."
                  );
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#444748] px-4 font-mono text-xs font-medium text-[#0F172A] dark:text-[#E3E2E2] transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Cache Routes for Offline</span>
              </button>
            </div>
          </div>
        </section>

        {/* CARD 2: HYBRID AI ENGINE TELEMETRY */}
        <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#343535] p-6 shadow-md flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                Hybrid AI Engine Telemetry
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                Live Chrome Prompt API probe, cloud uplink health, and local IndexedDB cache quota
              </p>
            </div>

            <button
              type="button"
              onClick={probeHardwareTelemetry}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#343535] px-3.5 font-mono text-[13px] font-medium text-[#0F172A] dark:text-[#E3E2E2] transition-colors cursor-pointer"
            >
              <span>Refresh Telemetry</span>
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 text-[#64748B] dark:text-[#C4C7C7]",
                  refreshingTelemetry && "animate-spin"
                )}
              />
            </button>
          </div>

          {/* 2x2 Telemetry Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Telemetry 1: On-Device Model */}
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                  ON-DEVICE MODEL (CHROME PROMPT API)
                </div>
                <div className="rounded-lg bg-white dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-transparent px-3 py-1.5 font-mono text-[13px] text-[#0F172A] dark:text-[#E3E2E2] truncate">
                  await window.LanguageModel.availability()
                </div>
              </div>
              <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#343535] space-y-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.55px]",
                    nanoState === "available"
                      ? "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                      : "bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.3)] text-amber-800 dark:text-[#FBBF24]"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      nanoState === "available" ? "bg-[#34D399]" : "bg-[#FBBF24]"
                    )}
                  />
                  {nanoLabel}
                </span>
                <p className="font-mono text-[12px] leading-[18px] text-[#475569] dark:text-[#C4C7C7]">
                  {edgeInitMessage ??
                    `Raw status: ${nanoState} • Multimodal JPEG <150KB enabled`}
                </p>

                {edgeDownloadPct !== null && (warmingUpEdge || edgeDownloadPct < 100) && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between font-mono text-[11px] text-[#475569] dark:text-[#C4C7C7]">
                      <span>Gemini Nano Model Download</span>
                      <span>{edgeDownloadPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0] dark:bg-[#0D0E0F]">
                      <div
                        className="h-full rounded-full bg-[#10B981] transition-all duration-200"
                        style={{
                          width: `${Math.max(0, Math.min(100, edgeDownloadPct))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={warmingUpEdge}
                  onClick={handleWarmUpEdgeModel}
                  className="mt-1 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#444748] px-3 font-mono text-[12px] font-semibold text-[#0F172A] dark:text-[#E3E2E2] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {warmingUpEdge ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#10B981]" />
                      <span>
                        {edgeDownloadPct !== null && edgeDownloadPct > 0 && edgeDownloadPct < 100
                          ? `Downloading Edge Model (${edgeDownloadPct}%)...`
                          : "Warming Up Edge Model..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <Cpu className="h-3.5 w-3.5 text-[#10B981]" />
                      <span>Warm Up / Check Edge Model</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Telemetry 2: Cloud Fallback & Deep Audit Model */}
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                  CLOUD FALLBACK &amp; DEEP AUDIT MODEL
                </div>
                <div className="rounded-lg bg-white dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-transparent px-3 py-1.5 font-mono text-[13px] text-[#0F172A] dark:text-[#E3E2E2] truncate">
                  {remoteConfig.active_cloud_model} (only_in_cloud)
                </div>
              </div>
              <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#343535] space-y-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.55px]",
                    isOffline
                      ? "bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.3)] text-amber-800 dark:text-[#FBBF24]"
                      : "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isOffline ? "bg-[#FBBF24]" : "bg-[#34D399]"
                    )}
                  />
                  {isOffline ? "UPLINK PAUSED (OFFLINE)" : "CLOUD UPLINK READY"}
                </span>
                <p className="font-mono text-[12px] leading-[18px] text-[#475569] dark:text-[#C4C7C7]">
                  {isOffline
                    ? "Direct Uplink: Held in local queue until signal restores"
                    : "Firebase AI Logic • GoogleAIBackend active"}
                </p>
              </div>
            </div>

            {/* Telemetry 3: Active Routing Strategy */}
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                  ACTIVE ROUTING STRATEGY
                </div>
                <div className="rounded-lg bg-white dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-transparent px-3 py-1.5 font-mono text-[13px] text-[#0F172A] dark:text-[#E3E2E2] truncate">
                  mode: &quot;{isOffline ? "only_on_device" : "prefer_on_device"}&quot;
                </div>
              </div>
              <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#343535] space-y-2">
                <span className="inline-flex items-center rounded-full bg-[#E2E8F0] dark:bg-[#343535] border border-[#CBD5E1] dark:border-[#444748] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#0F172A] dark:text-[#E3E2E2]">
                  {isOffline ? "STRICT EDGE-ONLY" : "EDGE-FIRST HYBRID"}
                </span>
                <p className="font-mono text-[12px] leading-[18px] text-[#475569] dark:text-[#C4C7C7]">
                  Policy: Nano primary, queued audits auto-run upon reconnect
                </p>
              </div>
            </div>

            {/* Telemetry 4: Local Storage & Sync Engine */}
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                  LOCAL STORAGE &amp; SYNC ENGINE
                </div>
                <div className="rounded-lg bg-white dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-transparent px-3 py-1.5 font-mono text-[13px] text-[#0F172A] dark:text-[#E3E2E2] truncate">
                  Firestore persistentLocalCache (IndexedDB)
                </div>
              </div>
              <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#343535] space-y-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.55px]",
                    pendingSyncCount > 0
                      ? "bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.3)] text-amber-800 dark:text-[#FBBF24]"
                      : "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      pendingSyncCount > 0 ? "bg-[#FBBF24]" : "bg-[#34D399]"
                    )}
                  />
                  {pendingSyncCount > 0
                    ? `${pendingSyncCount} RECORDS PENDING SYNC`
                    : "INDEXEDDB MULTI-TAB SYNCED"}
                </span>
                <p className="font-mono text-[12px] leading-[18px] text-[#475569] dark:text-[#C4C7C7]">
                  {storageText}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 3: FIREBASE SECURITY & REMOTE CONFIG INSPECTOR */}
        <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#343535] p-6 shadow-md flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                Firebase Security &amp; Remote Config
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                App Check endpoint attestation and offline-cached dynamic prompt configuration
              </p>
            </div>

            <button
              type="button"
              onClick={handleFetchRemoteConfig}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#343535] px-3.5 font-mono text-[13px] font-medium text-[#0F172A] dark:text-[#E3E2E2] transition-colors cursor-pointer"
            >
              <span>Fetch Remote Config</span>
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 text-[#64748B] dark:text-[#C4C7C7]",
                  fetchingRemote && "animate-spin"
                )}
              />
            </button>
          </div>

          {/* Row 1: App Check Status */}
          <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-[576px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                  Firebase App Check Protection
                </span>
                <span className="rounded-full bg-[#E2E8F0] dark:bg-[#343535] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#475569] dark:text-[#C4C7C7]">
                  {appCheckStatus.mode === "recaptcha_enterprise"
                    ? "reCAPTCHA Enterprise"
                    : "reCAPTCHA / Debug Token"}
                </span>
              </div>
            </div>

            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.55px] shrink-0 self-start sm:self-center",
                appCheckStatus.verified
                  ? "bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-[#FBBF24]"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  appCheckStatus.verified ? "bg-[#34D399]" : "bg-[#FBBF24]"
                )}
              />
              {appCheckStatus.verified ? "ATTESTED" : "DEBUG READY"}
            </span>
          </div>

          {/* Row 2: Active Remote Config Parameters */}
          <div className="space-y-2">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
              ACTIVE REMOTE CONFIG PARAMETERS ({remoteConfig.source.toUpperCase()})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-3.5">
                <div className="font-mono text-[12px] text-[#64748B] dark:text-[#C4C7C7]">
                  active_cloud_model
                </div>
                <div className="font-mono text-[13px] font-semibold text-[#0F172A] dark:text-[#E3E2E2] mt-1">
                  &quot;{remoteConfig.active_cloud_model}&quot;
                </div>
              </div>

              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-3.5">
                <div className="font-mono text-[12px] text-[#64748B] dark:text-[#C4C7C7]">
                  triage_max_tokens
                </div>
                <div className="font-mono text-[13px] font-semibold text-[#0F172A] dark:text-[#E3E2E2] mt-1">
                  {remoteConfig.triage_max_tokens}
                </div>
              </div>

              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-3.5">
                <div className="font-mono text-[12px] text-[#64748B] dark:text-[#C4C7C7]">
                  prompt_config_version
                </div>
                <div className="font-mono text-[13px] font-semibold text-[#0F172A] dark:text-[#E3E2E2] mt-1">
                  &quot;{remoteConfig.prompt_config_version}&quot;
                </div>
              </div>

              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-3.5">
                <div className="font-mono text-[12px] text-[#64748B] dark:text-[#C4C7C7]">
                  auto_queue_critical_logs
                </div>
                <div className="font-mono text-[13px] font-semibold text-emerald-700 dark:text-[#34D399] mt-1">
                  {String(remoteConfig.auto_queue_critical_logs)}
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Collapsible Active System Prompt Preview */}
          <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] overflow-hidden">
            <div className="bg-[#F1F5F9] dark:bg-[#292A2A] border-b border-[#E2E8F0] dark:border-[#343535] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-sm font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                  Active System Prompt Preview
                </span>
                <span className="rounded-full bg-[#E2E8F0] dark:bg-[#343535] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#475569] dark:text-[#C4C7C7]">
                  {activePromptTab === "agri"
                    ? "agri_system_prompt"
                    : "construction_system_prompt"}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[11px] font-semibold border",
                    domain === "agri"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                  )}
                >
                  {domain === "agri" ? (
                    <Sprout className="h-3 w-3" />
                  ) : (
                    <HardHat className="h-3 w-3" />
                  )}
                  {domain === "agri" ? "Agri-Field Only" : "Site-Ops Only"}
                </span>
                <button
                  type="button"
                  onClick={() => setPromptExpanded(!promptExpanded)}
                  aria-label="Toggle system prompt preview"
                  className="ml-1 p-1 rounded-full text-[#64748B] dark:text-[#C4C7C7] hover:text-white cursor-pointer"
                >
                  {promptExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {promptExpanded && (
              <div className="bg-[#0F172A] dark:bg-[#0D0E0F] p-4 overflow-x-auto">
                <pre className="font-mono text-[12px] sm:text-[13px] leading-[21px] text-[#E3E2E2] whitespace-pre-wrap">
                  {activePromptJson}
                </pre>
              </div>
            )}
          </div>
        </section>

        {/* CARD 4: FIELD WORKSPACE PREFERENCES */}
        <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#343535] p-6 shadow-md flex flex-col gap-6">
          <div>
            <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
              Field Workspace Preferences
            </h2>
            <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
              Calibrate workspace presets synced to users/{user.uid.slice(0, 8)}...
            </p>
          </div>

          {/* Assigned Operational Role (Read-only, locked to profile.domain) */}
          <div className="space-y-2">
            <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
              ASSIGNED OPERATIONAL ROLE
            </label>
            <div
              className={cn(
                "rounded-xl p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                domain === "agri"
                  ? "bg-emerald-500/5 border-emerald-500/30"
                  : "bg-amber-500/5 border-amber-500/30"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                    domain === "agri"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  )}
                >
                  {domain === "agri" ? (
                    <Sprout className="h-5 w-5" />
                  ) : (
                    <HardHat className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="text-base font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                    {domain === "agri" ? "Agri-Field Mode" : "Site-Ops Mode"}
                  </div>
                  <p className="text-xs leading-4 text-[#475569] dark:text-[#C4C7C7] mt-0.5">
                    {domain === "agri"
                      ? "Scoped to agronomic crop diagnosis, pest scouting, soil telemetry, and agri-* prompts."
                      : "Scoped to structural concrete audits, OSHA hazard triage, earthworks, and site-* prompts."}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 rounded-full bg-[#E2E8F0] dark:bg-[#292A2A] px-3 py-1 font-mono text-[11px] font-semibold text-[#475569] dark:text-[#C4C7C7]">
                <Lock className="h-3 w-3" />
                ROLE LOCKED
              </span>
            </div>
          </div>

          {/* Active Zone / Farm / Site Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="default-location-input"
              className="block font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]"
            >
              ACTIVE ZONE / FARM / SITE NAME
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id="default-location-input"
                  type="text"
                  value={displayedZone}
                  onFocus={() => {
                    setZoneDraft(profile?.zone ?? user.zone ?? "");
                    setZoneEditing(true);
                  }}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setZoneEditing(true);
                    setZoneDraft(nextVal);
                    // Live-sync non-empty updates immediately so the top Navbar reflects changes live
                    if (nextVal.trim()) {
                      void updateUserProfile({
                        zone: nextVal.trim(),
                        locationLabel: nextVal.trim(),
                      });
                    }
                  }}
                  onBlur={() => void handleCommitZone(zoneDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCommitZone(zoneDraft);
                    }
                  }}
                  placeholder={
                    domain === "agri"
                      ? "e.g. Block C Maize Plot"
                      : "e.g. Sector 4 Foundation"
                  }
                  className="h-11 w-full rounded-xl bg-[#F8FAFC] dark:bg-[#0D0E0F] border border-[#CBD5E1] dark:border-[#343535] px-4 pr-20 font-mono text-[13px] font-medium text-[#0F172A] dark:text-[#E3E2E2] outline-none focus:border-[#10B981]"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-semibold uppercase text-[#64748B] dark:text-[#C4C7C7]">
                  {savingZone ? "SAVING" : locationSaved ? "SAVED" : "SYNCED"}
                </span>
              </div>
              <button
                type="button"
                disabled={savingZone || !displayedZone.trim()}
                onClick={() => void handleCommitZone(displayedZone)}
                className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold uppercase tracking-wider disabled:opacity-50 transition-colors cursor-pointer shrink-0"
              >
                Save Zone
              </button>
            </div>
          </div>

          {/* Account & Session Strip */}
          <div className="pt-2">
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#343535] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E2E8F0] dark:bg-[#343535] shrink-0">
                  <User className="h-5 w-5 text-[#475569] dark:text-[#C4C7C7]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                      {user.displayName}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold",
                        firebaseUser?.isAnonymous
                          ? "bg-[rgba(245,158,11,0.1)] border-[rgba(245,158,11,0.3)] text-amber-800 dark:text-[#FBBF24]"
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-[#34D399]"
                      )}
                    >
                      {firebaseUser?.isAnonymous ? "ANONYMOUS" : "VERIFIED"}
                    </span>
                  </div>
                  {user.email && (
                    <span className="font-mono text-[11px] text-[#64748B] dark:text-[#C4C7C7]">
                      {user.email}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {firebaseUser?.isAnonymous && (
                  <button
                    type="button"
                    onClick={() => setLinkModalOpen(true)}
                    className="h-9 px-4 rounded-xl bg-[#E2E8F0] hover:bg-[#CBD5E1] dark:bg-[#292A2A] dark:hover:bg-[#343535] border border-[#CBD5E1] dark:border-[#343535] text-xs text-[#0F172A] dark:text-[#E3E2E2] transition-colors cursor-pointer"
                  >
                    Link Google / Email Account
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleSignOut}
                  className="h-9 px-4 rounded-xl border border-transparent hover:border-[#CBD5E1] dark:hover:border-[#343535] text-xs text-[#64748B] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Account Linking Modal for Anonymous Users */}
      <AuthModal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        defaultTab="signup"
        isLinking
      />
    </AppShell>
  );
}
