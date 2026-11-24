"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckSquare,
  CloudOff,
  Copy,
  HardHat,
  Loader2,
  MapPin,
  Sparkles,
  Sprout,
  Square,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useTerraPulse } from "@/context/terrapulse-context";
import { useFieldVoice } from "@/hooks/useFieldVoice";
import { cn, formatTimestamp } from "@/lib/utils";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

export default function SynthesisPage() {
  const {
    user,
    domain,
    logs,
    isOffline,
    browserOffline,
    simulateOffline,
    setSimulateOffline,
    checkConnectivityNow,
    synthesisReports,
    generateSynthesisReport,
    toggleSynthesisTask,
  } = useTerraPulse();

  const voice = useFieldVoice({ isOffline });

  const domainLogs = logs.filter((l) => l.domain === domain);
  const syncedLogs = domainLogs.filter((l) => l.isSyncedToCloud);
  const unsyncedLogs = domainLogs.filter((l) => !l.isSyncedToCloud);

  const [deselectedIds, setDeselectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [copiedBoq, setCopiedBoq] = useState(false);

  const selectedIds = syncedLogs
    .map((l) => l.id)
    .filter((id) => !deselectedIds.includes(id));

  const domainReports = synthesisReports.filter((r) => r.domain === domain);
  const activeReport =
    domainReports.find((r) => r.id === activeReportId) ?? domainReports[0] ?? null;

  const toggleId = (id: string) => {
    setDeselectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (isOffline || selectedIds.length === 0 || generating) return;
    setGenerating(true);
    setSynthError(null);
    console.log("[Synthesis] Starting Weekly Synthesis...", {
      domain,
      selectedCount: selectedIds.length,
    });
    try {
      const created = await generateSynthesisReport(selectedIds);
      if (created) {
        console.log("[Synthesis] Weekly Synthesis saved:", { id: created.id });
        setActiveReportId(created.id);
      }
    } catch (err) {
      setSynthError(formatUserFacingError(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyBoq = () => {
    if (!activeReport) return;
    const lines = [
      `TerraPulse AI — Consolidated Procurement (${activeReport.domain.toUpperCase()})`,
      ...activeReport.consolidatedMaterials.map(
        (m) => `- ${m.item}: ${m.totalQuantity} (${m.targetZones})`
      ),
    ].join("\n");
    navigator.clipboard?.writeText(lines);
    setCopiedBoq(true);
    setTimeout(() => setCopiedBoq(false), 1800);
  };

  return (
    <AppShell title="Weekly Synthesis">
      <div className="flex flex-col gap-6">
        {/* TOP CONTEXT HEADER & CONTROLS */}
        <section className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Left Title Block */}
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[1.1px] text-[#64748B] dark:text-[#C4C7C7]">
                  CLOUD MULTI-LOG SYNTHESIS
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1] dark:bg-[#343535]" />
                <span className="font-mono text-[13px] font-medium text-[#64748B] dark:text-[#C4C7C7]">
                  only_in_cloud
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-[32px] font-semibold leading-10 tracking-[-0.8px] text-[#0F172A] dark:text-[#E3E2E2]">
                Multi-Log Weekly Synthesis
              </h1>

              <p className="max-w-[768px] text-sm leading-5 text-[#475569] dark:text-[#C4C7C7]">
                Correlate synced field logs across zones using Gemini 3.8 Flash to produce an
                executive pattern summary, prioritized intervention plan, and consolidated
                procurement table.
              </p>
            </div>

            {/* Right Tool Strip */}
            <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
              {/* Static Read-Only Assigned Role & Zone Badge */}
              <div
                className={cn(
                  "inline-flex items-center gap-2 h-9 px-4 rounded-full border text-sm font-semibold",
                  domain === "agri"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                )}
                title="Role locked to your assigned field profile"
              >
                {domain === "agri" ? (
                  <Sprout className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <HardHat className="h-4 w-4 text-amber-500 shrink-0" />
                )}
                <span>{domain === "agri" ? "Agri-Field" : "Site-Ops"}</span>
                {user.zone?.trim() && (
                  <>
                    <span className="opacity-45">•</span>
                    <span className="font-mono text-xs font-medium truncate max-w-[200px]">
                      {user.zone.trim()}
                    </span>
                  </>
                )}
              </div>

              {/* AI Engine Badge (Cloud Green indicator) */}
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-2 h-[28px] px-3.5 rounded-full bg-white dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-transparent shadow-xs">
                  <span className="relative flex h-2 w-2">
                    <span
                      className={cn(
                        "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                        isOffline ? "bg-[#F59E0B]" : "bg-[#10B981]"
                      )}
                    />
                    <span
                      className={cn(
                        "relative inline-flex h-2 w-2 rounded-full",
                        isOffline ? "bg-[#F59E0B]" : "bg-[#10B981]"
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[11px] font-semibold tracking-[0.55px] uppercase",
                      isOffline
                        ? "text-amber-700 dark:text-[#F59E0B]"
                        : "text-emerald-700 dark:text-[#10B981]"
                    )}
                  >
                    {isOffline
                      ? "CLOUD PAUSED • OFFLINE GUARD"
                      : "GEMINI 3.8 FLASH • CLOUD READY"}
                  </span>
                </div>

                {!isOffline && (
                  <button
                    type="button"
                    onClick={() => setSimulateOffline(true)}
                    className="font-mono text-[11px] text-[#64748B] dark:text-[#8E9192] hover:text-[#F59E0B] underline cursor-pointer"
                  >
                    Test Offline Guard
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* OFFLINE GUARD BANNER */}
          {isOffline && (
            <div className="rounded-2xl bg-amber-50 dark:bg-[#0D0E0F] shadow-[inset_0px_0px_0px_1px_#F59E0B] p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[rgba(245,158,11,0.15)]">
                    <CloudOff className="h-4 w-4 text-[#F59E0B]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold leading-6 text-[#0F172A] dark:text-[#E3E2E2]">
                      Offline Guard Active — Multi-Log Cloud Synthesis Locked
                    </h2>
                    <p className="text-xs leading-4 text-[#475569] dark:text-[#C4C7C7] max-w-[896px]">
                      Cross-zone weekly synthesis requires{" "}
                      <span className="font-mono font-medium text-[#0F172A] dark:text-[#E3E2E2]">
                        only_in_cloud
                      </span>{" "}
                      Gemini 3.8 Flash reasoning and cannot execute without connectivity. Your edge
                      triage logs remain safely stored in IndexedDB, and previously synced weekly
                      reports stay accessible offline below.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (browserOffline) {
                      void checkConnectivityNow();
                    } else {
                      setSimulateOffline(false);
                    }
                  }}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] px-4 font-mono text-[13px] font-semibold text-black transition-colors cursor-pointer"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  <span>
                    {browserOffline
                      ? "Check Signal Now"
                      : simulateOffline
                        ? "Disable Simulated Offline Mode"
                        : "Waiting for Signal Restore"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {synthError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{synthError}</span>
            </div>
          )}
        </section>

        {/* MAIN 2-COLUMN SYNTHESIS WORKSPACE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT (5 cols): Synced Field Logs Multi-Select Pool */}
          <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent border-t-2 border-t-[#10B981] p-5 shadow-md">
            <fieldset
              disabled={generating}
              className="flex flex-col gap-4 border-0 p-0 m-0 min-w-0 disabled:opacity-75"
            >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0] dark:border-[#292A2A]">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                  Synced Logs Pool
                </h2>
                <p className="font-mono text-[11px] text-[#64748B] dark:text-[#C4C7C7]">
                  {selectedIds.length} OF {syncedLogs.length} SYNCED SELECTED
                </p>
              </div>

              {syncedLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDeselectedIds(
                      selectedIds.length === syncedLogs.length
                        ? syncedLogs.map((l) => l.id)
                        : []
                    )
                  }
                  className="font-mono text-[11px] font-semibold uppercase text-[#475569] dark:text-[#C4C7C7] hover:text-[#10B981] cursor-pointer"
                >
                  {selectedIds.length === syncedLogs.length ? "Clear All" : "Select All"}
                </button>
              )}
            </div>

            {/* Synced Logs Checkboxes */}
            <div className="flex flex-col gap-2">
              {syncedLogs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#CBD5E1] dark:border-[#343535] p-6 text-center text-xs text-[#64748B] dark:text-[#C4C7C7]">
                  No synced {domain === "agri" ? "Agri-Field" : "Site-Ops"} logs available yet.
                  Capture or seed logs from{" "}
                  <Link href="/dashboard" className="text-[#10B981] underline">
                    Dashboard
                  </Link>
                  .
                </div>
              ) : (
                syncedLogs.map((log) => {
                  const checked = selectedIds.includes(log.id);
                  const sev = log.localTriage?.severity ?? "low";
                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => toggleId(log.id)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-colors flex items-start gap-2.5 cursor-pointer",
                        checked
                          ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-[#1F2020]"
                          : "border-[#E2E8F0] dark:border-[#292A2A] bg-[#F8FAFC] dark:bg-[#121414]"
                      )}
                    >
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-[#10B981] shrink-0 mt-0.5" />
                      ) : (
                        <Square className="h-4 w-4 text-[#94A3B8] dark:text-[#64748B] shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#0F172A] dark:text-[#E3E2E2] truncate">
                            {log.title}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                              sev === "critical"
                                ? "bg-red-600/15 dark:bg-[#93000A] text-red-700 dark:text-[#FFB4AB]"
                                : "bg-slate-200 dark:bg-[#343535] text-slate-700 dark:text-[#C4C7C7]"
                            )}
                          >
                            {sev}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] text-[#64748B] dark:text-[#8E9192]">
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {log.locationTag}
                          </span>
                          <span>•</span>
                          <span>{formatTimestamp(log.createdAt)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Unsynced Local Logs Notice */}
            {unsyncedLogs.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0] dark:border-[#292A2A]">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.55px] text-amber-700 dark:text-[#F59E0B]">
                  PENDING LOCAL SYNC ({unsyncedLogs.length} EXCLUDED UNTIL ONLINE)
                </span>
                {unsyncedLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 flex items-center justify-between gap-2 opacity-75"
                  >
                    <span className="text-xs text-[#475569] dark:text-[#C4C7C7] truncate">
                      {log.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] font-semibold text-amber-700 dark:text-[#FEF3C7]">
                      LOCAL ONLY
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Generate Action Button */}
            <button
              type="button"
              disabled={isOffline || selectedIds.length === 0 || generating}
              title={
                isOffline
                  ? "Requires internet connection"
                  : "Generate multi-log weekly synthesis with Gemini Cloud"
              }
              onClick={handleGenerate}
              className="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-4 font-mono text-xs font-semibold text-white dark:text-[#090D16] disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>
                {isOffline
                  ? "Reconnect to Run Cloud Synthesis"
                  : generating
                    ? "Synthesizing with Gemini 3.8 Flash..."
                    : `Generate Weekly Synthesis (${selectedIds.length} Logs)`}
              </span>
            </button>
            </fieldset>
          </section>

          {/* RIGHT (7 cols): Synthesized Executive Brief, Checklist & Procurement Table */}
          <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent border-t-2 border-t-[#10B981] p-5 shadow-md flex flex-col gap-6">
            {!activeReport ? (
              <div className="py-16 text-center space-y-2">
                <p className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                  No Weekly Synthesis Generated Yet
                </p>
                <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                  Select synced logs on the left and run Gemini 3.8 Flash to compile an executive
                  pattern brief.
                </p>
              </div>
            ) : (
              <>
                {/* Report Header & History Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0] dark:border-[#292A2A]">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-xl font-semibold tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                        Executive Pattern Summary
                      </h2>
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-[#10B981]">
                        {activeReport.logIdsIncluded.length} LOGS
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-[#64748B] dark:text-[#8E9192] mt-0.5">
                      GENERATED {formatTimestamp(activeReport.createdAt)} • REPORT{" "}
                      {activeReport.id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        voice.isSpeaking
                          ? voice.stopSpeaking()
                          : voice.speakResponse(activeReport.executiveSummary)
                      }
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] dark:bg-[#292A2A] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#334155] dark:text-[#E3E2E2] hover:text-[#10B981] cursor-pointer"
                    >
                      {voice.isSpeaking ? (
                        <VolumeX className="h-3.5 w-3.5 text-amber-500" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                      <span>{voice.isSpeaking ? "STOP" : "READ BRIEF"}</span>
                    </button>

                    {domainReports.length > 1 && (
                      <select
                        value={activeReport.id}
                        onChange={(e) => setActiveReportId(e.target.value)}
                        className="h-8 rounded-xl border border-[#E2E8F0] dark:border-[#343535] bg-[#F8FAFC] dark:bg-[#121414] px-2.5 font-mono text-[11px] text-[#0F172A] dark:text-[#E3E2E2]"
                      >
                        {domainReports.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id.slice(0, 8).toUpperCase()} ({r.logIdsIncluded.length} logs)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* 1. Executive Summary Box */}
                <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] p-4">
                  <p className="text-sm leading-6 text-[#0F172A] dark:text-[#E3E2E2]">
                    {activeReport.executiveSummary}
                  </p>
                </div>

                {/* 2. Prioritized Intervention Checklist */}
                <div className="space-y-2.5">
                  <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                    PRIORITIZED INTERVENTION CHECKLIST
                  </h3>
                  <ul className="space-y-2">
                    {activeReport.priorityChecklist.map((item, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => toggleSynthesisTask(activeReport.id, idx)}
                          className="w-full flex items-start justify-between gap-3 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 dark:bg-[#121414] dark:hover:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] p-3 text-left transition-colors cursor-pointer"
                        >
                          <div className="flex items-start gap-2.5">
                            {item.completed ? (
                              <CheckSquare className="h-4 w-4 text-[#10B981] shrink-0 mt-0.5" />
                            ) : (
                              <Square className="h-4 w-4 text-[#94A3B8] dark:text-[#64748B] shrink-0 mt-0.5" />
                            )}
                            <span
                              className={cn(
                                "text-xs sm:text-sm leading-5",
                                item.completed
                                  ? "line-through text-[#94A3B8] dark:text-[#64748B]"
                                  : "text-[#0F172A] dark:text-[#E3E2E2]"
                              )}
                            >
                              {item.task}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                              item.urgency === "immediate" &&
                                "bg-red-600/15 dark:bg-[#93000A] text-red-700 dark:text-[#FFB4AB]",
                              item.urgency === "this_week" &&
                                "bg-amber-500/15 text-amber-800 dark:text-[#FEF3C7]",
                              item.urgency === "monitor" &&
                                "bg-slate-200 dark:bg-[#343535] text-slate-600 dark:text-[#C4C7C7]"
                            )}
                          >
                            {item.urgency.replace("_", " ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 3. Consolidated Procurement Table */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                      CONSOLIDATED PROCUREMENT TABLE (BOQ)
                    </h3>
                    <button
                      type="button"
                      onClick={handleCopyBoq}
                      className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#475569] dark:text-[#C4C7C7] hover:text-[#10B981] cursor-pointer"
                    >
                      {copiedBoq ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#10B981]" />
                          <span className="text-[#10B981]">COPIED</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>COPY BOQ</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] dark:border-[#292A2A]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] dark:border-[#292A2A] bg-[#F1F5F9] dark:bg-[#0D0E0F] font-mono text-[11px] uppercase text-[#64748B] dark:text-[#C4C7C7]">
                          <th className="px-3.5 py-2.5 font-semibold">Material / Input</th>
                          <th className="px-3.5 py-2.5 font-semibold">Total Quantity</th>
                          <th className="px-3.5 py-2.5 font-semibold">Target Zones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#292A2A] bg-white dark:bg-[#121414]">
                        {activeReport.consolidatedMaterials.map((row, idx) => (
                          <tr key={idx}>
                            <td className="px-3.5 py-2.5 font-medium text-[#0F172A] dark:text-[#E3E2E2]">
                              {row.item}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono font-semibold text-emerald-700 dark:text-[#10B981] whitespace-nowrap">
                              {row.totalQuantity}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono text-[#64748B] dark:text-[#C4C7C7]">
                              {row.targetZones}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
