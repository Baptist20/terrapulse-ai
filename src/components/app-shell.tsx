"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  Download,
  FileBarChart2,
  FileText,
  Home,
  LayoutDashboard,
  Loader2,
  Settings,
  User,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePwaStatus } from "@/components/PwaRegistrar";
import { useAuth } from "@/context/AuthContext";
import { useTerraPulse } from "@/context/terrapulse-context";
import { cn } from "@/lib/utils";

interface AppShellProps {
  title: string;
  breadcrumbs?: string[];
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard#field-logs", label: "Field Logs", icon: FileText },
  { href: "/synthesis", label: "Synthesis", icon: FileBarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/", label: "Overview", icon: Home },
];

export function AppShell({ title, breadcrumbs, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const {
    firebaseUser,
    cachedUser,
    profile,
    loading: authLoading,
    needsOnboarding,
  } = useAuth();
  const { canInstall, promptInstall } = usePwaStatus();
  const hasActiveSession = Boolean(firebaseUser || cachedUser);
  const isProfileIncomplete =
    needsOnboarding ||
    !profile ||
    (profile.domain !== "agri" && profile.domain !== "construction") ||
    !profile.zone ||
    profile.zone.trim() === "";
  const {
    isOffline,
    browserOffline,
    simulateOffline,
    setSimulateOffline,
    checkConnectivityNow,
    logs,
    user,
  } = useTerraPulse();

  // Default inside App Shell to Telemetry Dark Mode unless user manually toggled
  useEffect(() => {
    try {
      const manual = sessionStorage.getItem("terrapulse_theme_manual");
      if (!manual) {
        setTheme("dark");
      }
    } catch {
      // ignore
    }
  }, [setTheme]);

  // Protect App Shell routes: wait for authStateReady / onAuthStateChanged before redirecting.
  // Never redirect an authenticated/cached user away while offline.
  useEffect(() => {
    if (authLoading) return;
    if (!hasActiveSession) {
      router.replace("/");
      return;
    }
    if (isProfileIncomplete) {
      router.replace("/onboarding");
    }
  }, [authLoading, hasActiveSession, isProfileIncomplete, router]);

  if (authLoading || !hasActiveSession || isProfileIncomplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#121414] text-[#0F172A] dark:text-[#E3E2E2]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-[#10B981]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[#64748B] dark:text-[#C4C7C7]">
            {authLoading
              ? "Restoring Field Session..."
              : isProfileIncomplete
                ? "Opening Role & Zone Setup..."
                : "Redirecting to TerraPulse Sign In..."}
          </span>
        </div>
      </div>
    );
  }

  const activeZoneTag = profile.zone?.trim().toUpperCase() ?? "";
  const avgLatencySec = (() => {
    const latencies = logs
      .map((l) => l.localTriage?.latencyMs)
      .filter((v): v is number => typeof v === "number");
    if (latencies.length === 0) return "1.2s";
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    return `${(avg / 1000).toFixed(1)}s`;
  })();

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A] dark:bg-[#121414] dark:text-[#E3E2E2]">
      {/* Persistent Left Sidebar (288px) */}
      <aside className="hidden lg:flex lg:w-[288px] lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 z-30 border-r border-[#E2E8F0] dark:border-[#292A2A]/70 bg-white dark:bg-[#1B1C1C] px-3 py-4 justify-between">
        <div className="flex flex-col gap-8">
          {/* Brand Lockup */}
          <div className="flex flex-col gap-1.5 px-2">
            <Link href="/" className="flex items-center gap-2.5 h-8 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-[2px] bg-[#ECFDF5] dark:bg-[#343535] border border-[#A7F3D0] dark:border-transparent">
                <Activity className="h-[18px] w-[18px] text-[#059669] dark:text-[#C7C6C6]" />
              </div>
              <span className="font-display text-[20px] font-semibold leading-7 tracking-[-0.5px] uppercase text-[#0F172A] dark:text-[#E3E2E2]">
                TERRAPULSE
              </span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C7C6C6]">
                AI
              </span>
            </Link>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#64748B] dark:text-[#C4C7C7] pt-1">
              TACTICAL FIELD OS
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 px-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isDashboardLink = item.href === "/dashboard";
              const isLogsAnchor = item.href === "/dashboard#field-logs";
              const active = isDashboardLink
                ? pathname === "/dashboard"
                : isLogsAnchor
                  ? pathname.startsWith("/logs")
                  : pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 h-10 px-2 rounded-lg text-[15px] font-semibold transition-colors",
                    active
                      ? "bg-[#F1F5F9] text-[#0F172A] dark:bg-[#292A2A] dark:text-[#E3E2E2]"
                      : "text-[#475569] hover:bg-slate-100 dark:text-[#C4C7C7] dark:hover:bg-[#242525]"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-85" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Local NPU Latency Readout */}
        <div className="px-1">
          <div className="rounded-xl bg-[#F1F5F9] dark:bg-[#1F2020] border border-[#E2E8F0] dark:border-transparent px-3 py-2 flex items-baseline justify-between">
            <span className="font-mono text-[22px] font-bold leading-7 text-[#0F172A] dark:text-[#E3E2E2]">
              {avgLatencySec}
            </span>
            <span className="font-mono text-[13px] font-medium text-[#64748B] dark:text-[#C4C7C7]">
              NPU
            </span>
          </div>
        </div>
      </aside>

      {/* Main Column offset by 288px on lg+ */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[288px]">
        {/* Fixed Top Header + Mobile Nav Wrapper (stays fixed on scroll across all screen sizes) */}
        <div className="fixed top-0 left-0 right-0 lg:left-[288px] z-30">
          {/* Top Header Bar (64px) */}
          <header className="h-16 w-full bg-white/90 dark:bg-[#121414]/90 border-b border-[#E2E8F0] dark:border-[#1F2020] shadow-[0px_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/"
                className="lg:hidden flex h-8 w-8 items-center justify-center rounded-[2px] bg-[#ECFDF5] dark:bg-[#343535]"
              >
                <Activity className="h-4 w-4 text-[#059669] dark:text-[#C7C6C6]" />
              </Link>
              {breadcrumbs && breadcrumbs.length > 0 ? (
                <nav
                  aria-label="Breadcrumb"
                  className="flex items-center gap-1.5 font-mono text-[13px] font-medium truncate"
                >
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <React.Fragment key={crumb + idx}>
                        {idx > 0 && (
                          <span className="text-[#94A3B8] dark:text-[#444748]">
                            /
                          </span>
                        )}
                        <span
                          className={cn(
                            "truncate",
                            isLast
                              ? "text-[#0F172A] dark:text-[#E3E2E2]"
                              : "text-[#64748B] dark:text-[#C4C7C7]"
                          )}
                        >
                          {crumb}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </nav>
              ) : (
                <h1 className="font-display text-lg sm:text-[20px] font-semibold leading-7 tracking-[-0.5px] uppercase text-[#0F172A] dark:text-[#E3E2E2] truncate">
                  {title}
                </h1>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Global Online/Offline Indicator & Switcher Pill */}
              <div
                title={
                  browserOffline
                    ? "Device disconnected — automatically switches back to ONLINE when signal returns"
                    : simulateOffline
                      ? "Simulated Offline Mode active — click switch to go back ONLINE"
                      : "Connected — automatically switches to OFFLINE if signal drops"
                }
                className="flex items-center gap-2 sm:gap-3 rounded-full bg-[#F1F5F9] dark:bg-[#1B1C1C] px-2.5 sm:px-3 h-8"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isOffline ? "bg-[#F59E0B]" : "bg-[#10B981]"
                    )}
                  />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#0F172A] dark:text-[#E3E2E2]">
                    {isOffline ? "OFFLINE" : "ONLINE"}
                  </span>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={!isOffline}
                  aria-label={
                    browserOffline
                      ? "Device is physically offline — check connection"
                      : "Toggle Simulated Offline Mode"
                  }
                  onClick={() => {
                    if (browserOffline) {
                      void checkConnectivityNow();
                    } else {
                      setSimulateOffline(!simulateOffline);
                    }
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 sm:w-10 items-center rounded-full bg-[#CBD5E1] dark:bg-[#464747] transition-colors cursor-pointer",
                    browserOffline && "opacity-75"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-[#0F172A] dark:bg-[#C7C6C6] transition-transform",
                      isOffline
                        ? "translate-x-1"
                        : "translate-x-4 sm:translate-x-5"
                    )}
                  />
                </button>

                <span className="hidden md:inline font-mono text-[12px] font-medium uppercase text-[#64748B] dark:text-[#C4C7C7]">
                  {isOffline ? "EDGE NANO" : "HYBRID AI"}
                </span>
              </div>

              {/* One-Click PWA Install Button (shown when browser beforeinstallprompt is available) */}
              {canInstall && (
                <button
                  type="button"
                  onClick={() => void promptInstall()}
                  title="Install TerraPulse AI for offline field use"
                  className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 font-mono text-[11px] font-semibold uppercase tracking-[0.45px] text-emerald-800 dark:text-[#34D399] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Install App</span>
                </button>
              )}

              {/* Active Zone Chip (live-bound to AuthContext profile.zone) */}
              {activeZoneTag && (
                <div className="hidden sm:flex items-center rounded-full bg-[#F1F5F9] dark:bg-[#1B1C1C] px-2.5 py-1 max-w-[200px]">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.55px] text-[#475569] dark:text-[#C4C7C7] truncate">
                    {activeZoneTag}
                  </span>
                </div>
              )}

              <ThemeToggle
                compact
                className="h-8 w-8 rounded-full border-[#E2E8F0] dark:border-[#343535] dark:bg-[#1B1C1C]"
              />

              {/* Operator Avatar Circle */}
              <Link
                href="/settings"
                title={user.displayName}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F172A] dark:bg-[#C7C6C6] text-white dark:text-[#303031] hover:opacity-90 transition-opacity"
              >
                <User className="h-3.5 w-3.5" />
              </Link>
            </div>
          </header>

          {/* Mobile Navigation Strip (44px height — fixed together with header on scroll) */}
          <div className="lg:hidden h-11 flex items-center overflow-x-auto border-b border-[#E2E8F0] dark:border-[#1F2020] bg-white/95 dark:bg-[#1B1C1C]/95 backdrop-blur-md px-3 gap-1">
            {NAV_ITEMS.map((item) => {
              const isDashboardLink = item.href === "/dashboard";
              const isLogsAnchor = item.href === "/dashboard#field-logs";
              const active = isDashboardLink
                ? pathname === "/dashboard"
                : isLogsAnchor
                  ? pathname.startsWith("/logs")
                  : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap",
                    active
                      ? "bg-[#F1F5F9] text-[#0F172A] dark:bg-[#343535] dark:text-[#E3E2E2]"
                      : "text-[#475569] dark:text-[#C4C7C7]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Workspace Container (offset by fixed top bar height: 108px mobile, 64px desktop) */}
        <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 pt-[120px] lg:pt-[80px] pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
