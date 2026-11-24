"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

const emptySubscribe = () => () => {};

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const isDark = mounted ? resolvedTheme === "dark" : false;

  const toggle = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    try {
      sessionStorage.setItem("terrapulse_theme_manual", "1");
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to Daylight Field Mode" : "Switch to Telemetry Dark Mode"}
      title={isDark ? "Daylight Field Mode (Light)" : "Telemetry Dark Mode (Dark)"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer",
        "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-xs",
        "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
        compact ? "h-9 w-9 p-0" : "h-9 px-3.5",
        className
      )}
    >
      {isDark ? (
        <>
          <Sun className="h-4 w-4 text-amber-400" />
          {!compact && <span className="hidden sm:inline">Daylight</span>}
        </>
      ) : (
        <>
          <Moon className="h-4 w-4 text-slate-600" />
          {!compact && <span className="hidden sm:inline">Dark</span>}
        </>
      )}
    </button>
  );
}
