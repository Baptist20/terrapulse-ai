"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PersonaSpeechResult,
  generatePersonaSpeech,
} from "@/lib/ai/hybridEngine";
import {
  FieldDomain,
  InlineMediaInput,
  RemoteConfigValues,
} from "@/types/terrapulse";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface UseFieldVoiceOptions {
  isOffline?: boolean;
  domain?: FieldDomain;
  remoteConfig?: RemoteConfigValues;
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string, autoLoop: boolean) => void;
  onAudioRecorded?: (audio: InlineMediaInput, walkieTalkieLoop: boolean) => void;
  onSilenceDetected?: (message: string) => void;
}

export interface UseFieldVoiceReturn {
  // Local Browser TTS (100% offline-capable fallback)
  isSpeaking: boolean;
  isPaused: boolean;
  ttsSupported: boolean;
  speakResponse: (text: string) => void;
  pauseSpeaking: () => void;
  resumeSpeaking: () => void;
  stopSpeaking: () => void;

  // Natural Cloud Persona TTS (ResponseModality.AUDIO — online-only)
  cloudAudio: (PersonaSpeechResult & { label?: string }) | null;
  cloudAudioLoading: boolean;
  cloudAudioError: string | null;
  speakWithCloudPersona: (
    text: string,
    overrideDomain?: FieldDomain,
    label?: string
  ) => Promise<PersonaSpeechResult | null>;
  clearCloudAudio: () => void;

  // STT (hands-free dictation)
  isListening: boolean;
  sttSupported: boolean;
  interimTranscript: string;
  voiceNotice: string | null;
  clearVoiceNotice: () => void;
  startListening: () => void;
  stopListening: () => void;

  // HTML5 MediaRecorder Audio Capture (for multimodal Gemini audio & Walkie-Talkie — online-only)
  isRecordingAudio: boolean;
  startAudioRecording: (walkieTalkieMode?: boolean) => Promise<void>;
  stopAudioRecording: () => void;

  // Hands-free Conversational Loop
  voiceLoopEnabled: boolean;
  setVoiceLoopEnabled: (enabled: boolean) => void;
}

const OFFLINE_STT_NOTICE =
  "Browser speech-to-text requires signal; type observation or use 1-click field chips while offline.";

function pickPreferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  // Prefer local offline-ready voices first, then natural/Google voices
  return (
    pool.find((v) => v.localService && /natural|google|samantha|aria|david/i.test(v.name)) ??
    pool.find((v) => v.localService) ??
    pool.find((v) => /natural|google/i.test(v.name)) ??
    pool[0] ??
    null
  );
}

export function useFieldVoice(options: UseFieldVoiceOptions = {}): UseFieldVoiceReturn {
  const {
    isOffline = false,
    domain = "agri",
    remoteConfig,
    onInterimTranscript,
    onFinalTranscript,
    onAudioRecorded,
    onSilenceDetected,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceLoopEnabled, setVoiceLoopEnabled] = useState(false);
  const [cloudAudio, setCloudAudio] = useState<
    (PersonaSpeechResult & { label?: string }) | null
  >(null);
  const [cloudAudioLoading, setCloudAudioLoading] = useState(false);
  const [cloudAudioError, setCloudAudioError] = useState<string | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const walkieTalkieModeRef = useRef<boolean>(false);
  const finalBufferRef = useRef<string>("");
  const voiceLoopRef = useRef<boolean>(false);
  const onInterimRef = useRef(onInterimTranscript);
  const onFinalRef = useRef(onFinalTranscript);
  const onAudioRecordedRef = useRef(onAudioRecorded);
  const onSilenceDetectedRef = useRef(onSilenceDetected);

  useEffect(() => {
    voiceLoopRef.current = voiceLoopEnabled;
  }, [voiceLoopEnabled]);

  useEffect(() => {
    onAudioRecordedRef.current = onAudioRecorded;
    onSilenceDetectedRef.current = onSilenceDetected;
  }, [onAudioRecorded, onSilenceDetected]);

  // Revoke any created Blob URL on replacement/unmount
  useEffect(() => {
    return () => {
      if (cloudAudio?.audioUrl) {
        URL.revokeObjectURL(cloudAudio.audioUrl);
      }
    };
  }, [cloudAudio]);

  useEffect(() => {
    onInterimRef.current = onInterimTranscript;
    onFinalRef.current = onFinalTranscript;
  }, [onInterimTranscript, onFinalTranscript]);

  const ttsSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const sttSupported =
    typeof window !== "undefined" &&
    Boolean(
      (window as WindowWithSpeech).SpeechRecognition ||
        (window as WindowWithSpeech).webkitSpeechRecognition
    );

  // Stop speech cleanly on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speakResponse = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const clean = text.trim();
    if (!clean) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const chosen = pickPreferredVoice(voices);
    if (chosen) utterance.voice = chosen;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };
    utterance.onpause = () => setIsPaused(true);
    utterance.onresume = () => setIsPaused(false);
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const pauseSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resumeSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    setVoiceNotice(null);
    if (typeof window === "undefined") return;

    if (isOffline) {
      setVoiceNotice(OFFLINE_STT_NOTICE);
      return;
    }

    const SpeechCtor =
      (window as WindowWithSpeech).SpeechRecognition ||
      (window as WindowWithSpeech).webkitSpeechRecognition;

    if (!SpeechCtor) {
      setVoiceNotice(
        "Speech recognition is not supported in this browser. Type your observation or use Quick Demo."
      );
      return;
    }

    // Pause TTS if currently speaking so mic doesn't capture AI output
    if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    try {
      const recognition = new SpeechCtor();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      finalBufferRef.current = "";

      recognition.onstart = () => {
        setIsListening(true);
        setInterimTranscript("");
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = "";
        let finalized = finalBufferRef.current;

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) {
            finalized = finalized ? `${finalized} ${text.trim()}` : text.trim();
          } else {
            interim += text;
          }
        }

        finalBufferRef.current = finalized;
        const combined = [finalized, interim.trim()].filter(Boolean).join(" ");
        setInterimTranscript(combined);
        onInterimRef.current?.(combined);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setIsListening(false);
        if (event.error === "network" || event.error === "service-not-allowed") {
          setVoiceNotice(OFFLINE_STT_NOTICE);
        } else if (event.error === "not-allowed") {
          setVoiceNotice(
            "Microphone permission denied. Allow mic access or type your field note."
          );
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setVoiceNotice(OFFLINE_STT_NOTICE);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        const committed = finalBufferRef.current.trim();
        setInterimTranscript("");
        if (committed) {
          // Never auto-submit on pause in Voice to Text mode; pass false so user can review/edit and submit manually
          onFinalRef.current?.(committed, false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceNotice(OFFLINE_STT_NOTICE);
    }
  }, [isOffline]);

  const clearVoiceNotice = useCallback(() => setVoiceNotice(null), []);

  const clearCloudAudio = useCallback(() => {
    setCloudAudio(null);
    setCloudAudioError(null);
  }, []);

  const speakWithCloudPersona = useCallback(
    async (
      text: string,
      overrideDomain?: FieldDomain,
      label?: string
    ): Promise<PersonaSpeechResult | null> => {
      if (isOffline) {
        setVoiceNotice("Cloud Voice (Online Only) — reconnect for natural AI voice or use Local TTS.");
        return null;
      }
      if (!text.trim()) return null;

      stopSpeaking();
      setCloudAudioLoading(true);
      setCloudAudioError(null);
      try {
        const res = await generatePersonaSpeech(text, overrideDomain ?? domain, {
          isSimulatedOffline: isOffline,
          remoteConfig,
        });
        if (res) {
          setCloudAudio({ ...res, label });
        }
        return res;
      } catch (err) {
        const msg = formatUserFacingError(err);
        setCloudAudioError(msg);
        setVoiceNotice(msg);
        return null;
      } finally {
        setCloudAudioLoading(false);
      }
    },
    [domain, isOffline, remoteConfig, stopSpeaking]
  );

  const stopAudioRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingAudio(false);
  }, []);

  const startAudioRecording = useCallback(
    async (walkieTalkieMode = false) => {
      if (isOffline) {
        setVoiceNotice("Audio/Video multimodal requires internet.");
        return;
      }
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        setVoiceNotice("Microphone recording is not supported in this browser.");
        return;
      }

      setVoiceNotice(null);
      walkieTalkieModeRef.current = walkieTalkieMode;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Client-side silence detection via Web Audio AnalyserNode (RMS volume sampling)
        let audioCtx: AudioContext | null = null;
        let meterInterval: number | null = null;
        let peakRms = 0;
        let audibleFrames = 0;
        try {
          const AudioCtxCtor =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (AudioCtxCtor) {
            audioCtx = new AudioCtxCtor();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.fftSize);
            meterInterval = window.setInterval(() => {
              analyser.getByteTimeDomainData(dataArray);
              let sumSq = 0;
              for (let i = 0; i < dataArray.length; i += 1) {
                const normalized = (dataArray[i] - 128) / 128;
                sumSq += normalized * normalized;
              }
              const rms = Math.sqrt(sumSq / dataArray.length);
              if (rms > peakRms) peakRms = rms;
              if (rms > 0.015) audibleFrames += 1;
            }, 80);
          }
        } catch {
          // If Web Audio API is blocked, fall back to blob size guard
          peakRms = 1;
          audibleFrames = 10;
        }

        const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/mp4")
              ? "audio/mp4"
              : "";

        const recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);

        audioChunksRef.current = [];
        recorder.ondataavailable = (evt) => {
          if (evt.data && evt.data.size > 0) {
            audioChunksRef.current.push(evt.data);
          }
        };

        recorder.onstop = () => {
          if (meterInterval !== null) {
            window.clearInterval(meterInterval);
          }
          if (audioCtx) {
            audioCtx.close().catch(() => {});
          }
          stream.getTracks().forEach((t) => t.stop());
          const mimeType = (recorder.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          audioChunksRef.current = [];

          const isSilentRecording =
            blob.size < 2500 || (peakRms < 0.018 && audibleFrames < 2);
          if (isSilentRecording) {
            const silenceMsg =
              "Nothing was heard — please try speaking closer to the mic.";
            setVoiceNotice(silenceMsg);
            onSilenceDetectedRef.current?.(silenceMsg);
            return;
          }

          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== "string") return;
            const commaIdx = reader.result.indexOf(",");
            const base64 =
              commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result;
            onAudioRecordedRef.current?.(
              {
                data: base64,
                mimeType,
                sizeBytes: blob.size,
                name: walkieTalkieModeRef.current
                  ? "record-voice-clip.webm"
                  : "field-audio-recording.webm",
              },
              walkieTalkieModeRef.current
            );
          };
          reader.readAsDataURL(blob);
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsRecordingAudio(true);
      } catch (err) {
        console.error("[TerraPulse Internal Error]", err);
        setIsRecordingAudio(false);
        setVoiceNotice("Microphone permission denied or unavailable.");
      }
    },
    [isOffline]
  );

  return {
    isSpeaking,
    isPaused,
    ttsSupported,
    speakResponse,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
    cloudAudio,
    cloudAudioLoading,
    cloudAudioError,
    speakWithCloudPersona,
    clearCloudAudio,
    isListening,
    sttSupported,
    interimTranscript,
    voiceNotice,
    clearVoiceNotice,
    startListening,
    stopListening,
    isRecordingAudio,
    startAudioRecording,
    stopAudioRecording,
    voiceLoopEnabled,
    setVoiceLoopEnabled,
  };
}
