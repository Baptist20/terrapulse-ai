"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Radio,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  AssistantChatMessage,
  LiveVoiceSessionHandle,
  generatePersonaSpeech,
  startGeminiLiveVoiceSession,
  streamFieldAssistantChat,
} from "@/lib/ai/hybridEngine";
import { FieldDomain, RemoteConfigValues } from "@/types/terrapulse";
import { cn } from "@/lib/utils";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

export interface TalkMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  source?: "on_device" | "in_cloud";
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechCtor = new () => SpeechRecognitionLike;

interface TalkWithMePanelProps {
  domain: FieldDomain;
  zoneName: string;
  isOffline: boolean;
  remoteConfig: RemoteConfigValues;
  initialMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  onClose: () => void;
  onSaveAsFieldLog: (conversationText: string) => Promise<void>;
  speakLocalResponse: (text: string) => void;
}

export function TalkWithMePanel({
  domain,
  zoneName,
  isOffline,
  remoteConfig,
  initialMessages,
  onClose,
  onSaveAsFieldLog,
  speakLocalResponse,
}: TalkWithMePanelProps) {
  const buildInitialThread = (): TalkMessage[] => {
    const now = Date.now();
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages.map((m, idx) => ({
        id: `init-${idx}-${now}`,
        role: m.role,
        text: m.text,
        timestamp: now + idx,
      }));
    }
    return [
      {
        id: "welcome",
        role: "assistant",
        timestamp: now,
        text:
          domain === "agri"
            ? `Hey there! I'm your Agri-Field assistant for ${zoneName || "your farm"}. Ask me anything about crops, pests, soil, or irrigation — nothing is logged unless you click "Save Conversation as Field Log".`
            : `Site-Ops assistant online for ${zoneName || "your site"}. Ask any structural, concrete, or safety question — nothing is logged unless you click "Save Conversation as Field Log".`,
      },
    ];
  };

  const [messages, setMessages] = useState<TalkMessage[]>(buildInitialThread);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [savingConversation, setSavingConversation] = useState(false);
  const [conversationSaved, setConversationSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [turnBasedFallback, setTurnBasedFallback] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveHandleRef = useRef<LiveVoiceSessionHandle | null>(null);
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const inlineAudioUrlRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolledUpRef = useRef(false);

  // Only scroll the internal bounded container when a new message is added,
  // and NEVER hijack scroll if the user has scrolled up.
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

  useEffect(() => {
    const audioEl = inlineAudioRef.current;
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      if (liveHandleRef.current) {
        void liveHandleRef.current.stop();
        liveHandleRef.current = null;
      }
      if (audioEl) {
        audioEl.pause();
      }
      if (inlineAudioUrlRef.current) {
        URL.revokeObjectURL(inlineAudioUrlRef.current);
        inlineAudioUrlRef.current = null;
      }
    };
  }, []);

  const stopInlineAudio = () => {
    if (inlineAudioRef.current) {
      inlineAudioRef.current.pause();
      inlineAudioRef.current.currentTime = 0;
    }
    setPlayingAudioId(null);
  };

  const handleListenInline = async (msg: TalkMessage) => {
    if (!msg.text.trim()) return;
    if (playingAudioId === msg.id) {
      stopInlineAudio();
      return;
    }
    stopInlineAudio();

    if (isOffline) {
      speakLocalResponse(msg.text);
      return;
    }

    setLoadingAudioId(msg.id);
    try {
      const res = await generatePersonaSpeech(msg.text, domain, {
        isSimulatedOffline: isOffline,
        remoteConfig,
      });
      if (!res?.audioUrl) return;

      if (inlineAudioUrlRef.current) {
        URL.revokeObjectURL(inlineAudioUrlRef.current);
      }
      inlineAudioUrlRef.current = res.audioUrl;

      if (inlineAudioRef.current) {
        inlineAudioRef.current.src = res.audioUrl;
        inlineAudioRef.current.onended = () => setPlayingAudioId(null);
        inlineAudioRef.current.onerror = () => setPlayingAudioId(null);
        await inlineAudioRef.current.play();
        setPlayingAudioId(msg.id);
      }
    } catch {
      // Fall back quietly to local TTS if cloud audio synthesis fails
      speakLocalResponse(msg.text);
    } finally {
      setLoadingAudioId(null);
    }
  };

  const stopLiveSession = async () => {
    if (liveHandleRef.current) {
      await liveHandleRef.current.stop();
      liveHandleRef.current = null;
    }
    setLiveActive(false);
    setLiveStatus(null);
  };

  const toggleLiveVoice = async () => {
    if (isOffline) return;
    if (liveActive) {
      await stopLiveSession();
      return;
    }

    setErrorMsg(null);
    setLiveConnecting(true);
    try {
      const handle = await startGeminiLiveVoiceSession({
        domain,
        locationLabel: zoneName,
        isSimulatedOffline: isOffline,
        onStatusChange: (status) => setLiveStatus(status),
        onAudioReplyUrl: (audioUrl, transcript) => {
          if (transcript) {
            setMessages((prev) => [
              ...prev,
              {
                id: `live-${Date.now()}`,
                role: "assistant",
                text: transcript,
                timestamp: Date.now(),
                source: "in_cloud",
              },
            ]);
          }
          if (inlineAudioRef.current) {
            inlineAudioRef.current.src = audioUrl;
            inlineAudioRef.current.play().catch(() => {});
          }
        },
      });

      if (handle.connected) {
        liveHandleRef.current = handle;
        setLiveActive(true);
        setTurnBasedFallback(false);
      } else {
        // Seamless fallback without scary errors — show subtle pill & activate turn-based mic
        setTurnBasedFallback(true);
        setLiveStatus(null);
        toggleDictate();
      }
    } finally {
      setLiveConnecting(false);
    }
  };

  const toggleDictate = () => {
    if (isOffline) return;
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    const win = window as Window & {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setErrorMsg(
        "Browser speech recognition is unavailable — type your question below."
      );
      return;
    }

    setErrorMsg(null);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    let finalized = input.trim();

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const t = res?.[0]?.transcript ?? "";
        if (res?.isFinal) {
          finalized = finalized ? `${finalized} ${t.trim()}` : t.trim();
        } else {
          interim += t;
        }
      }
      setInput([finalized, interim.trim()].filter(Boolean).join(" "));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
    }

    setErrorMsg(null);
    setSending(true);
    setConversationSaved(false);
    setInput("");
    isUserScrolledUpRef.current = false;

    const now = Date.now();
    const userMsg: TalkMessage = {
      id: `u-${now}`,
      role: "user",
      text: trimmed,
      timestamp: now,
    };
    const assistantId = `a-${now + 1}`;

    const historyTurns: AssistantChatMessage[] = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({
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
      const result = await streamFieldAssistantChat({
        domain,
        locationLabel: zoneName,
        history: historyTurns,
        message: trimmed,
        isSimulatedOffline: isOffline,
        remoteConfig,
        onChunk: (accumulated) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: accumulated } : m
            )
          );
        },
      });

      // Respond with text only — do NOT auto-generate voice notes or shift page scroll.
      // User can click the per-message "Listen" button whenever they want audio.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: result.text, source: result.inferenceSource }
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

  const hasSubstantiveTurns = messages.some(
    (m) => m.id !== "welcome" && m.text.trim().length > 0
  );

  const handleSaveConversation = async () => {
    if (savingConversation || !hasSubstantiveTurns) return;
    setSavingConversation(true);
    setErrorMsg(null);
    try {
      const transcript = messages
        .filter((m) => m.id !== "welcome" && m.text.trim())
        .map(
          (m) =>
            `${m.role === "user" ? "Operator" : "TerraPulse Assistant"}: ${m.text.trim()}`
        )
        .join("\n\n");
      await onSaveAsFieldLog(
        `Field consultation summary from Quick Chat:\n\n${transcript}`
      );
      setConversationSaved(true);
    } catch (err) {
      setErrorMsg(formatUserFacingError(err));
    } finally {
      setSavingConversation(false);
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/[0.04] dark:bg-[#141717] p-4 sm:p-5 flex flex-col gap-3.5 shadow-sm">
      {/* Hidden inline audio element (plays on-demand Listen & Live API audio without top banner) */}
      <audio ref={inlineAudioRef} className="hidden" />

      {/* Header with Save Conversation as Field Log + Live Mic */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] dark:border-[#292A2A] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                Quick Chat
              </h3>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                {isOffline
                  ? "Edge Nano"
                  : liveActive
                    ? "Gemini Live Audio"
                    : turnBasedFallback
                      ? "Using Turn-Based Voice Mode"
                      : "Hybrid Gemini"}
              </span>
            </div>
            <p className="text-[11px] text-[#64748B] dark:text-[#9CA3AF]">
              Multi-turn chat — does not create Field Logs until you save.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isOffline || liveConnecting || sending}
            onClick={() => void toggleLiveVoice()}
            title={
              isOffline
                ? "Requires internet connection"
                : liveActive
                  ? "Stop Gemini Live real-time audio"
                  : "Start voice mode (Gemini Live with automatic turn-based fallback)"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-full font-mono text-[11px] font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
              liveActive
                ? "border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
            )}
          >
            {liveConnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : liveActive ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Radio className="h-3 w-3" />
            )}
            <span>
              {liveConnecting
                ? "Connecting..."
                : liveActive
                  ? "Stop Live Mic"
                  : "Live Mic"}
            </span>
          </button>

          <button
            type="button"
            disabled={
              savingConversation || !hasSubstantiveTurns || conversationSaved
            }
            onClick={() => void handleSaveConversation()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full font-mono text-[11px] font-semibold bg-[#0F172A] hover:bg-slate-800 dark:bg-[#292A2A] dark:hover:bg-[#343535] text-white dark:text-[#E3E2E2] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {savingConversation ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : conversationSaved ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <BookmarkPlus className="h-3 w-3 text-emerald-400" />
            )}
            <span>
              {savingConversation
                ? "Saving Log..."
                : conversationSaved
                  ? "Saved to Field Logs"
                  : "Save Conversation as Field Log"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopInlineAudio();
              void stopLiveSession();
              onClose();
            }}
            aria-label="Close Quick Chat"
            className="rounded-lg p-1.5 text-[#64748B] hover:text-[#0F172A] dark:hover:text-white hover:bg-[#E2E8F0]/60 dark:hover:bg-[#292A2A] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {liveStatus && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
          <span>{liveStatus}</span>
          <button
            type="button"
            onClick={() => setLiveStatus(null)}
            className="hover:opacity-80 cursor-pointer"
            aria-label="Dismiss status"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Bounded Scrollable Message Container (never hijacks outer page scroll) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleContainerScroll}
        className="max-h-[380px] overflow-y-auto space-y-2.5 pr-1"
      >
        {messages.map((m) => {
          const isThisLoading = loadingAudioId === m.id;
          const isThisPlaying = playingAudioId === m.id;
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl px-3.5 py-2.5 text-xs leading-5",
                m.role === "user"
                  ? "ml-8 bg-[#0F172A] text-white dark:bg-[#292A2A] dark:text-[#E3E2E2]"
                  : "mr-4 bg-white dark:bg-[#1B1C1C] border border-[#E2E8F0] dark:border-[#292A2A] text-[#0F172A] dark:text-[#E3E2E2]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-70 flex items-center gap-1">
                  {m.role === "assistant" && (
                    <Sparkles className="h-3 w-3 text-emerald-500" />
                  )}
                  {m.role === "user"
                    ? "You"
                    : domain === "agri"
                      ? "Agri Assistant"
                      : "Site-Ops Supervisor"}
                </span>
                {m.role === "assistant" && m.text && (
                  <button
                    type="button"
                    disabled={isThisLoading}
                    onClick={() => void handleListenInline(m)}
                    title={
                      isThisPlaying
                        ? "Stop audio playback"
                        : isOffline
                          ? "Listen with Local TTS (offline)"
                          : "Listen with Natural Cloud Voice (inline)"
                    }
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isThisLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isThisPlaying ? (
                      <VolumeX className="h-3 w-3" />
                    ) : (
                      <Volume2 className="h-3 w-3" />
                    )}
                    <span>
                      {isThisLoading
                        ? "Loading..."
                        : isThisPlaying
                          ? "Stop"
                          : "Listen"}
                    </span>
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap">
                {m.text || (
                  <span className="inline-flex items-center gap-1.5 opacity-65">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking...
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Follow-up Input Bar */}
      <form onSubmit={handleSend}>
        <fieldset
          disabled={sending}
          className="flex items-center gap-2 border-0 p-0 m-0 min-w-0 disabled:opacity-60"
        >
          <button
            type="button"
            disabled={isOffline || sending}
            onClick={toggleDictate}
            title={
              isOffline
                ? "Requires internet connection"
                : listening
                  ? "Stop voice dictation"
                  : "Dictate follow-up question"
            }
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
              listening
                ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300"
                : "border-[#CBD5E1] dark:border-[#343535] bg-white dark:bg-[#1B1C1C] text-[#475569] dark:text-[#C4C7C7]"
            )}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              domain === "agri"
                ? "Ask a follow-up about crops, pests, dosage, or soil..."
                : "Ask a follow-up about concrete, cracks, loads, or safety..."
            }
            className="h-10 flex-1 rounded-xl border border-[#CBD5E1] dark:border-[#343535] bg-white dark:bg-[#0D0E0F] px-3.5 text-xs text-[#0F172A] dark:text-[#E3E2E2] outline-none focus:border-emerald-500 disabled:cursor-not-allowed"
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
            <span>Send</span>
          </button>
        </fieldset>
      </form>
    </div>
  );
}
