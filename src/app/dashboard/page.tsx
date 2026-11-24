"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Camera,
  FileAudio,
  FileText,
  FlaskConical,
  HardHat,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Sprout,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CloudAudioPlayer } from "@/components/voice/cloud-audio-player";
import { TalkWithMePanel } from "@/components/voice/talk-with-me-panel";
import { AddFieldLogResult, useTerraPulse } from "@/context/terrapulse-context";
import { useFieldVoice } from "@/hooks/useFieldVoice";
import { checkNanoAvailability } from "@/lib/ai/hybridEngine";
import { compressImageToBase64 } from "@/lib/ai/imageCompression";
import { QUICK_SCENARIO_CHIPS } from "@/lib/mock-data";
import { FieldDomain, FieldLog, InlineMediaInput } from "@/types/terrapulse";
import { cn } from "@/lib/utils";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

const DRAFT_STORAGE_KEY = "terrapulse_draft_observation";
const MAX_VIDEO_BYTES = 8 * 1024 * 1024; // 8 MB cap for 15-second field clip
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

type VoiceOptionValue =
  | ""
  | "voice-to-text"
  | "record-voice"
  | "voice-loop"
  | "talk-with-me";

type FeedFilter = "all" | "critical" | "queued" | "synced";

function formatRelativeTime(seconds: number): string {
  const diffMin = Math.max(1, Math.floor((Date.now() / 1000 - seconds) / 60));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function DashboardContent() {
  const {
    user,
    domain,
    isOffline,
    browserOffline,
    simulateOffline,
    setSimulateOffline,
    checkConnectivityNow,
    logs,
    logsLoading,
    pendingSyncCount,
    remoteConfig,
    lastError,
    clearLastError,
    addFieldLog,
    deleteFieldLog,
    runOrQueueCloudAudit,
    loadSampleData,
    resetData,
  } = useTerraPulse();

  const [rawInput, setRawInput] = useState("");
  const [locationTag, setLocationTag] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedDocument, setAttachedDocument] = useState<{
    name: string;
    text: string;
  } | null>(null);
  const [attachedAudio, setAttachedAudio] = useState<InlineMediaInput | null>(
    null
  );
  const [attachedVideo, setAttachedVideo] = useState<
    (InlineMediaInput & { previewUrl: string }) | null
  >(null);
  const [autoQueueAudit, setAutoQueueAudit] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modelDownloadPct, setModelDownloadPct] = useState<number | null>(null);
  const [streamingPreview, setStreamingPreview] = useState("");
  const [triageError, setTriageError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [speakingLogId, setSpeakingLogId] = useState<string | null>(null);
  const [voiceOption, setVoiceOption] = useState<VoiceOptionValue>("");
  const [talkWithMeOpen, setTalkWithMeOpen] = useState(false);
  const [talkSessionKey, setTalkSessionKey] = useState(0);
  const [talkInitialMessages, setTalkInitialMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string }> | undefined
  >(undefined);
  const [offlineNanoReady, setOfflineNanoReady] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate persisted draft text from sessionStorage once on mount (never wiped on network switches)
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedDraft = sessionStorage.getItem(DRAFT_STORAGE_KEY);
        if (savedDraft) {
          setRawInput((prev) => (prev ? prev : savedDraft));
        }
      } catch {
        // ignore storage access errors
      }
    });
    checkNanoAvailability()
      .then((state) => {
        setOfflineNanoReady(state === "available" || state === "downloadable");
      })
      .catch(() => {
        setOfflineNanoReady(false);
      });
  }, []);

  const updateRawInputWithDraft = useCallback((nextText: string) => {
    setRawInput(nextText);
    try {
      if (nextText) {
        sessionStorage.setItem(DRAFT_STORAGE_KEY, nextText);
      } else {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // Revoke video object URL when replaced or unmounted
  useEffect(() => {
    return () => {
      if (attachedVideo?.previewUrl) {
        URL.revokeObjectURL(attachedVideo.previewUrl);
      }
    };
  }, [attachedVideo]);

  const syncTextareaHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    const nextHeight = Math.max(32, Math.min(el.scrollHeight, 320));
    el.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight(textareaRef.current);
  }, [rawInput, syncTextareaHeight]);

  const executeTriageSubmission = useCallback(
    async (
      textToSubmit: string,
      speakResultAloud: boolean,
      audioOverride?: InlineMediaInput | null
    ): Promise<AddFieldLogResult | null> => {
      const effectiveAudio = audioOverride ?? attachedAudio;
      const hasAnyInput =
        Boolean(textToSubmit.trim()) ||
        Boolean(attachedImage) ||
        Boolean(attachedDocument) ||
        Boolean(effectiveAudio) ||
        Boolean(attachedVideo);

      if (!hasAnyInput || submitting) return null;
      setSubmitting(true);
      setStreamingPreview("");
      setTriageError(null);
      clearLastError();

      console.log("[Dashboard] Submitting triage observation...", {
        domain,
        hasText: Boolean(textToSubmit.trim()),
        hasImage: Boolean(attachedImage),
        hasDocument: Boolean(attachedDocument),
        hasAudio: Boolean(effectiveAudio),
        hasVideo: Boolean(attachedVideo),
        isOffline,
        autoQueueAudit,
      });

      try {
        const defaultPrompt = effectiveAudio
          ? "Analyze attached field audio recording. If it is only a casual greeting or test with no field issue, set ACTIONABLE: no."
          : attachedVideo
            ? "Analyze attached field video clip and provide immediate diagnosis."
            : attachedDocument
              ? `Analyze attached field document (${attachedDocument.name}) and provide immediate diagnosis.`
              : domain === "agri"
                ? "Field photo uploaded for crop health triage."
                : "Site photo uploaded for structural inspection.";

        const result = await addFieldLog({
          rawInput: textToSubmit.trim() || defaultPrompt,
          locationTag,
          domain,
          imageBase64: attachedImage,
          audioAttachment: effectiveAudio,
          videoAttachment: attachedVideo
            ? {
                data: attachedVideo.data,
                mimeType: attachedVideo.mimeType,
                name: attachedVideo.name,
                sizeBytes: attachedVideo.sizeBytes,
              }
            : null,
          documentAttachment: attachedDocument,
          autoQueueCloudAudit: autoQueueAudit,
          onDeviceInitProgress: (pct) => setModelDownloadPct(pct),
          onStreamChunk: (chunkText) => setStreamingPreview(chunkText),
        });

        // Only clear form inputs & sessionStorage draft inside explicit submit success handler
        updateRawInputWithDraft("");
        setLocationTag("");
        setAttachedImage(null);
        setAttachedDocument(null);
        setAttachedAudio(null);
        setAttachedVideo(null);

        if (!result.isActionableFieldIssue || !result.log) {
          const replyText =
            result.conversationalReply ||
            "Hello! Describe any crop, livestock, or site issue whenever you're ready to log a field diagnosis.";
          setTalkInitialMessages([
            {
              role: "user",
              text: textToSubmit.trim() || "(Voice greeting)",
            },
            {
              role: "assistant",
              text: replyText,
            },
          ]);
          setTalkSessionKey((k) => k + 1);
          setTalkWithMeOpen(true);
          return result;
        }

        console.log("[Dashboard] Triage complete and persisted:", {
          id: result.log.id,
          title: result.log.title,
          inferenceSource: result.log.localTriage?.inferenceSource,
        });
        if (speakResultAloud && result.log.localTriage) {
          setSpeakingLogId(result.log.id);
        }
        return result;
      } catch (err) {
        setTriageError(formatUserFacingError(err));
        return null;
      } finally {
        setSubmitting(false);
        setModelDownloadPct(null);
        setStreamingPreview("");
      }
    },
    [
      addFieldLog,
      attachedAudio,
      attachedDocument,
      attachedImage,
      attachedVideo,
      autoQueueAudit,
      clearLastError,
      domain,
      isOffline,
      locationTag,
      submitting,
      updateRawInputWithDraft,
    ]
  );

  // Two-Way Voice Engine (Cloud Persona TTS + MediaRecorder Record Voice + offline local TTS)
  const speakCloudRef = useRef<
    (text: string, overrideDomain?: FieldDomain, label?: string) => Promise<unknown>
  >(async () => null);
  const speakLocalRef = useRef<(text: string) => void>(() => {});

  const voice = useFieldVoice({
    isOffline,
    domain,
    remoteConfig,
    onInterimTranscript: (liveText) => {
      updateRawInputWithDraft(liveText);
    },
    onFinalTranscript: (finalText) => {
      // Voice to Text: stream into textarea for review/editing — NEVER auto-submit on pause
      updateRawInputWithDraft(finalText);
    },
    onSilenceDetected: () => {
      setVoiceOption("");
    },
    onAudioRecorded: async (audioClip, isRecordVoiceDirect) => {
      if (isRecordVoiceDirect) {
        const result = await executeTriageSubmission(
          rawInput.trim() ||
            "Voice clip recorded in the field. If the speaker only said a greeting or test without a field issue, set ACTIONABLE: no and reply warmly.",
          true,
          audioClip
        );
        if (!result) return;
        if (!result.isActionableFieldIssue && result.conversationalReply) {
          if (!isOffline) {
            await speakCloudRef.current(
              result.conversationalReply,
              domain,
              "Field Voice Reply"
            );
          } else {
            speakLocalRef.current(result.conversationalReply);
          }
          return;
        }
        if (result.log?.localTriage && !isOffline) {
          const brief = `${result.log.title}. ${result.log.localTriage.immediateAction} ${result.log.localTriage.summary}`;
          await speakCloudRef.current(brief, result.log.domain, result.log.title);
        }
      } else {
        setAttachedAudio(audioClip);
        setTriageError(null);
      }
    },
  });

  useEffect(() => {
    speakCloudRef.current = voice.speakWithCloudPersona;
    speakLocalRef.current = voice.speakResponse;
  }, [voice.speakResponse, voice.speakWithCloudPersona]);

  const activeSpeakingLogId = voice.isSpeaking ? speakingLogId : null;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToBase64(file);
      setAttachedImage(compressed);
      setTriageError(null);
    } catch (err) {
      setTriageError(formatUserFacingError(err));
    } finally {
      e.target.value = "";
    }
  };

  const handleDocumentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachedDocument({
          name: file.name,
          text: reader.result.slice(0, 4000),
        });
        setTriageError(null);
      }
    };
    reader.onerror = () => setTriageError("Failed to read attached document.");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isOffline) {
      setTriageError("Audio/Video multimodal requires internet.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setTriageError("Audio clip must be 8 MB or smaller.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const commaIdx = reader.result.indexOf(",");
      const data = commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result;
      setAttachedAudio({
        data,
        mimeType: file.type || "audio/mpeg",
        name: file.name,
        sizeBytes: file.size,
      });
      setTriageError(null);
    };
    reader.onerror = () => setTriageError("Failed to read audio file.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleVideoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isOffline) {
      setTriageError("Audio/Video multimodal requires internet.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setTriageError("Field video clip must be 8 MB or smaller (~15 seconds).");
      e.target.value = "";
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      const commaIdx = reader.result.indexOf(",");
      const data = commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result;
      setAttachedVideo({
        data,
        mimeType: file.type || "video/mp4",
        name: file.name,
        sizeBytes: file.size,
        previewUrl,
      });
      setTriageError(null);
    };
    reader.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      setTriageError("Failed to read video file.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (voice.isListening) {
      voice.stopListening();
    }
    const result = await executeTriageSubmission(rawInput, voice.voiceLoopEnabled);
    if (!result) return;
    if (!result.isActionableFieldIssue && result.conversationalReply) {
      // Casual typed greetings open Quick Chat in text-only mode (no auto voice note banner)
      return;
    }
    if (result.log?.localTriage && voice.voiceLoopEnabled) {
      const brief = `${result.log.localTriage.severity} alert. ${result.log.title}. ${result.log.localTriage.immediateAction}`;
      if (!isOffline) {
        await voice.speakWithCloudPersona(brief, result.log.domain, result.log.title);
      } else {
        voice.speakResponse(brief);
      }
    }
  };

  const handleVoiceOptionSelect = (value: VoiceOptionValue) => {
    setVoiceOption(value);
    if (!value) return;

    if (value === "voice-to-text") {
      if (voice.isListening) {
        voice.stopListening();
      } else {
        voice.startListening();
      }
      setVoiceOption("");
      return;
    }

    if (value === "record-voice") {
      if (isOffline) return;
      if (voice.isRecordingAudio) {
        voice.stopAudioRecording();
      } else {
        void voice.startAudioRecording(true);
      }
      setVoiceOption("");
      return;
    }

    if (value === "voice-loop") {
      if (isOffline) return;
      voice.setVoiceLoopEnabled(!voice.voiceLoopEnabled);
      setVoiceOption("");
      return;
    }

    if (value === "talk-with-me") {
      if (isOffline && !offlineNanoReady) return;
      setTalkInitialMessages(undefined);
      setTalkSessionKey((k) => k + 1);
      setTalkWithMeOpen(true);
      setVoiceOption("");
    }
  };

  const handleSpeakLog = async (log: FieldLog, forceLocal = false) => {
    const brief = `${log.title}. Immediate action plan: ${log.localTriage?.immediateAction ?? log.rawInput}. ${log.localTriage?.summary ?? ""}`;
    if (!forceLocal && !isOffline) {
      setSpeakingLogId(log.id);
      await voice.speakWithCloudPersona(brief, log.domain, log.title);
      return;
    }
    if (voice.isSpeaking && activeSpeakingLogId === log.id) {
      voice.stopSpeaking();
      setSpeakingLogId(null);
      return;
    }
    setSpeakingLogId(log.id);
    voice.speakResponse(brief);
  };

  const handleLoadSamples = async () => {
    setSeeding(true);
    try {
      await loadSampleData();
    } finally {
      setSeeding(false);
    }
  };

  const handleReset = async () => {
    setSeeding(true);
    try {
      await resetData();
    } finally {
      setSeeding(false);
    }
  };

  const scopedLogs = logs.filter((l) => l.domain === domain);
  const activeZoneName = (user.zone || "").trim();
  const criticalCount = scopedLogs.filter(
    (l) => l.localTriage?.severity === "critical"
  ).length;
  const queuedCount = scopedLogs.filter(
    (l) => !l.isSyncedToCloud || l.cloudAuditStatus === "queued_offline"
  ).length;

  const filteredLogs = scopedLogs.filter((log) => {
    if (feedFilter === "critical") return log.localTriage?.severity === "critical";
    if (feedFilter === "queued")
      return !log.isSyncedToCloud || log.cloudAuditStatus === "queued_offline";
    if (feedFilter === "synced") return log.isSyncedToCloud;
    return true;
  });

  const activeError = triageError || lastError;

  return (
    <AppShell title="Dashboard">
      <div className="flex flex-col gap-6">
        {/* STICKY TOP STATUS BAR (Agri-Field / Site-Ops + Neutral ONLINE/OFFLINE + QUEUED) */}
        <section className="sticky top-[108px] lg:top-16 z-20 -mt-3 lg:-mt-4 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8FAFC]/95 dark:bg-[#121414]/95 backdrop-blur-md border-b border-[#E2E8F0] dark:border-[#1F2020] flex flex-wrap items-center justify-between gap-3">
          {/* Static Read-Only Assigned Role & Zone Badge */}
          <div
            className={cn(
              "inline-flex items-center gap-2.5 h-9 px-4 rounded-full border text-sm font-semibold",
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
            {activeZoneName && (
              <>
                <span className="opacity-45">•</span>
                <span className="font-mono text-xs font-medium truncate max-w-[220px]">
                  {activeZoneName}
                </span>
              </>
            )}
          </div>

          {/* Right Zone: Neutral Network Status + Queued Pill */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Network State Toggle (Neutral, no glowing border; tracks real disconnect automatically) */}
            <button
              type="button"
              onClick={() => {
                if (browserOffline) {
                  void checkConnectivityNow();
                } else {
                  setSimulateOffline(!simulateOffline);
                }
              }}
              title={
                browserOffline
                  ? "Device disconnected — automatically restores to ONLINE when internet returns (click to re-check)"
                  : simulateOffline
                    ? "Simulated Offline Mode active — click to return ONLINE"
                    : "Connected — automatically switches to OFFLINE if internet drops (click to simulate offline)"
              }
              className="inline-flex items-center gap-2 h-[34px] px-3.5 rounded-full bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#343535] hover:bg-slate-50 dark:hover:bg-[#242525] transition-colors cursor-pointer"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  isOffline ? "bg-[#F59E0B]" : "bg-[#10B981]"
                )}
              />
              <span className="font-mono text-[13px] font-semibold tracking-[0.65px] text-[#0F172A] dark:text-[#E3E2E2]">
                {isOffline ? "OFFLINE" : "ONLINE"}
              </span>
            </button>

            {/* Offline Sync & Audit Queue Pill (No icon) */}
            <Link
              href="/synthesis"
              className="inline-flex items-center h-[34px] px-3.5 rounded-full bg-amber-500/15 dark:bg-[rgba(217,119,6,0.15)] text-amber-800 dark:text-[#FEF3C7] hover:bg-amber-500/25 transition-colors"
            >
              <span className="font-mono text-[13px] font-bold">
                {pendingSyncCount} QUEUED
              </span>
            </Link>
          </div>
        </section>

        {/* Natural Cloud Persona Voice Player (ResponseModality.AUDIO) */}
        {voice.cloudAudioLoading && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-2 font-mono text-xs text-emerald-800 dark:text-[#34D399]">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>
              Synthesizing Natural Cloud Voice (
              {domain === "agri" ? "Aoede • Agri Instructor" : "Fenrir • Site Supervisor"}
              )...
            </span>
          </div>
        )}

        {voice.cloudAudio && (
          <CloudAudioPlayer
            audioUrl={voice.cloudAudio.audioUrl}
            voiceName={voice.cloudAudio.voiceName}
            domain={domain}
            label={voice.cloudAudio.label}
            onClose={voice.clearCloudAudio}
          />
        )}

        {/* Active Local TTS Playback Bar (optional lightweight offline readout) */}
        {voice.isSpeaking && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-800 dark:text-emerald-300">
              <Volume2 className="h-4 w-4 shrink-0" />
              <span>
                {voice.isPaused
                  ? "Offline Voice Readout Paused"
                  : "Speaking Triage Aloud (Offline Web Speech)..."}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={voice.isPaused ? voice.resumeSpeaking : voice.pauseSpeaking}
                className="inline-flex items-center gap-1 rounded-full bg-white/80 dark:bg-[#1B1C1C] px-3 py-1 font-mono text-[11px] font-semibold text-[#0F172A] dark:text-[#E3E2E2] cursor-pointer"
              >
                {voice.isPaused ? (
                  <>
                    <Play className="h-3 w-3" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3" />
                    <span>Pause</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={voice.stopSpeaking}
                className="inline-flex items-center gap-1 rounded-full bg-white/80 dark:bg-[#1B1C1C] px-3 py-1 font-mono text-[11px] font-semibold text-red-600 dark:text-red-400 cursor-pointer"
              >
                <VolumeX className="h-3 w-3" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

        {/* ZONE A: QUICK FIELD CAPTURE BOX (Top Card) */}
        <section className="rounded-2xl bg-white dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-transparent p-5 sm:p-6 shadow-md flex flex-col gap-4">
          {/* Header Row inside Card */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                  Quick Field Capture
                </h2>
                <span className="rounded-full bg-[#F1F5F9] dark:bg-[#343535] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#334155] dark:text-[#E3E2E2]">
                  GEMINI NANO
                </span>
              </div>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                Zero-connectivity local triage for less than 2s at 0 KB.
              </p>
            </div>

            {/* Consolidated Voice Options <select> on the Right */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {voice.isRecordingAudio && (
                <button
                  type="button"
                  onClick={voice.stopAudioRecording}
                  className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full font-mono text-[11px] font-semibold border border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse cursor-pointer"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>Stop &amp; Analyze</span>
                </button>
              )}

              {voice.isListening && (
                <button
                  type="button"
                  onClick={voice.stopListening}
                  className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full font-mono text-[11px] font-semibold border border-amber-500/50 bg-amber-500/20 text-amber-800 dark:text-[#FEF3C7] cursor-pointer"
                >
                  <MicOff className="h-3.5 w-3.5 text-amber-500" />
                  <span>Stop Listening</span>
                </button>
              )}

              {voice.voiceLoopEnabled && !isOffline && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => voice.setVoiceLoopEnabled(false)}
                  className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-full font-mono text-[11px] font-semibold border border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Radio className="h-3.5 w-3.5" />
                  <span>Voice Loop ON</span>
                  <X className="h-3 w-3" />
                </button>
              )}

              <div className="relative inline-flex items-center">
                <Mic className="h-3.5 w-3.5 text-[#10B981] absolute left-3 pointer-events-none" />
                <select
                  aria-label="Chat Options"
                  disabled={submitting || voice.isRecordingAudio}
                  value={voiceOption}
                  onChange={(e) =>
                    handleVoiceOptionSelect(e.target.value as VoiceOptionValue)
                  }
                  title={
                    isOffline
                      ? "Cloud chat options require internet connection"
                      : "Select a voice input or Quick Chat mode"
                  }
                  className="h-[34px] pl-8 pr-7 rounded-full border border-[#CBD5E1] dark:border-[#343535] bg-[#F8FAFC] dark:bg-[#1B1C1C] font-mono text-xs font-semibold text-[#0F172A] dark:text-[#E3E2E2] outline-none focus:border-[#10B981] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  <option value="">Chat Options</option>
                  <option value="voice-to-text" disabled={isOffline}>
                    {isOffline
                      ? "Voice to Text (Requires internet)"
                      : voice.isListening
                        ? "Voice to Text (Stop)"
                        : "Voice to Text"}
                  </option>
                  <option value="record-voice" disabled={isOffline}>
                    {isOffline
                      ? "Record Voice (Requires internet)"
                      : "Record Voice"}
                  </option>
                  <option value="voice-loop" disabled={isOffline}>
                    {isOffline
                      ? "Voice Loop (Requires internet)"
                      : voice.voiceLoopEnabled
                        ? "Voice Loop (Turn Off)"
                        : "Voice Loop"}
                  </option>
                  <option
                    value="talk-with-me"
                    disabled={isOffline && !offlineNanoReady}
                  >
                    {isOffline && !offlineNanoReady
                      ? "Quick Chat (Requires internet)"
                      : "Quick Chat"}
                  </option>
                </select>
              </div>
            </div>
          </div>

          {voice.voiceNotice && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 flex items-center justify-between gap-2 font-mono text-[11px] text-amber-800 dark:text-[#FEF3C7]">
              <span>{voice.voiceNotice}</span>
              <button
                type="button"
                onClick={voice.clearVoiceNotice}
                className="shrink-0 hover:opacity-80 cursor-pointer"
                aria-label="Dismiss voice notice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs text-red-700 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{activeError}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTriageError(null);
                  clearLastError();
                }}
                className="shrink-0 hover:opacity-80 cursor-pointer"
                aria-label="Dismiss error"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Primary Input Area */}
          <form onSubmit={handleSubmit}>
            <fieldset
              disabled={submitting || voice.isRecordingAudio}
              className="flex flex-col gap-4 border-0 p-0 m-0 min-w-0 disabled:opacity-75"
            >
            <div className="flex flex-col gap-3">
              {/* Auto-growing Rounded Input with Embedded Camera Button */}
              <div className="w-full rounded-2xl bg-[#F8FAFC] dark:bg-[#0D0E0F] border border-[#E2E8F0] dark:border-[#292A2A] focus-within:border-[#059669] dark:focus-within:border-[#10B981] transition-colors px-4 py-3 flex flex-col gap-2.5">
                {/* Attached Multimodal Preview Chips (Image, Document, Audio, Video) */}
                {(attachedImage || attachedDocument || attachedAudio || attachedVideo) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {attachedImage && (
                      <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={attachedImage}
                          alt="Field capture attachment"
                          className="h-7 w-9 rounded object-cover"
                        />
                        <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                          Photo Ready (512px)
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachedImage(null)}
                          aria-label="Remove attached photo"
                          className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {attachedDocument && (
                      <div className="inline-flex items-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/30 px-2.5 py-1">
                        <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                        <span className="font-mono text-[11px] text-sky-800 dark:text-sky-300 max-w-[180px] truncate">
                          {attachedDocument.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachedDocument(null)}
                          aria-label="Remove attached document"
                          className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {attachedAudio && (
                      <div className="inline-flex items-center gap-2 rounded-lg bg-violet-500/10 border border-violet-500/30 px-2.5 py-1">
                        <FileAudio className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        <span className="font-mono text-[11px] text-violet-800 dark:text-violet-300 max-w-[180px] truncate">
                          {attachedAudio.name || "Audio Clip"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachedAudio(null)}
                          aria-label="Remove attached audio"
                          className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {attachedVideo && (
                  <div className="rounded-xl border border-amber-500/30 bg-black/90 p-2 flex flex-col gap-1.5 max-w-sm">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="font-mono text-[11px] text-amber-300 truncate">
                        Video Clip: {attachedVideo.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachedVideo(null)}
                        aria-label="Remove attached video"
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <video
                      src={attachedVideo.previewUrl}
                      controls
                      className="max-h-40 w-full rounded-lg bg-black"
                    />
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.json"
                    onChange={handleDocumentUpload}
                    className="hidden"
                  />
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileUpload}
                    className="hidden"
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm"
                    onChange={handleVideoFileUpload}
                    className="hidden"
                  />

                  <div className="mb-0.5 flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title={
                        attachedImage
                          ? "Replace field photo (Online + Offline)"
                          : "Upload or capture field photo (Online + Offline)"
                      }
                      aria-label="Upload or capture field photo"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0]/80 hover:bg-[#CBD5E1] dark:bg-[#1F2020] dark:hover:bg-[#343535] text-[#475569] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                    >
                      <Camera className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      title="Attach text/CSV/JSON field document (Online + Offline)"
                      aria-label="Attach text document"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0]/80 hover:bg-[#CBD5E1] dark:bg-[#1F2020] dark:hover:bg-[#343535] text-[#475569] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
                    >
                      <FileText className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isOffline}
                      onClick={() => audioInputRef.current?.click()}
                      title={
                        isOffline
                          ? "Audio/Video multimodal requires internet"
                          : "Upload field audio recording (Online Cloud)"
                      }
                      aria-label="Upload field audio recording"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0]/80 hover:bg-[#CBD5E1] dark:bg-[#1F2020] dark:hover:bg-[#343535] text-[#475569] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <FileAudio className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isOffline}
                      onClick={() => videoInputRef.current?.click()}
                      title={
                        isOffline
                          ? "Audio/Video multimodal requires internet"
                          : "Upload short field video clip <= 8MB (Online Cloud)"
                      }
                      aria-label="Upload field video clip"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0]/80 hover:bg-[#CBD5E1] dark:bg-[#1F2020] dark:hover:bg-[#343535] text-[#475569] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Video className="h-4 w-4" />
                    </button>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={rawInput}
                    maxLength={1500}
                    onChange={(e) => {
                      updateRawInputWithDraft(e.target.value);
                      syncTextareaHeight(e.currentTarget);
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        if (
                          !submitting &&
                          !voice.isRecordingAudio &&
                          (rawInput.trim() ||
                            attachedImage ||
                            attachedDocument ||
                            attachedAudio ||
                            attachedVideo)
                        ) {
                          e.currentTarget.form?.requestSubmit();
                        }
                      }
                    }}
                    rows={1}
                    placeholder="Describe or upload photo, doc, audio, or video to analyze..."
                    className="w-full h-[32px] min-h-[32px] max-h-[320px] overflow-y-auto resize-none bg-transparent py-1 text-sm leading-6 text-[#0F172A] dark:text-[#E3E2E2] placeholder:text-[#64748B] dark:placeholder:text-[#8E9192] outline-none disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isOffline ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.4px] text-amber-700 dark:text-[#FBBF24]">
                      Audio/Video multimodal requires internet • Text/Photo/Doc ready offline
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.4px] text-[#64748B] dark:text-[#8E9192]">
                      Text • Photo • Doc • Audio • Video Ready
                    </span>
                  )}
                  <span
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      rawInput.length >= 1400
                        ? "text-amber-600 dark:text-[#F59E0B]"
                        : "text-[#94A3B8] dark:text-[#8E9192]"
                    )}
                  >
                    {rawInput.length} / 1500
                  </span>
                </div>
              </div>

              {/* Location Tag + Single Quick Demo Chip */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                  <MapPin className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] dark:text-[#8E9192]" />
                  <input
                    type="text"
                    value={locationTag}
                    onChange={(e) => setLocationTag(e.target.value)}
                    placeholder={
                      activeZoneName
                        ? `Zone: ${activeZoneName}`
                        : domain === "agri"
                          ? "Location: Block C Maize Plot"
                          : "Location: Sector 4 Foundation"
                    }
                    className="h-9 w-full rounded-xl bg-[#F8FAFC] dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#292A2A] pl-8 pr-3 font-mono text-xs text-[#0F172A] dark:text-[#E3E2E2] placeholder:text-[#8E9192] outline-none focus:border-[#10B981]"
                  />
                </div>

                {/* Single Quick Demo */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7]">
                    QUICK DEMO:
                  </span>
                  {QUICK_SCENARIO_CHIPS[domain].slice(0, 1).map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        setRawInput(chip.text);
                        setLocationTag(chip.location);
                        setAttachedImage(chip.image);
                      }}
                      className="rounded-full bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:bg-[#1B1C1C] dark:hover:bg-[#292A2A] px-3.5 py-1.5 font-mono text-[12px] sm:text-[13px] font-medium text-[#334155] dark:text-[#E3E2E2] transition-colors cursor-pointer"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Control Bar inside Capture Box */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-[#F1F5F9] dark:bg-[#1B1C1C] px-4 py-3.5">
              {/* Cloud Audit Escalation Checkbox */}
              <label className="inline-flex items-center gap-2.5 text-xs text-[#475569] dark:text-[#C4C7C7] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoQueueAudit}
                  onChange={(e) => setAutoQueueAudit(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#059669] dark:accent-[#C7C6C6] cursor-pointer"
                />
                <span>
                  Auto-queue for Cloud Audit (Gemini 3.8 Flash) when signal restores
                </span>
              </label>

              {/* Primary Instant Action */}
              <div className="flex items-center shrink-0">
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    voice.isRecordingAudio ||
                    (!rawInput.trim() &&
                      !attachedImage &&
                      !attachedDocument &&
                      !attachedAudio &&
                      !attachedVideo)
                  }
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#C7C6C6] dark:hover:bg-[#E3E2E2] px-6 text-sm font-semibold tracking-[-0.35px] text-white dark:text-[#303031] shadow-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>
                    {submitting
                      ? modelDownloadPct !== null && modelDownloadPct < 100
                        ? `Downloading Nano (${modelDownloadPct}%)...`
                        : streamingPreview
                          ? "Streaming Triage..."
                          : "Analyzing on Edge (first run warms up local GPU)..."
                      : "Run Instant Triage"}
                  </span>
                </button>
              </div>
            </div>

            {/* Live Streaming Triage Preview */}
            {submitting && streamingPreview && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-[#121414] px-4 py-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.55px] text-emerald-700 dark:text-[#10B981]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse" />
                  <span>
                    {isOffline
                      ? "LIVE EDGE STREAM (GEMINI NANO)"
                      : "LIVE HYBRID STREAM"}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-[#0F172A] dark:text-[#E3E2E2]">
                  {streamingPreview}
                </pre>
              </div>
            )}
            </fieldset>
          </form>

          {/* Hands-Free "Talk with Me" & Greeting Multi-Turn Field Assistant */}
          {talkWithMeOpen && (
            <TalkWithMePanel
              key={talkSessionKey}
              domain={domain}
              zoneName={activeZoneName}
              isOffline={isOffline}
              remoteConfig={remoteConfig}
              initialMessages={talkInitialMessages}
              onClose={() => {
                setTalkWithMeOpen(false);
                setTalkInitialMessages(undefined);
              }}
              onSaveAsFieldLog={async (conversationText) => {
                await addFieldLog({
                  rawInput: conversationText,
                  locationTag: activeZoneName,
                  domain,
                  autoQueueCloudAudit: autoQueueAudit,
                });
              }}
              speakLocalResponse={voice.speakResponse}
            />
          )}
        </section>

        {/* ZONE B: RECENT FIELD LOGS FEED */}
        <section id="field-logs" className="flex flex-col gap-5 pt-2">
          {/* Feed Header & Filter Strip */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] text-[#0F172A] dark:text-[#E3E2E2]">
                Recent Field Logs
              </h3>

              {/* Micro Counters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/15 dark:bg-[#93000A] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-red-700 dark:text-[#FFDAD6]">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-[#FFB4AB]" />
                  {criticalCount} CRITICAL
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 dark:bg-[rgba(217,119,6,0.15)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 dark:text-[#FEF3C7]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
                  {queuedCount} QUEUED SYNC
                </span>
              </div>
            </div>

            {/* Right: Filter Tabs */}
            <div className="flex flex-wrap items-center gap-2">

              <div className="inline-flex items-center rounded-full bg-[#E2E8F0]/80 dark:bg-[#1B1C1C] p-0.5">
                {(
                  [
                    { key: "all", label: "All" },
                    { key: "critical", label: "Critical" },
                    { key: "queued", label: "Queued Sync" },
                    { key: "synced", label: "Synced" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFeedFilter(tab.key)}
                    className={cn(
                      "h-[26px] px-3 rounded-full font-mono text-[12px] sm:text-[13px] transition-colors cursor-pointer",
                      feedFilter === tab.key
                        ? "bg-white dark:bg-[#343535] font-semibold text-[#0F172A] dark:text-[#E3E2E2]"
                        : "font-medium text-[#475569] dark:text-[#C4C7C7] hover:text-[#0F172A] dark:hover:text-white"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 2-Column Responsive Card Grid */}
          {logsLoading ? (
            <div className="rounded-2xl border border-[#E2E8F0] dark:border-[#292A2A] p-10 flex items-center justify-center gap-2 text-xs font-mono text-[#64748B] dark:text-[#C4C7C7]">
              <Loader2 className="h-4 w-4 animate-spin text-[#10B981]" />
              <span>Syncing Firestore offline IndexedDB cache...</span>
            </div>
          ) : filteredLogs.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {filteredLogs.map((log) => {
                const severity = log.localTriage?.severity ?? "low";
                const isThisSpeaking = activeSpeakingLogId === log.id;
                const engineLabel =
                  log.cloudAuditStatus === "completed"
                    ? log.localTriage?.inferenceSource === "in_cloud"
                      ? "CLOUD AUDIT + FALLBACK"
                      : "CLOUD GEMINI + NANO"
                    : log.localTriage?.inferenceSource === "in_cloud"
                      ? "CLOUD FALLBACK"
                      : "ON-DEVICE NANO";

                return (
                  <article
                    key={log.id}
                    className="rounded-2xl bg-white dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-transparent p-5 shadow-xs flex flex-col justify-between gap-5"
                  >
                    <div className="flex flex-col gap-3">
                      {/* Card Top Bar */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.55px]",
                            severity === "critical" &&
                              "bg-red-600/15 dark:bg-[#93000A] text-red-700 dark:text-[#FFB4AB]",
                            severity === "medium" &&
                              "bg-slate-200 dark:bg-[#343535] text-slate-800 dark:text-[#E3E2E2]",
                            severity === "low" &&
                              "bg-slate-100 dark:bg-[#1B1C1C] text-slate-600 dark:text-[#C4C7C7]"
                          )}
                        >
                          {severity}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-[#F1F5F9] dark:bg-[#343535] px-2.5 py-0.5 font-mono text-[12px] font-medium tracking-[0.65px] text-[#475569] dark:text-[#C4C7C7]">
                            {engineLabel}
                            {log.localTriage?.latencyMs
                              ? ` • ${(log.localTriage.latencyMs / 1000).toFixed(1)}s`
                              : ""}
                          </span>
                          {isOffline ? (
                            <div className="flex items-center gap-1">
                              <span
                                title="Cloud Natural Voice requires internet"
                                className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-800 dark:text-[#FBBF24]"
                              >
                                Cloud Voice (Online Only)
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleSpeakLog(log, true)}
                                title={
                                  isThisSpeaking
                                    ? "Stop local readout"
                                    : "Optional local browser readout (offline)"
                                }
                                aria-label="Optional local browser readout"
                                className={cn(
                                  "inline-flex h-[26px] w-[26px] items-center justify-center rounded-full transition-colors cursor-pointer",
                                  isThisSpeaking
                                    ? "bg-emerald-500/20 text-emerald-500"
                                    : "bg-[#F1F5F9] dark:bg-[#343535] text-[#475569] dark:text-[#C4C7C7] hover:text-emerald-500"
                                )}
                              >
                                {isThisSpeaking ? (
                                  <VolumeX className="h-3.5 w-3.5" />
                                ) : (
                                  <Volume2 className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={voice.cloudAudioLoading}
                              onClick={() => void handleSpeakLog(log, false)}
                              title={`Play Natural Cloud Voice (${
                                log.domain === "agri"
                                  ? "Aoede • Agri Instructor"
                                  : "Fenrir • Site Supervisor"
                              })`}
                              aria-label="Play Natural Cloud Voice"
                              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-[#10B981] hover:bg-emerald-500/25 transition-colors disabled:opacity-45 cursor-pointer"
                            >
                              {voice.cloudAudioLoading && speakingLogId === log.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Volume2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}

                          {confirmDeleteId === log.id ? (
                            <div className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/40 pl-2 pr-1 py-0.5">
                              <button
                                type="button"
                                disabled={deletingLogId === log.id}
                                onClick={async () => {
                                  setDeletingLogId(log.id);
                                  setTriageError(null);
                                  try {
                                    await deleteFieldLog(log.id);
                                    setConfirmDeleteId(null);
                                  } catch (err) {
                                    setTriageError(formatUserFacingError(err));
                                  } finally {
                                    setDeletingLogId(null);
                                  }
                                }}
                                className="font-mono text-[10px] font-semibold uppercase text-red-700 dark:text-red-300 hover:underline disabled:opacity-50 cursor-pointer"
                              >
                                {deletingLogId === log.id ? "Deleting..." : "Delete"}
                              </button>
                              <button
                                type="button"
                                disabled={deletingLogId === log.id}
                                onClick={() => setConfirmDeleteId(null)}
                                aria-label="Cancel delete"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-red-600 dark:text-red-300 hover:bg-red-500/20 cursor-pointer"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(log.id)}
                              title="Delete field log"
                              aria-label={`Delete ${log.title}`}
                              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#F1F5F9] dark:bg-[#343535] text-[#64748B] dark:text-[#C4C7C7] hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Clickable Log Title with Hover Affordance */}
                      <h4 className="font-display text-[20px] font-semibold leading-7 text-[#0F172A] dark:text-[#E3E2E2]">
                        <Link
                          href={`/logs/${log.id}`}
                          className="group inline-flex items-start justify-between gap-2 w-full cursor-pointer hover:text-[#059669] dark:hover:text-[#10B981] transition-colors"
                        >
                          <span className="group-hover:underline underline-offset-4 decoration-emerald-500/70">
                            {log.title}
                          </span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 mt-1.5 text-emerald-600/75 dark:text-emerald-400/80 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </Link>
                      </h4>

                      {/* Metadata + Sync Status (derived from Firestore metadata.fromCache) */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] sm:text-[13px] font-medium text-[#475569] dark:text-[#C4C7C7]">
                          <span className="inline-flex items-center gap-1 text-[#0F172A] dark:text-[#E3E2E2]">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            {log.locationTag}
                          </span>
                          <span>•</span>
                          <span>{formatRelativeTime(log.createdAt.seconds)}</span>
                          {log.localTriage && (
                            <>
                              <span>•</span>
                              <span>{log.localTriage.confidence}% conf</span>
                            </>
                          )}
                        </div>

                        <div>
                          {log.isSyncedToCloud ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/15 dark:bg-[rgba(5,150,105,0.2)] px-2.5 py-0.5 font-mono text-[12px] sm:text-[13px] font-semibold text-emerald-800 dark:text-[#D1FAE5]">
                              Synced to Cloud Firestore
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-500/15 dark:bg-[rgba(217,119,6,0.15)] px-2.5 py-0.5 font-mono text-[12px] sm:text-[13px] font-semibold text-amber-800 dark:text-[#FEF3C7]">
                              Saved Locally (Offline)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Immediate Action Callout Box */}
                      {log.localTriage && (
                        <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent p-3.5 flex flex-col gap-1">
                          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-[#475569] dark:text-[#C7C6C6]">
                            IMMEDIATE ACTION PLAN
                          </span>
                          <p className="text-sm leading-5 text-[#0F172A] dark:text-[#E3E2E2]">
                            {log.localTriage.immediateAction}
                          </p>
                        </div>
                      )}

                      {/* Extracted Tags */}
                      {log.localTriage && log.localTriage.extractedTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
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
                    </div>

                    {/* Card Footer */}
                    <div className="rounded-xl bg-[#F1F5F9]/80 dark:bg-[rgba(13,14,15,0.4)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      {log.cloudAuditStatus === "queued_offline" ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 dark:bg-[rgba(217,119,6,0.15)] px-3 py-1 font-mono text-[12px] sm:text-[13px] font-medium text-amber-800 dark:text-[#FEF3C7]">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F59E0B] opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#F59E0B]" />
                          </span>
                          Queued for Cloud Audit
                        </span>
                      ) : log.cloudAuditStatus === "processing" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 font-mono text-[12px] font-semibold text-sky-700 dark:text-sky-300">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Auditing in Cloud...
                        </span>
                      ) : log.cloudAuditStatus === "completed" ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/15 dark:bg-[rgba(5,150,105,0.2)] px-3 py-1 font-mono text-[12px] sm:text-[13px] font-semibold text-emerald-800 dark:text-[#D1FAE5]">
                          Cloud Deep Audit Ready
                        </span>
                      ) : log.cloudAuditStatus === "failed" ? (
                        <span className="inline-flex items-center rounded-full bg-red-500/15 px-3 py-1 font-mono text-[12px] font-semibold text-red-700 dark:text-red-300">
                          Cloud Audit Failed
                        </span>
                      ) : (
                        <span className="font-mono text-[12px] sm:text-[13px] font-medium text-[#64748B] dark:text-[#C4C7C7]">
                          Edge Triage Only
                        </span>
                      )}

                      {log.cloudAuditStatus === "none" || log.cloudAuditStatus === "failed" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTriageError(null);
                            runOrQueueCloudAudit(log.id).catch((err) => {
                              setTriageError(formatUserFacingError(err));
                            });
                          }}
                          className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 px-3.5 py-1 font-mono text-[12px] sm:text-[13px] font-medium text-amber-900 dark:text-[#FEF3C7] transition-colors cursor-pointer"
                        >
                          {isOffline
                            ? "Queue Audit"
                            : log.cloudAuditStatus === "failed"
                              ? "Retry Cloud Audit"
                              : "Run Cloud Audit"}
                        </button>
                      ) : (
                        <Link
                          href={`/logs/${log.id}`}
                          className="inline-flex items-center gap-1.5 font-mono text-[12px] sm:text-[13px] font-semibold text-[#334155] dark:text-[#C7C6C6] hover:text-[#059669] dark:hover:text-white transition-colors"
                        >
                          <span>Inspect Audit</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#CBD5E1] dark:border-[#343535] p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                No field logs yet for this view.
              </p>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                Capture a live field observation above or seed realistic Nigerian agriculture &amp;
                construction logs below.
              </p>
            </div>
          )}

          {/* Empty State / Quick Sandbox Helper */}
          <div className="mt-2 rounded-2xl bg-[#F1F5F9] dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-transparent p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <FlaskConical className="h-4 w-4 shrink-0 text-[#475569] dark:text-[#C4C7C7] mt-0.5 sm:mt-0" />
              <p className="text-xs leading-4 text-[#334155] dark:text-[#E3E2E2]">
                <strong className="font-semibold">Demo Sandbox:</strong> Test zero-connectivity
                triage by toggling ONLINE/OFFLINE above, loading sample Agri &amp; Site-Ops records
                into Firestore, or resetting your workspace.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={seeding}
                onClick={handleLoadSamples}
                className="h-10 px-4 rounded-xl bg-[#E2E8F0] hover:bg-[#CBD5E1] dark:bg-[#343535] dark:hover:bg-[#424343] font-mono text-[12px] sm:text-[13px] font-medium text-[#0F172A] dark:text-[#E3E2E2] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {seeding ? "Working..." : "Load Sample Data"}
              </button>
              <button
                type="button"
                disabled={seeding}
                onClick={handleReset}
                className="h-10 px-4 rounded-xl bg-white hover:bg-slate-50 dark:bg-[#1F2020] dark:hover:bg-[#292A2A] border border-[#E2E8F0] dark:border-transparent font-mono text-[12px] sm:text-[13px] font-medium text-[#475569] dark:text-[#C4C7C7] disabled:opacity-50 transition-colors cursor-pointer"
              >
                Reset Data
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-sm font-mono">Loading Field Command...</div>}
    >
      <DashboardContent />
    </Suspense>
  );
}
