"use client";

import { useEffect, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

interface PwaSnapshot {
  canInstall: boolean;
  isInstalled: boolean;
  swReady: boolean;
  swRegistered: boolean;
  swError: string | null;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let snapshot: PwaSnapshot = {
  canInstall: false,
  isInstalled: false,
  swReady: false,
  swRegistered: false,
  swError: null,
};

const listeners = new Set<() => void>();

function emitSnapshot(partial: Partial<PwaSnapshot>) {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PwaSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: PwaSnapshot = {
  canInstall: false,
  isInstalled: false,
  swReady: false,
  swRegistered: false,
  swError: null,
};

function getServerSnapshot(): PwaSnapshot {
  return SERVER_SNAPSHOT;
}

export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    emitSnapshot({
      canInstall: false,
      isInstalled: choice.outcome === "accepted",
    });
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

export async function warmPwaAppShell(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "WARM_APP_SHELL" });
    emitSnapshot({ swReady: true, swRegistered: true });
    return true;
  } catch {
    return false;
  }
}

export function usePwaStatus(): PwaSnapshot & {
  promptInstall: typeof promptPwaInstall;
  warmAppShell: typeof warmPwaAppShell;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...state,
    promptInstall: promptPwaInstall,
    warmAppShell: warmPwaAppShell,
  };
}

export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      emitSnapshot({ isInstalled: true });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      emitSnapshot({ canInstall: true });
    };

    const handleAppInstalled = () => {
      deferredPrompt = null;
      emitSnapshot({ canInstall: false, isInstalled: true });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then(() => {
            console.log("[PWA] Service Worker registered at /sw.js");
            emitSnapshot({ swRegistered: true, swError: null });
            return navigator.serviceWorker.ready;
          })
          .then(() => {
            console.log("[PWA] Service Worker ready — App Shell cached for offline use.");
            emitSnapshot({ swReady: true, swRegistered: true, swError: null });
          })
          .catch((err) => {
            console.warn("[PWA] Service Worker registration failed:", err);
            emitSnapshot({
              swRegistered: false,
              swReady: false,
              swError: err instanceof Error ? err.message : "Service Worker registration failed",
            });
          });
      } else {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(registrations.map((reg) => reg.unregister()))
          )
          .then((results) => {
            if (results.some(Boolean)) {
              console.log("[PWA] Unregistered stale Service Worker(s) in development mode.");
            }
            emitSnapshot({ swRegistered: false, swReady: false, swError: null });
          })
          .catch(() => {
            // ignore dev cleanup errors
          });
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  return null;
}
