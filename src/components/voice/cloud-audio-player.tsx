"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, X } from "lucide-react";
import { FieldDomain } from "@/types/terrapulse";
import { cn } from "@/lib/utils";

interface CloudAudioPlayerProps {
  audioUrl: string;
  voiceName: "Aoede" | "Fenrir";
  domain: FieldDomain;
  label?: string;
  onClose: () => void;
}

const WAVEFORM_BARS = [40, 85, 60, 100, 50, 90, 70, 95, 45, 80, 55, 75];

export function CloudAudioPlayer({
  audioUrl,
  voiceName,
  domain,
  label,
  onClose,
}: CloudAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [audioUrl]);

  const togglePlayback = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 dark:bg-[#16221D] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause Cloud Voice" : "Play Cloud Voice"}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#059669] hover:bg-[#047857] text-white transition-colors cursor-pointer"
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        {/* Animated Waveform Bars */}
        <div
          className="flex items-center gap-0.5 h-6 shrink-0"
          aria-hidden="true"
        >
          {WAVEFORM_BARS.map((heightPct, idx) => (
            <span
              key={idx}
              className={cn(
                "w-1 rounded-full bg-[#10B981] transition-all duration-300",
                playing ? "animate-pulse" : "opacity-45"
              )}
              style={{
                height: playing ? `${heightPct}%` : "30%",
                animationDelay: `${idx * 75}ms`,
              }}
            />
          ))}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5 text-emerald-700 dark:text-[#10B981] shrink-0" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.55px] text-emerald-800 dark:text-[#34D399]">
              {voiceName} •{" "}
              {domain === "agri" ? "Agri Instructor" : "Site Supervisor"}
            </span>
          </div>
          {label && (
            <p className="text-xs text-[#334155] dark:text-[#C4C7C7] truncate">
              {label}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="h-8 max-w-[200px] sm:max-w-[230px]"
        />
        <button
          type="button"
          onClick={() => {
            audioRef.current?.pause();
            onClose();
          }}
          aria-label="Close voice player"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 dark:bg-[#1B1C1C] text-[#475569] dark:text-[#C4C7C7] hover:text-red-500 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
