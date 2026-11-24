"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckSquare,
  Cloud,
  CloudOff,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CloudAudioPlayer } from "@/components/voice/cloud-audio-player";
import { LogFollowUpChat } from "@/components/voice/log-follow-up-chat";
import { useTerraPulse } from "@/context/terrapulse-context";
import { useFieldVoice } from "@/hooks/useFieldVoice";
import { sanitizeSvgMarkup } from "@/lib/ai/hybridEngine";
import { cn, formatTimestamp } from "@/lib/utils";
import {
  formatUserFacingError,
  sanitizeStoredErrorMessage,
} from "@/lib/utils/errorMessages";

function LogDetailContent() {
  const params = useParams<{ id: string }>();
  const {
    domain,
    logs,
    logsLoading,
    isOffline,
    remoteConfig,
    setSimulateOffline,
    runOrQueueCloudAudit,
    updateLogTitle,
    toggleRemediationStep,
    generateVisualDiagram,
  } = useTerraPulse();

  const log = logs.find((l) => l.id === params.id);
  const voice = useFieldVoice({
    isOffline,
    domain: log?.domain ?? domain,
    remoteConfig,
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [runningAudit, setRunningAudit] = useState(false);
  const [generatingDiagram, setGeneratingDiagram] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  if (logsLoading && !log) {
    return (
      <AppShell title="Command Logs" breadcrumbs={["FIELD OPS", "LOGS", "LOADING"]}>
        <div className="rounded-2xl border border-[#E2E8F0] dark:border-[#343535] bg-white dark:bg-[#1B1C1C] p-10 flex items-center justify-center gap-2 font-mono text-xs text-[#64748B] dark:text-[#C4C7C7]">
          <Loader2 className="h-4 w-4 animate-spin text-[#10B981]" />
          <span>Loading log from Firestore IndexedDB cache...</span>
        </div>
      </AppShell>
    );
  }

  if (!log) {
    return (
      <AppShell title="Log Detail" breadcrumbs={["FIELD OPS", "LOGS", "NOT FOUND"]}>
        <div className="rounded-2xl border border-[#E2E8F0] dark:border-[#343535] bg-white dark:bg-[#1B1C1C] p-10 text-center space-y-3">
          <p className="text-sm font-semibold">
            Field log not found in local IndexedDB cache.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#059669] dark:text-[#10B981] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Field Command
          </Link>
        </div>
      </AppShell>
    );
  }

  const startTitleEdit = () => {
    setTitleDraft(log.title);
    setEditingTitle(true);
  };

  const commitTitleEdit = async () => {
    if (titleDraft.trim()) {
      await updateLogTitle(log.id, titleDraft);
    }
    setEditingTitle(false);
  };

  const handleCloudAudit = async () => {
    if (runningAudit) return;
    setRunningAudit(true);
    setAuditError(null);
    try {
      await runOrQueueCloudAudit(log.id);
    } catch (err) {
      setAuditError(formatUserFacingError(err));
    } finally {
      setRunningAudit(false);
    }
  };

  const handleGenerateDiagram = async () => {
    if (isOffline || generatingDiagram) return;
    setGeneratingDiagram(true);
    setAuditError(null);
    try {
      await generateVisualDiagram(log.id);
    } catch (err) {
      setAuditError(formatUserFacingError(err));
    } finally {
      setGeneratingDiagram(false);
    }
  };

  const latencySec = log.localTriage?.latencyMs
    ? `${(log.localTriage.latencyMs / 1000).toFixed(2)}s`
    : "1.30s";

  const completedSteps =
    log.cloudAudit?.stepByStepPlan.filter((s) => s.completed).length ?? 0;
  const totalSteps = log.cloudAudit?.stepByStepPlan.length ?? 0;
  const safeDiagramSvg = sanitizeSvgMarkup(log.cloudAudit?.visualDiagramSvg);

  return (
    <AppShell
      title="Command Logs"
      breadcrumbs={[
        log.domain === "agri" ? "AGRI-FIELD" : "SITE-OPS",
        "COMMAND LOGS",
        log.id.slice(0, 10).toUpperCase(),
      ]}
    >
      <div className="flex flex-col gap-4">
        {/* CONTEXT HEADER & ACTION STRIP */}
        <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#292A2A] p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Left Zone: Back, Editable Title, Metadata */}
            <div className="flex flex-col items-start gap-2 flex-1 min-w-0">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 text-xs text-[#64748B] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Field Command</span>
              </Link>

              {/* Inline Editable Title */}
              <div className="flex items-center gap-2 w-full">
                {editingTitle ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitTitleEdit();
                    }}
                    className="flex items-center gap-2 w-full max-w-xl"
                  >
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      autoFocus
                      className="flex-1 rounded-xl border border-[#10B981] bg-[#F8FAFC] dark:bg-[#121414] px-3 py-1.5 font-display text-xl font-bold text-[#0F172A] dark:text-[#E3E2E2] outline-none"
                    />
                    <button
                      type="submit"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#10B981] text-[#090D16] cursor-pointer"
                      aria-label="Save title"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={startTitleEdit}
                    title="Click to edit log title"
                    className="group inline-flex items-center gap-2 text-left rounded-xl hover:bg-slate-100/70 dark:hover:bg-[#292A2A]/60 px-1.5 -ml-1.5 py-0.5 transition-colors cursor-pointer"
                  >
                    <h1 className="font-display text-xl sm:text-[24px] font-bold leading-8 tracking-[-0.6px] text-[#0F172A] dark:text-[#E3E2E2]">
                      {log.title}
                    </h1>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-[#94A3B8] dark:text-[#444748] group-hover:text-[#0F172A] dark:group-hover:text-[#C4C7C7] transition-colors" />
                  </button>
                )}
              </div>

              {/* Metadata Row + Dynamic Sync Pill */}
              <div className="flex flex-col gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-[#C4C7C7]">
                  <span className="font-mono text-[11px] font-semibold text-[#94A3B8] dark:text-[#444748]">
                    •
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {log.locationTag}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[#94A3B8] dark:text-[#444748]">
                    •
                  </span>
                  <span className="font-mono text-[11px]">
                    {formatTimestamp(log.createdAt)}
                  </span>
                </div>

                {/* Dynamic Sync Pill */}
                <div>
                  {log.isSyncedToCloud ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-[#10B981]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                      SYNCED TO CLOUD FIRESTORE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 dark:bg-[rgba(69,26,3,0.4)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 dark:text-[#F59E0B]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
                      SAVED LOCALLY (INDEXEDDB)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Zone: Adaptive Voice Playback + Cloud Audit Action Bar */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {voice.isSpeaking ? (
                <div className="inline-flex items-center gap-1 rounded-xl bg-[#F1F5F9] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] p-1">
                  <button
                    type="button"
                    onClick={
                      voice.isPaused ? voice.resumeSpeaking : voice.pauseSpeaking
                    }
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0F172A] dark:text-[#E3E2E2] hover:bg-slate-200 dark:hover:bg-[#292A2A] cursor-pointer"
                  >
                    {voice.isPaused ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                    <span>{voice.isPaused ? "Resume" : "Pause"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={voice.stopSpeaking}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-slate-200 dark:hover:bg-[#292A2A] cursor-pointer"
                  >
                    <VolumeX className="h-3.5 w-3.5" />
                    <span>Stop</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!isOffline && voice.cloudAudioLoading}
                  onClick={() => {
                    const readoutText = `${log.title}. Immediate action: ${log.localTriage?.immediateAction ?? log.rawInput}. ${log.localTriage?.summary ?? ""}`;
                    if (isOffline) {
                      voice.speakResponse(readoutText);
                    } else {
                      void voice.speakWithCloudPersona(
                        readoutText,
                        log.domain,
                        log.title
                      );
                    }
                  }}
                  title={
                    isOffline
                      ? "Read aloud offline using local browser TTS"
                      : "Play natural Cloud Persona Voice readout"
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer",
                    isOffline
                      ? "bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#1F2020] dark:hover:bg-[#292A2A] border-[#CBD5E1] dark:border-[#343535] text-[#0F172A] dark:text-[#E3E2E2]"
                      : "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 text-emerald-800 dark:text-[#34D399]"
                  )}
                >
                  {!isOffline && voice.cloudAudioLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isOffline
                      ? "Offline Voice (Local TTS)"
                      : voice.cloudAudioLoading
                        ? "Synthesizing..."
                        : `Cloud Voice (${log.domain === "agri" ? "Aoede" : "Charon"})`}
                  </span>
                </button>
              )}

              <fieldset
                disabled={runningAudit || log.cloudAuditStatus === "processing"}
                className="inline-flex border-0 p-0 m-0 min-w-0"
              >
                <button
                  type="button"
                  onClick={handleCloudAudit}
                  disabled={
                    runningAudit || log.cloudAuditStatus === "processing"
                  }
                  title={
                    isOffline
                      ? "Requires internet connection — click to queue for automatic run upon reconnect"
                      : "Run Cloud Deep Audit with Gemini"
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 dark:bg-[#292A2A] dark:hover:bg-[#343535] px-4 py-2.5 text-xs sm:text-sm font-medium text-white dark:text-[#E3E2E2] disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {runningAudit || log.cloudAuditStatus === "processing" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {runningAudit || log.cloudAuditStatus === "processing"
                      ? "Auditing..."
                      : isOffline
                        ? "Queue Cloud Audit"
                        : log.cloudAuditStatus === "completed"
                          ? "Re-Run Cloud Audit"
                          : "Run Cloud Deep Audit Now"}
                  </span>
                </button>
              </fieldset>
            </div>
          </div>

          {voice.cloudAudio && (
            <div className="mt-4">
              <CloudAudioPlayer
                audioUrl={voice.cloudAudio.audioUrl}
                voiceName={voice.cloudAudio.voiceName}
                domain={log.domain}
                label={voice.cloudAudio.label}
                onClose={voice.clearCloudAudio}
              />
            </div>
          )}

          {(auditError ||
            sanitizeStoredErrorMessage(log.cloudAuditError) ||
            voice.cloudAudioError) && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start justify-between gap-3 text-xs text-red-700 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {auditError ||
                    sanitizeStoredErrorMessage(log.cloudAuditError) ||
                    voice.cloudAudioError}
                </span>
              </div>
              {(auditError || voice.cloudAudioError) && (
                <button
                  type="button"
                  onClick={() => {
                    setAuditError(null);
                    voice.clearCloudAudio();
                  }}
                  className="font-mono text-[11px] underline shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </section>

        {/* MAIN ASYMMETRIC BENTO SPLIT LAYOUT (5 cols / 42% left vs 7 cols / 58% right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN (5 cols): Edge Triage Panel (Gemini Nano) */}
          <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent border-t-2 border-t-[#F59E0B] p-4 sm:p-5 shadow-md flex flex-col gap-5">
            {/* Panel Header */}
            <header className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0] dark:border-[#292A2A]">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#F59E0B] fill-[#F59E0B]" />
                <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                  Edge Triage
                </h2>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 dark:bg-[rgba(69,26,3,0.4)] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase text-amber-800 dark:text-[#F59E0B]">
                {log.localTriage?.inferenceSource === "in_cloud"
                  ? `CLOUD FALLBACK • ${latencySec}`
                  : `ON-DEVICE NANO • ${latencySec}`}
              </span>
            </header>

            {/* Attached Multimodal Photo */}
            {log.imageBase64 && (
              <div className="relative overflow-hidden rounded-xl border border-[#E2E8F0] dark:border-[#292A2A] bg-[#0D0E0F]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={log.imageBase64}
                  alt={log.title}
                  className="h-48 w-full object-cover"
                />
                <span className="absolute left-2.5 bottom-2.5 rounded-full bg-black/80 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#E3E2E2]">
                  MULTIMODAL INPUT • &lt;150KB
                </span>
              </div>
            )}

            {/* Telemetry Metrics Strip */}
            {log.localTriage && (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#121414] border border-[#E2E8F0] dark:border-[#292A2A] p-2.5">
                  <div className="font-mono text-[10px] uppercase text-[#64748B] dark:text-[#8E9192]">
                    SEVERITY
                  </div>
                  <div
                    className={cn(
                      "font-mono text-xs font-bold uppercase mt-1",
                      log.localTriage.severity === "critical"
                        ? "text-red-600 dark:text-[#FFB4AB]"
                        : log.localTriage.severity === "medium"
                          ? "text-amber-600 dark:text-[#F59E0B]"
                          : "text-emerald-600 dark:text-[#10B981]"
                    )}
                  >
                    {log.localTriage.severity}
                  </div>
                </div>

                <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#121414] border border-[#E2E8F0] dark:border-[#292A2A] p-2.5">
                  <div className="font-mono text-[10px] uppercase text-[#64748B] dark:text-[#8E9192]">
                    CONFIDENCE
                  </div>
                  <div className="font-mono text-xs font-bold text-[#0F172A] dark:text-[#E3E2E2] mt-1">
                    {log.localTriage.confidence}%
                  </div>
                </div>

                <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#121414] border border-[#E2E8F0] dark:border-[#292A2A] p-2.5">
                  <div className="font-mono text-[10px] uppercase text-[#64748B] dark:text-[#8E9192]">
                    ENGINE
                  </div>
                  <div className="font-mono text-xs font-bold text-emerald-600 dark:text-[#10B981] mt-1">
                    {log.localTriage.inferenceSource === "on_device"
                      ? "0 KB"
                      : "CLOUD"}
                  </div>
                </div>
              </div>
            )}

            {/* Immediate Containment Action Callout */}
            {log.localTriage && (
              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] border-l-2 border-l-[#F59E0B] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-amber-800 dark:text-[#F59E0B]">
                    IMMEDIATE CONTAINMENT ACTION
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      voice.isSpeaking
                        ? voice.stopSpeaking()
                        : voice.speakResponse(log.localTriage!.immediateAction)
                    }
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#475569] dark:text-[#C4C7C7] hover:text-[#F59E0B] cursor-pointer"
                  >
                    {voice.isSpeaking ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                    <span>{voice.isSpeaking ? "STOP" : "SPEAK"}</span>
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-[#0F172A] dark:text-[#E3E2E2]">
                  {log.localTriage.immediateAction}
                </p>
              </div>
            )}

            {/* Local Triage Summary */}
            {log.localTriage && (
              <div className="space-y-1.5">
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#8E9192]">
                  EDGE DIAGNOSTIC SUMMARY
                </h3>
                <p className="text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                  {log.localTriage.summary}
                </p>
              </div>
            )}

            {/* Original Field Observation */}
            <div className="space-y-1.5">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#8E9192]">
                RAW FIELD OBSERVATION
              </h3>
              <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#121414] border border-[#E2E8F0] dark:border-[#292A2A] p-3.5 text-xs leading-5 text-[#334155] dark:text-[#C4C7C7]">
                &ldquo;{log.rawInput}&rdquo;
              </div>
            </div>

            {/* Extracted Tags */}
            {log.localTriage && log.localTriage.extractedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {log.localTriage.extractedTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#F1F5F9] dark:bg-[#343535] px-2.5 py-0.5 font-mono text-[12px] font-medium text-[#475569] dark:text-[#C4C7C7]"
                  >
                    {tag.startsWith("#") ? tag : `#${tag}`}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* RIGHT COLUMN (7 cols): Cloud Deep Audit Panel (Gemini 3.8 Flash) */}
          <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent border-t-2 border-t-[#10B981] p-4 sm:p-5 shadow-md min-h-[580px] flex flex-col gap-5">
            {/* Panel Header */}
            <header className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0] dark:border-[#292A2A]">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-[#10B981]" />
                <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                  Cloud Deep Audit
                </h2>
              </div>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 dark:bg-[rgba(2,44,34,0.4)] px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase text-emerald-700 dark:text-[#10B981]">
                GEMINI 3.8 FLASH • CLOUD
              </span>
            </header>

            {/* FAILED STATE */}
            {log.cloudAuditStatus === "failed" && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Cloud Deep Audit Failed</div>
                    <p className="mt-0.5 opacity-90">
                      {log.cloudAuditError ||
                        "Unable to reach Gemini 3.8 Flash. Check connectivity and retry."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloudAudit}
                  disabled={runningAudit}
                  className="shrink-0 rounded-xl bg-red-600 hover:bg-red-700 px-3.5 py-2 font-mono text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                >
                  {runningAudit ? "Retrying..." : "Retry Audit"}
                </button>
              </div>
            )}

            {/* STATE 1: QUEUED OFFLINE */}
            {log.cloudAuditStatus === "queued_offline" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 dark:bg-[rgba(69,26,3,0.18)] gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30">
                  <CloudOff className="h-6 w-6 text-[#F59E0B]" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                    Queued in IndexedDB for Cloud Escalation
                  </h3>
                  <p className="text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                    On-device triage is safely persisted locally. The exact moment cellular or
                    Wi-Fi connectivity returns, Firebase AI Logic automatically runs Gemini 3.8
                    Flash to generate the root-cause audit, checklist, BOQ, and SVG diagram.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  {isOffline ? (
                    <button
                      type="button"
                      onClick={() => setSimulateOffline(false)}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] px-4 py-2 font-mono text-xs font-semibold text-[#090D16] cursor-pointer"
                    >
                      Restore Signal &amp; Auto-Run Audit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCloudAudit}
                      disabled={runningAudit}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] px-4 py-2 font-mono text-xs font-semibold text-[#090D16] disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {runningAudit ? "Auditing..." : "Run Cloud Deep Audit Now"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* STATE 2: READY TO RUN (NONE) */}
            {log.cloudAuditStatus === "none" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 rounded-xl border border-dashed border-[#CBD5E1] dark:border-[#343535] bg-[#F8FAFC] dark:bg-[#121414]/60 gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30">
                  <Sparkles className="h-6 w-6 text-[#10B981]" />
                </div>
                <div className="max-w-md space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                    Escalate to Gemini 3.8 Flash Deep Audit
                  </h3>
                  <p className="text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                    Generate a comprehensive engineering/agronomy root-cause analysis, interactive
                    step-by-step remediation checklist, exact material quantities, and a visual SVG
                    repair diagram.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloudAudit}
                  disabled={runningAudit}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-5 py-2.5 font-mono text-xs font-semibold text-white dark:text-[#090D16] disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {runningAudit
                      ? "Auditing..."
                      : isOffline
                        ? "Queue for Cloud Deep Audit"
                        : "Run Cloud Deep Audit Now"}
                  </span>
                </button>
              </div>
            )}

            {/* STATE 3: PROCESSING */}
            {log.cloudAuditStatus === "processing" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-[rgba(2,44,34,0.2)] gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-[#10B981]" />
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                    Running Gemini 3.8 Flash Cloud Reasoning...
                  </h3>
                  <p className="font-mono text-xs text-[#64748B] dark:text-[#C4C7C7]">
                    Analyzing observation + visual evidence → Computing BOQ, checklist &amp; SVG
                    remediation schematic
                  </p>
                </div>
              </div>
            )}

            {/* STATE 4: COMPLETED */}
            {log.cloudAuditStatus === "completed" && log.cloudAudit && (
              <div className="flex flex-col gap-5">
                {/* Root Cause Analysis */}
                <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-emerald-700 dark:text-[#10B981]">
                      ROOT CAUSE ANALYSIS
                    </h3>
                    <span className="font-mono text-[11px] text-[#64748B] dark:text-[#8E9192]">
                      {formatTimestamp(log.cloudAudit.completedAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#0F172A] dark:text-[#E3E2E2]">
                    {log.cloudAudit.rootCauseAnalysis}
                  </p>
                </div>

                {/* Step-by-Step Remediation Checklist */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                      STEP-BY-STEP REMEDIATION PLAN
                    </h3>
                    <span className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-[#10B981]">
                      {completedSteps} / {totalSteps} DONE
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] dark:bg-[#292A2A] overflow-hidden">
                    <div
                      className="h-full bg-[#10B981] transition-all duration-300"
                      style={{
                        width: `${totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <ul className="space-y-2 pt-1">
                    {log.cloudAudit.stepByStepPlan.map((item, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => toggleRemediationStep(log.id, idx)}
                          className="w-full flex items-start gap-2.5 rounded-xl bg-[#F8FAFC] hover:bg-slate-100 dark:bg-[#121414] dark:hover:bg-[#1F2020] border border-[#E2E8F0] dark:border-[#292A2A] p-3 text-left transition-colors cursor-pointer"
                        >
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
                            {item.step}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Estimated Materials / Agronomic Inputs */}
                <div className="space-y-2">
                  <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                    {log.domain === "agri"
                      ? "ESTIMATED AGRONOMIC INPUTS"
                      : "ESTIMATED REPAIR MATERIALS (BOQ)"}
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-[#E2E8F0] dark:border-[#292A2A] divide-y divide-[#E2E8F0] dark:divide-[#292A2A]">
                    {log.cloudAudit.estimatedMaterialsOrInputs.map((mat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-4 bg-[#F8FAFC] dark:bg-[#121414] px-3.5 py-2.5 text-xs"
                      >
                        <span className="font-medium text-[#0F172A] dark:text-[#E3E2E2]">
                          {mat.item}
                        </span>
                        <span className="font-mono font-semibold text-emerald-700 dark:text-[#10B981] shrink-0">
                          {mat.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Safety & Compliance Notes */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-[rgba(69,26,3,0.25)] p-3.5 flex items-start gap-2.5">
                  <ShieldAlert className="h-4 w-4 text-[#F59E0B] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-mono text-[11px] font-bold uppercase text-amber-800 dark:text-[#F59E0B]">
                      SAFETY &amp; COMPLIANCE PROTOCOL
                    </div>
                    <p className="text-xs leading-5 text-[#334155] dark:text-[#FEF3C7]">
                      {log.cloudAudit.safetyOrComplianceNotes}
                    </p>
                  </div>
                </div>

                {/* Cloud Remediation Visual Workflow Flowchart (Fast React/Tailwind Flowchart) */}
                <div className="rounded-xl border border-[#E2E8F0] dark:border-[#292A2A] bg-[#F8FAFC] dark:bg-[#121414] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#0F172A] dark:text-[#E3E2E2]">
                        CLOUD REMEDIATION WORKFLOW FLOWCHART
                      </h3>
                      <p className="text-[11px] text-[#64748B] dark:text-[#8E9192] mt-0.5">
                        Sequenced field intervention roadmap cached locally for offline execution.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isOffline || generatingDiagram}
                      onClick={handleGenerateDiagram}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3.5 py-1.5 font-mono text-xs font-semibold text-emerald-700 dark:text-[#10B981] disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {generatingDiagram ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {isOffline
                          ? "Online Only (Offline)"
                          : generatingDiagram
                            ? "Refreshing..."
                            : log.cloudAudit.workflowSteps?.length || safeDiagramSvg
                              ? "Refresh Workflow"
                              : "Generate Workflow"}
                      </span>
                    </button>
                  </div>

                  {isOffline &&
                    !log.cloudAudit.workflowSteps?.length &&
                    !safeDiagramSvg && (
                      <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 font-mono text-[11px] text-amber-800 dark:text-[#FEF3C7]">
                        <AlertTriangle className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
                        <span>
                          Cloud workflow synthesis requires connectivity (only_in_cloud).
                        </span>
                      </div>
                    )}

                  {log.cloudAudit.workflowSteps &&
                    log.cloudAudit.workflowSteps.length > 0 && (
                      <div className="flex flex-col gap-0">
                        {log.cloudAudit.workflowSteps.map((wf, idx) => {
                          const isLast =
                            idx === (log.cloudAudit?.workflowSteps?.length ?? 0) - 1;
                          return (
                            <div key={wf.phase + idx} className="flex gap-3">
                              {/* Vertical Flowchart Connector Rail */}
                              <div className="flex flex-col items-center">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/50 font-mono text-xs font-bold text-emerald-700 dark:text-[#10B981]">
                                  {idx + 1}
                                </span>
                                {!isLast && (
                                  <span className="w-0.5 flex-1 min-h-[20px] bg-emerald-500/30 my-1" />
                                )}
                              </div>

                              {/* Phase Card */}
                              <div
                                className={cn(
                                  "flex-1 rounded-xl border border-[#E2E8F0] dark:border-[#292A2A] bg-white dark:bg-[#1B1C1C] px-3.5 py-2.5",
                                  !isLast && "mb-2.5"
                                )}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-bold text-[#0F172A] dark:text-[#E3E2E2]">
                                    {wf.phase}
                                  </span>
                                  <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-800 dark:text-[#FBBF24]">
                                    {wf.timing}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-[#475569] dark:text-[#C4C7C7]">
                                  {wf.action}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                  {!log.cloudAudit.workflowSteps?.length && safeDiagramSvg && (
                    <div
                      className="w-full overflow-hidden rounded-xl border border-emerald-500/30 bg-[#0D0E0F] p-2 [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[340px]"
                      dangerouslySetInnerHTML={{ __html: safeDiagramSvg }}
                    />
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* CONTEXTUAL FOLLOW-UP CHAT FOR THIS LOG */}
        <LogFollowUpChat
          log={log}
          isOffline={isOffline}
          remoteConfig={remoteConfig}
          speakWithCloudPersona={voice.speakWithCloudPersona}
          speakLocalResponse={voice.speakResponse}
        />
      </div>
    </AppShell>
  );
}

export default function LogDetailPage() {
  return (
    <Suspense
      fallback={<div className="p-8 font-mono text-sm">Loading Command Log...</div>}
    >
      <LogDetailContent />
    </Suspense>
  );
}
