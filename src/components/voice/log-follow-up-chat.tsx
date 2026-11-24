"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  AssistantChatMessage,
  streamFieldAssistantChat,
} from "@/lib/ai/hybridEngine";
import { FieldLog, RemoteConfigValues } from "@/types/terrapulse";
import { cn } from "@/lib/utils";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

interface FollowUpMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  source?: "on_device" | "in_cloud";
}

interface LogFollowUpChatProps {
  log: FieldLog;
  isOffline: boolean;
  remoteConfig: RemoteConfigValues;
  speakWithCloudPersona: (
    text: string,
    overrideDomain?: FieldLog["domain"],
    label?: string
  ) => Promise<unknown>;
  speakLocalResponse: (text: string) => void;
}

function buildLogContextSummary(log: FieldLog): string {
  const parts: string[] = [
    `Title: ${log.title}`,
    `Zone: ${log.locationTag}`,
    `Original Field Observation: ${log.rawInput}`,
  ];
  if (log.localTriage) {
    parts.push(
      `Severity: ${log.localTriage.severity} (${log.localTriage.confidence}% confidence)`,
      `Triage Summary: ${log.localTriage.summary}`,
      `Immediate Action: ${log.localTriage.immediateAction}`
    );
  }
  if (log.cloudAudit) {
    parts.push(
      `Cloud Deep Audit Root Cause: ${log.cloudAudit.rootCauseAnalysis}`,
      `Safety/Compliance: ${log.cloudAudit.safetyOrComplianceNotes}`,
      `Remediation Steps: ${log.cloudAudit.stepByStepPlan.map((s) => s.step).join("; ")}`
    );
  }
  return parts.join("\n");
}

export function LogFollowUpChat({
  log,
  isOffline,
  remoteConfig,
  speakWithCloudPersona,
  speakLocalResponse,
}: LogFollowUpChatProps) {
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolledUpRef = useRef(false);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || isUserScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleContainerScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserScrolledUpRef.current = distanceFromBottom > 40;
  };

  const contextSummary = buildLogContextSummary(log);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setErrorMsg(null);
    setSending(true);
    setInput("");

    const now = Date.now();
    const userMsg: FollowUpMessage = {
      id: `q-${now}`,
      role: "user",
      text: trimmed,
      timestamp: now,
    };
    const assistantId = `ans-${now + 1}`;

    const history: AssistantChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? "model" : "user",
      text: m.text,
      createdAt: m.timestamp,
    }));

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", text: "", timestamp: now + 1 },
    ]);

    try {
      const res = await streamFieldAssistantChat({
        message: trimmed,
        history,
        domain: log.domain,
        locationLabel: log.locationTag,
        contextSummary,
        isSimulatedOffline: isOffline,
        remoteConfig,
        onChunk: (acc) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: acc } : m))
          );
        },
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: res.text, source: res.inferenceSource }
            : m
        )
      );
    } catch (err) {
      setErrorMsg(formatUserFacingError(err));
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#292A2A] p-5 sm:p-6 shadow-md flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] dark:border-[#292A2A] pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
              Ask Follow-Up Questions About This Log
            </h2>
            <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
              Grounded in this log&apos;s observation, triage plan
              {log.cloudAudit ? ", and Cloud Deep Audit" : ""}.
            </p>
          </div>
        </div>

        <span className="rounded-full bg-[#F1F5F9] dark:bg-[#292A2A] px-3 py-1 font-mono text-[11px] font-semibold uppercase text-[#475569] dark:text-[#C4C7C7]">
          {isOffline ? "ONLY_ON_DEVICE (NANO)" : "HYBRID GEMINI"}
        </span>
      </div>

      {messages.length > 0 && (
        <div
          ref={messagesContainerRef}
          onScroll={handleContainerScroll}
          className="max-h-[380px] overflow-y-auto space-y-2.5 pr-1"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl px-4 py-3 text-xs leading-5",
                m.role === "user"
                  ? "ml-8 bg-[#0F172A] text-white dark:bg-[#292A2A] dark:text-[#E3E2E2]"
                  : "mr-4 bg-[#F8FAFC] dark:bg-[#121414] border border-[#E2E8F0] dark:border-[#292A2A] text-[#0F172A] dark:text-[#E3E2E2]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-75 flex items-center gap-1">
                  {m.role === "assistant" && (
                    <Sparkles className="h-3 w-3 text-emerald-500" />
                  )}
                  {m.role === "user"
                    ? "You"
                    : m.source === "on_device"
                      ? "Gemini Nano (Edge)"
                      : "TerraPulse Assistant"}
                </span>
                {m.role === "assistant" && m.text && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isOffline) {
                        void speakWithCloudPersona(
                          m.text,
                          log.domain,
                          `Follow-Up: ${log.title}`
                        );
                      } else {
                        speakLocalResponse(m.text);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 cursor-pointer transition-colors"
                  >
                    <Volume2 className="h-3 w-3" />
                    <span>Listen to Reply</span>
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap">
                {m.text || (
                  <span className="inline-flex items-center gap-1.5 opacity-65">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing log context...
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleAsk}>
        <fieldset
          disabled={sending}
          className="flex items-center gap-2 border-0 p-0 m-0 min-w-0 disabled:opacity-60"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              log.domain === "agri"
                ? "Ask about dosage, spray interval, rain safety, or spread risk..."
                : "Ask about shoring loads, cure time, rebar cover, or inspection criteria..."
            }
            className="h-10 flex-1 rounded-xl border border-[#CBD5E1] dark:border-[#343535] bg-[#F8FAFC] dark:bg-[#0D0E0F] px-3.5 text-xs text-[#0F172A] dark:text-[#E3E2E2] outline-none focus:border-emerald-500 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex h-10 px-4 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            <span>Ask</span>
          </button>
        </fieldset>
      </form>
    </section>
  );
}
