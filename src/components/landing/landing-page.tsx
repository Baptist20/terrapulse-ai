"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Play,
  Radio,
  ShieldCheck,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuth } from "@/context/AuthContext";
import { useTerraPulse } from "@/context/terrapulse-context";
import { ensureDeviceModelInitialized } from "@/lib/ai/hybridEngine";
import { FieldDomain } from "@/types/terrapulse";

const PREVIEW_DATA: Record<
  FieldDomain,
  {
    image: string;
    imageAlt: string;
    severity: string;
    engineBadge: string;
    title: string;
    remediation: string;
    cacheLine: string;
    syncLabel: string;
  }
> = {
  agri: {
    image: "/images/agri-field-blight.jpg",
    imageAlt: "Cassava leaf blight inspection in daylight field conditions",
    severity: "SEVERITY: HIGH ALERT",
    engineBadge: "ON-DEVICE NANO",
    title: "Cassava Bacterial Blight — Plot B-4",
    remediation:
      "Remediation: Immediate pruning mandatory. Sever stalks 15cm below lowest lesion. Sterilize shears with 70% alcohol between cuts. Do not compost residue.",
    cacheLine: "Saved to IndexedDB • 0 KB used",
    syncLabel: "SYNC_PENDING",
  },
  construction: {
    image: "/images/site-ops-crack.jpg",
    imageAlt: "Concrete retaining wall diagonal shear fracture inspection",
    severity: "SEVERITY: HIGH ALERT",
    engineBadge: "ON-DEVICE NANO",
    title: "Retaining Wall Shear Fracture — North N2",
    remediation:
      "Remediation: Establish 10m exclusion zone immediately. Clear obstructed weep holes from safe perimeter. Suspend heavy plant vibration above wall crest.",
    cacheLine: "Saved to IndexedDB • 0 KB used",
    syncLabel: "SYNC_PENDING",
  },
};

const AGRI_FEATURES = [
  "Leaf blight & pest photo triage",
  "Soil moisture & pH logging",
  "Offline voice-readout protocols",
  "Weekly fertilizer BOQ synthesis",
];

const SITE_FEATURES = [
  "Concrete crack & spalling audit",
  "Trench & rebar hazard alerts",
  "Hands-free dictation in dead zones",
  "Cloud BOQ & repair diagrams",
];

export function LandingPage() {
  const router = useRouter();
  const { firebaseUser, signInAsDemo } = useAuth();
  const { setDomain } = useTerraPulse();
  const [previewTab, setPreviewTab] = useState<FieldDomain>("agri");
  const [signInOpen, setSignInOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [launching, setLaunching] = useState(false);

  const activePreview = PREVIEW_DATA[previewTab];

  const handleLaunchWorkspace = async (targetDomain?: FieldDomain) => {
    const chosenDomain = targetDomain ?? "agri";
    if (launching) return;
    // Trigger Chrome Prompt API initialization synchronously inside the user click gesture
    void ensureDeviceModelInitialized();
    setLaunching(true);
    try {
      if (!firebaseUser) {
        await signInAsDemo(chosenDomain);
      } else if (targetDomain) {
        setDomain(targetDomain);
      }
      router.push(
        targetDomain ? `/dashboard?domain=${targetDomain}` : "/dashboard"
      );
    } catch {
      setSignInOpen(true);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0F172A] dark:bg-[#090D16] dark:text-slate-100">
      {/* HEADER — STICKY NAVBAR */}
      <header className="sticky top-0 z-40 h-20 w-full bg-white/70 dark:bg-slate-950/75 border-b border-emerald-900/10 dark:border-slate-800 shadow-[0px_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between px-4 sm:px-8 gap-4">
          {/* Brand Lockup */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-[#ECFDF5] dark:bg-emerald-950/60 border border-[#A7F3D0] dark:border-emerald-700/60 shadow-xs">
                <Activity className="h-[18px] w-[18px] text-[#059669] dark:text-[#10B981]" />
              </div>
              <span className="text-lg sm:text-[20px] font-bold tracking-[-0.5px] uppercase text-[#0F172A] dark:text-white">
                TERRAPULSE AI
              </span>
            </Link>

            <div className="hidden md:inline-flex items-center gap-1.5 rounded-xl bg-[#F1F5F9] dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-700 px-2.5 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
              <span className="text-[11px] font-semibold tracking-[0.3px] uppercase text-[#334155] dark:text-slate-300">
                Hybrid Edge AI
              </span>
            </div>
          </div>

          {/* Center Navigation */}
          <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-[#475569] dark:text-slate-400">
            <a
              href="#how-it-works"
              className="hover:text-[#0F172A] dark:hover:text-white transition-colors"
            >
              How It Works
            </a>
            <a
              href="#field-modes"
              className="hover:text-[#0F172A] dark:hover:text-white transition-colors"
            >
              Field Modes
            </a>
            <a
              href="#benchmark-matrix"
              className="hover:text-[#0F172A] dark:hover:text-white transition-colors"
            >
              Edge vs. Cloud Matrix
            </a>
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="hidden sm:inline-flex h-[38px] items-center justify-center rounded-full border border-[#CBD5E1] dark:border-slate-700 bg-white dark:bg-slate-900 px-5 text-sm font-semibold text-[#334155] dark:text-slate-200 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileMenuOpen}
              className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#CBD5E1] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#334155] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Collapsible Nav Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-b border-[#E2E8F0] dark:border-slate-800 bg-white/95 dark:bg-[#090D16]/95 backdrop-blur-md px-4 sm:px-8 py-4 shadow-md">
            <nav className="flex flex-col gap-3 text-sm font-medium text-[#475569] dark:text-slate-300">
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-[#0F172A] dark:hover:text-white transition-colors"
              >
                How It Works
              </a>
              <a
                href="#field-modes"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-[#0F172A] dark:hover:text-white transition-colors"
              >
                Field Modes
              </a>
              <a
                href="#benchmark-matrix"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-[#0F172A] dark:hover:text-white transition-colors"
              >
                Edge vs. Cloud Matrix
              </a>
              <div className="sm:hidden pt-2 border-t border-[#E2E8F0] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setSignInOpen(true);
                  }}
                  className="flex h-10 w-full items-center justify-center rounded-full border border-[#CBD5E1] dark:border-slate-700 bg-white dark:bg-slate-900 px-5 text-sm font-semibold text-[#334155] dark:text-slate-200 cursor-pointer"
                >
                  Sign In
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* SECTION 1: HERO */}
        <section className="w-full bg-gradient-to-br from-emerald-50/80 via-[#fbfdf9] to-amber-50/70 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/30 border-b border-emerald-900/10 dark:border-slate-800/80 pt-10 pb-14 lg:py-16">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
              {/* Left Hero Headline + CTA */}
              <div className="lg:col-span-7 flex flex-col items-start gap-5 pt-1">
                <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-extrabold leading-[1.08] tracking-[-1.4px] text-slate-900 dark:text-white">
                  Offline AI Copilot for Farms &amp; Construction Sites.
                </h1>

                <p className="max-w-[650px] text-base sm:text-[18px] leading-[28px] text-slate-700 dark:text-slate-300">
                  Run sub-2-second multimodal triage directly on-device with Chrome Gemini Nano in
                  zero-connectivity dead zones. Automatically sync logs and escalate to Gemini 3.8
                  Flash cloud audits the moment signal returns.
                </p>

                <div className="pt-1 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    disabled={launching}
                    onClick={() => handleLaunchWorkspace()}
                    className="inline-flex h-[50px] items-center justify-center gap-2.5 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-6 text-base font-semibold text-white dark:text-[#090D16] shadow-md shadow-emerald-900/15 disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {launching ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Initializing Edge Session...</span>
                      </>
                    ) : (
                      <>
                        <span>Launch Instant Demo (No Sign-Up)</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Interactive Live Simulation Console Preview */}
              <div className="lg:col-span-5">
                <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 dark:border-slate-800 bg-white/95 dark:bg-[#111827] p-4 shadow-xl shadow-emerald-950/5 dark:shadow-black/30">
                  {/* Window Chrome Bar */}
                  <div className="flex items-center justify-between pb-2 border-b border-emerald-900/10 dark:border-slate-800">
                    <span className="inline-flex items-center rounded-md border border-[#92400E]/40 dark:border-amber-500/70 bg-amber-50/70 dark:bg-amber-950/40 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#92400E] dark:text-amber-400">
                      OFFLINE GUARD ACTIVE
                    </span>
                    <span className="font-mono text-[11px] font-medium text-[#64748B] dark:text-slate-400">
                      NPU • 1.3s • 0 KB
                    </span>
                  </div>

                  {/* Dashboard Subheader Tabs */}
                  <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] dark:border-slate-800 bg-slate-50/70 dark:bg-[#090D16] p-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewTab("agri")}
                        className={`rounded-lg px-3 py-1 text-xs transition-colors cursor-pointer ${
                          previewTab === "agri"
                            ? "bg-[#006600] dark:bg-[#10B981] font-bold text-white dark:text-[#090D16] shadow-xs"
                            : "font-semibold text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        [ AGRI-FIELD ]
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTab("construction")}
                        className={`rounded-lg px-3 py-1 text-xs transition-colors cursor-pointer ${
                          previewTab === "construction"
                            ? "bg-[#92400E] dark:bg-amber-500 font-bold text-white dark:text-[#090D16] shadow-xs"
                            : "font-semibold text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        [ SITE-OPS ]
                      </button>
                    </div>
                    <span className="hidden sm:inline font-mono text-[11px] text-[#64748B] dark:text-slate-500 pr-1">
                      LIVE PREVIEW
                    </span>
                  </div>

                  {/* Visual Inspection Frame */}
                  <div className="relative h-[176px] w-full overflow-hidden rounded-xl border border-[#E2E8F0] dark:border-slate-800 bg-[#E2E8F0] dark:bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activePreview.image}
                      alt={activePreview.imageAlt}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-2.5 bottom-2.5 inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] dark:border-slate-700 bg-white/95 dark:bg-[#090D16]/95 px-2.5 py-1 shadow-xs">
                      <span className="text-[11px] font-bold uppercase text-[#111010] dark:text-white">
                        {activePreview.severity}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#006600] dark:text-[#10B981]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#006600] dark:bg-[#10B981]" />
                        {activePreview.engineBadge}
                      </span>
                    </div>
                  </div>

                  {/* Triage Output Card */}
                  <div className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#090D16] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[#0F172A] dark:text-slate-100">
                        {activePreview.title}
                      </h3>
                    </div>
                    <p className="text-xs leading-[20px] text-[#475569] dark:text-slate-400">
                      {activePreview.remediation}
                    </p>
                    <div className="pt-1.5">
                      <div className="flex items-center justify-between rounded-[2px] border border-[#E2E8F0] dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111827] px-2.5 py-1.5">
                        <span className="text-xs font-medium text-[#64748B] dark:text-slate-400">
                          {activePreview.cacheLine}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#006600] dark:text-[#10B981]">
                            {activePreview.syncLabel}
                          </span>
                          <span className="flex items-center gap-0.5" aria-hidden="true">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#006600] dark:bg-[#10B981]" />
                            <span className="h-1.5 w-1.5 rounded-full bg-[#006600] dark:bg-[#10B981] opacity-75" />
                            <span className="h-1.5 w-1.5 rounded-full bg-[#006600] dark:bg-[#10B981] opacity-50" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: HOW IT WORKS (3-Step Hybrid Architecture Pipeline) */}
        <section
          id="how-it-works"
          className="w-full bg-[#F8FAFC] dark:bg-[#0C1220] border-b border-[#E2E8F0]/80 dark:border-slate-800 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8 flex flex-col gap-10">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[1.2px] text-[#3B383E] dark:text-emerald-400">
                ARCHITECTED FOR DEAD ZONES
              </span>
              <h2 className="text-2xl sm:text-[30px] font-bold leading-[36px] tracking-[-0.75px] text-black dark:text-white">
                How Hybrid AI Solves the Zero-Connectivity Problem
              </h2>
              <p className="max-w-[768px] text-base leading-6 text-black/80 dark:text-slate-400">
                TerraPulse splits inference across your local device NPU and Firebase Cloud so
                critical safety and crop decisions never stall waiting for a cell tower.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Step 1 */}
              <div className="flex flex-col gap-4 rounded-lg border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#111827] p-6 shadow-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[30px] font-extrabold leading-9 tracking-[-0.75px] text-[#0F172A] dark:text-white">
                    01
                  </span>
                  <span className="inline-flex items-center rounded-xl border border-[#090909] dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.3px] text-[#334155] dark:text-slate-200">
                    0 KB / OFFLINE
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-bold leading-7 text-[#0F172A] dark:text-white">
                    Capture in Dead Zones
                  </h3>
                  <p className="text-sm leading-[23px] text-[#475569] dark:text-slate-400">
                    Farmers and civil site engineers log high-resolution photos, telemetry metrics,
                    and voice-memos into Firestore IndexedDB offline persistent storage.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col gap-4 rounded-lg border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#111827] p-6 shadow-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[30px] font-extrabold leading-9 tracking-[-0.75px] text-[#0F172A] dark:text-white">
                    02
                  </span>
                  <span className="inline-flex items-center rounded-xl border border-[#006600] dark:border-[#10B981] bg-white dark:bg-emerald-950/30 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.3px] text-[#006600] dark:text-[#10B981]">
                    &lt; 2.0S ON-DEVICE
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-bold leading-7 text-[#0F172A] dark:text-white">
                    Instant Edge Triage
                  </h3>
                  <p className="text-sm leading-[23px] text-[#475569] dark:text-slate-400">
                    Chrome built-in Gemini Nano evaluates crop disease, concrete fault lines, or
                    safety infractions directly on hardware NPU. Actionable first-aid
                    recommendations output immediately.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col gap-4 rounded-lg border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#111827] p-6 shadow-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[30px] font-extrabold leading-9 tracking-[-0.75px] text-[#0C0C0D] dark:text-white">
                    03
                  </span>
                  <span className="inline-flex items-center rounded-xl border border-[#92400E] dark:border-amber-500 bg-white dark:bg-amber-950/30 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.3px] text-[#92400E] dark:text-amber-400">
                    SIGNAL RESTORED
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-bold leading-7 text-[#0F172A] dark:text-white">
                    Cloud Multi-Log Audit
                  </h3>
                  <p className="text-sm leading-[23px] text-[#475569] dark:text-slate-400">
                    The moment a 4G or Wi-Fi beacon is caught, queued records sync without conflict.
                    Gemini 3.8 Flash on Cloud Functions compiles full site remediation blueprints
                    and agronomic yield projections.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2B: MULTIMODAL FIELD INPUT MODES */}
        <section className="w-full bg-gradient-to-br from-emerald-50/55 via-[#fbfdf9] to-amber-50/50 dark:from-slate-950 dark:via-slate-900/95 dark:to-emerald-950/20 border-b border-emerald-900/10 dark:border-slate-800/80 py-14 sm:py-16">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8 flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[1.2px] text-[#059669] dark:text-[#10B981]">
                BUILT FOR HANDS-FREE FIELD WORK
              </span>
              <h2 className="text-2xl sm:text-[30px] font-bold leading-[36px] tracking-[-0.75px] text-slate-900 dark:text-white">
                Interact the Way the Job Demands
              </h2>
              <p className="max-w-[672px] text-base leading-6 text-slate-600 dark:text-slate-400">
                Whether wearing heavy work gloves in a trench or inspecting crops in direct
                sunlight, capture issues without fighting tiny forms.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Card 1: Quick Chat */}
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 dark:border-slate-800 bg-white/95 dark:bg-[#111827] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/12 text-[#059669] dark:text-[#10B981]">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <span className="rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#065F46] dark:text-emerald-300">
                    OFFLINE + CLOUD
                  </span>
                </div>
                <h3 className="text-base font-bold leading-6 text-slate-900 dark:text-white">
                  Quick Chat (Multi-Turn Triage)
                </h3>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                  Ask follow-up diagnostic questions in a conversational thread and save to
                  Firestore only when you have an actionable field log.
                </p>
              </div>

              {/* Card 2: Voice-to-Text Dictation */}
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 dark:border-slate-800 bg-white/95 dark:bg-[#111827] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/12 text-[#B45309] dark:text-amber-400">
                    <Mic className="h-4 w-4" />
                  </div>
                  <span className="rounded-full border border-amber-600/25 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#92400E] dark:text-amber-300">
                    HANDS-FREE
                  </span>
                </div>
                <h3 className="text-base font-bold leading-6 text-slate-900 dark:text-white">
                  Voice-to-Text Dictation
                </h3>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                  Speak continuous field observations directly into the log editor—review and edit
                  before submitting with zero premature cutoffs.
                </p>
              </div>

              {/* Card 3: Voice Memo Recording */}
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 dark:border-slate-800 bg-white/95 dark:bg-[#111827] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/12 text-[#059669] dark:text-[#10B981]">
                    <AudioLines className="h-4 w-4" />
                  </div>
                  <span className="rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#065F46] dark:text-emerald-300">
                    CLOUD AUDIO
                  </span>
                </div>
                <h3 className="text-base font-bold leading-6 text-slate-900 dark:text-white">
                  Voice Memo Recording
                </h3>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                  Record spoken site or crop notes on the move; smart silence detection prevents
                  accidental blank logs.
                </p>
              </div>

              {/* Card 4: Instant Live Voice */}
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/10 dark:border-slate-800 bg-white/95 dark:bg-[#111827] p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/12 text-[#B45309] dark:text-amber-400">
                    <Radio className="h-4 w-4" />
                  </div>
                  <span className="rounded-full border border-amber-600/25 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#92400E] dark:text-amber-300">
                    REAL-TIME AUDIO
                  </span>
                </div>
                <h3 className="text-base font-bold leading-6 text-slate-900 dark:text-white">
                  Instant Live Voice
                </h3>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                  Have a natural, two-way spoken conversation with an agronomy instructor or
                  site-ops supervisor persona.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: WORKSPACE MODES (Dual Domain Bento) */}
        <section
          id="field-modes"
          className="w-full bg-white dark:bg-[#090D16] border-b border-[#F1F5F9] dark:border-slate-800/80 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8 flex flex-col gap-10">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[1.2px] text-[#92400E] dark:text-amber-400">
                DOMAIN SPECIFIC EDGE WORKFLOWS
              </span>
              <h2 className="text-2xl sm:text-[30px] font-bold leading-[36px] tracking-[-0.75px] text-black dark:text-white">
                Dual-Domain Intelligence for Harsh Operating Conditions
              </h2>
              <p className="max-w-[672px] text-base leading-6 text-[#475569] dark:text-slate-400">
                Switch between specialized system prompts, structured JSON triage schemas, and
                remediation workflows calibrated for agricultural fields or active civil work sites.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* CARD A: Agri-Field Mode */}
              <div className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111827] p-6 shadow-xs">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="inline-flex items-center rounded-xl border border-[#006600] dark:border-[#10B981] bg-white dark:bg-emerald-950/40 px-3 py-1 text-xs font-bold uppercase tracking-[0.3px] text-[#065F46] dark:text-[#10B981]">
                      AGRI-FIELD MODE
                    </span>
                    <span className="font-mono text-xs font-medium text-[#64748B] dark:text-slate-400">
                      domain: &quot;agri&quot;
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-xl font-bold leading-7 text-[#0F172A] dark:text-white">
                      Precision Agronomy &amp; Crop Health
                    </h3>
                    <p className="text-sm leading-[23px] text-[#475569] dark:text-slate-400">
                      Designed for smallholder farmers, agricultural extension agents, and
                      plantation managers facing persistent connectivity blackouts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {AGRI_FEATURES.map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 rounded border border-[#E2E8F0]/80 dark:border-slate-800 bg-white dark:bg-[#090D16] px-2.5 py-2.5"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#006600] dark:bg-[#10B981]" />
                        <span className="text-xs font-medium text-[#334155] dark:text-slate-300">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="relative h-[176px] w-full overflow-hidden rounded border border-[#E2E8F0] dark:border-slate-800 bg-[#E2E8F0] dark:bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/agri-field-blight.jpg"
                      alt="Precision agronomy leaf inspection snapshot"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-[#E2E8F0] dark:border-slate-700 bg-white/95 dark:bg-[#090D16]/95 px-2 py-1 text-xs font-bold text-[#006600] dark:text-[#10B981] shadow-xs">
                        94% CONFIDENCE
                      </span>
                      <span className="rounded-md border border-[#E2E8F0] dark:border-slate-700 bg-white/95 dark:bg-[#090D16]/95 px-2 py-1 text-xs font-medium text-[#334155] dark:text-slate-300 shadow-xs">
                        1.3s LOCAL
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-8">
                  <button
                    type="button"
                    onClick={() => handleLaunchWorkspace("agri")}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-4 text-sm font-semibold text-white dark:text-[#090D16] shadow-[0px_1px_2px_rgba(5,150,105,0.2)] transition-colors cursor-pointer"
                  >
                    <span>Enter Agri-Field Workspace</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* CARD B: Site-Ops Mode */}
              <div className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111827] p-6 shadow-xs">
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="inline-flex items-center rounded-xl border border-[#92400E] dark:border-amber-500 bg-white dark:bg-amber-950/40 px-3 py-1 text-xs font-bold uppercase tracking-[0.3px] text-[#92400E] dark:text-amber-400">
                      CONSTRUCTION SITE-OPS
                    </span>
                    <span className="font-mono text-xs font-medium text-[#64748B] dark:text-slate-400">
                      domain: &quot;construction&quot;
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-xl font-bold leading-7 text-[#0F172A] dark:text-white">
                      Structural Integrity &amp; Hazard Containment
                    </h3>
                    <p className="text-sm leading-[23px] text-[#475569] dark:text-slate-400">
                      Built for site superintendents, civil structural inspectors, and heavy
                      equipment managers in underground or remote work camps.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SITE_FEATURES.map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 rounded border border-[#E2E8F0]/80 dark:border-slate-800 bg-white dark:bg-[#090D16] px-2.5 py-2.5"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#92400E] dark:bg-amber-400" />
                        <span className="text-xs font-medium text-[#334155] dark:text-slate-300">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="relative h-[176px] w-full overflow-hidden rounded border border-[#E2E8F0] dark:border-slate-800 bg-[#E2E8F0] dark:bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/site-ops-crack.jpg"
                      alt="Concrete retaining wall structural crack inspection"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-[#E2E8F0] dark:border-slate-700 bg-white/95 dark:bg-[#090D16]/95 px-2 py-1 text-xs font-bold text-[#92400E] dark:text-amber-400 shadow-xs">
                        HIGH STRUCTURAL RISK
                      </span>
                      <span className="rounded-md border border-[#E2E8F0] dark:border-slate-700 bg-white/95 dark:bg-[#090D16]/95 px-2 py-1 text-xs font-medium text-[#334155] dark:text-slate-300 shadow-xs">
                        QUEUED FOR AUDIT
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-8">
                  <button
                    type="button"
                    onClick={() => handleLaunchWorkspace("construction")}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded bg-[#92400E] hover:bg-[#78350F] dark:bg-amber-500 dark:hover:bg-amber-400 px-4 text-sm font-semibold text-white dark:text-[#090D16] shadow-xs transition-colors cursor-pointer"
                  >
                    <span>Enter Site-Ops Workspace</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: FIELD TELEMETRY BENCHMARK VISUALIZER */}
        <section
          id="benchmark-matrix"
          className="w-full bg-white dark:bg-[#090D16] border-b border-[#F1F5F9] dark:border-slate-800/80 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8 flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[1.2px] text-[#006600] dark:text-[#10B981]">
                EMPIRICAL TEST BENCH
              </span>
              <h2 className="text-2xl sm:text-[30px] font-bold leading-[36px] tracking-[-0.75px] text-black dark:text-white">
                Edge Triage vs Cloud Escalation Matrix
              </h2>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#E2E8F0] dark:border-slate-800 shadow-xs">
              <table className="w-full min-w-[780px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-slate-800 bg-[#F1F5F9]/80 dark:bg-[#111827]">
                    <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-[0.6px] text-[#475569] dark:text-slate-400">
                      Field Scenario / Observation
                    </th>
                    <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-[0.6px] text-[#475569] dark:text-slate-400">
                      On-Device Nano (&lt;2s)
                    </th>
                    <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-[0.6px] text-[#475569] dark:text-slate-400">
                      Offline Queue / Cloud Escalation
                    </th>
                    <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-[0.6px] text-[#475569] dark:text-slate-400">
                      Operational Impact
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 bg-white dark:bg-[#090D16] text-xs">
                  <tr>
                    <td className="px-4 py-3.5 font-semibold text-[#0F172A] dark:text-slate-100">
                      Retaining Wall Shear Fracture (Site-Ops)
                    </td>
                    <td className="px-4 py-3.5 font-mono font-semibold text-[#006600] dark:text-[#10B981]">
                      Wall Cave-in Risk Class
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="inline-flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#92400E] dark:bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#92400E] dark:bg-amber-400" />
                        </span>
                        <span className="font-medium text-[#0F172A] dark:text-slate-200">
                          Queued in IndexedDB (Hold)
                        </span>
                        <span className="inline-flex items-center gap-0.5 pl-0.5" aria-hidden="true">
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-[#92400E] dark:text-amber-400">
                      Immediate 10m perimeter evacuation order
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3.5 font-semibold text-[#0F172A] dark:text-slate-100">
                      Cassava Leaf Mosaic Blight (Agri-Field)
                    </td>
                    <td className="px-4 py-3.5 font-mono font-semibold text-[#006600] dark:text-[#10B981]">
                      Immediate Prune Protocol
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="inline-flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#92400E] dark:bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#92400E] dark:bg-amber-400" />
                        </span>
                        <span className="font-medium text-[#0F172A] dark:text-slate-200">
                          Queued in IndexedDB (Hold)
                        </span>
                        <span className="inline-flex items-center gap-0.5 pl-0.5" aria-hidden="true">
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                          <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[#475569] dark:text-slate-400">
                      Halts plot-wide bacterial cross-infection
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3.5 font-semibold text-[#0F172A] dark:text-slate-100">
                      Weekly Multi-Zone Sync (4G Restored)
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[#64748B] dark:text-slate-400">
                      Edge Cache Flushed
                    </td>
                    <td className="px-4 py-3.5 font-mono font-semibold text-[#151616] dark:text-[#38BDF8]">
                      Synced in 820ms • Cloud BOQ / Full Report
                    </td>
                    <td className="px-4 py-3.5 font-medium text-[#006600] dark:text-[#10B981]">
                      Consolidated procurement &amp; repair blueprint
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SECTION 6: HIGH-IMPACT FINAL CTA BANNER */}
        <section className="w-full bg-[#F8FAFC] dark:bg-[#0C1220] py-16 sm:py-20">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
            <div className="flex flex-col gap-8 rounded-2xl border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#111827] p-8 sm:p-12 shadow-md">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
                <div className="flex flex-col gap-4 max-w-[672px]">
                  <h2 className="text-3xl sm:text-[36px] font-extrabold leading-[40px] tracking-[-0.9px] text-black dark:text-white">
                    Test Hybrid Edge + Cloud AI in Zero Connectivity Right Now.
                  </h2>
                  <p className="text-base leading-[26px] text-[#475569] dark:text-slate-400">
                    Jump directly into the interactive Field Command Dashboard with pre-loaded
                    agronomy and civil site scenarios, an instant Offline Mode simulator, and
                    voice-readout triage controls.
                  </p>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => handleLaunchWorkspace()}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] px-8 text-sm font-semibold text-white dark:text-[#090D16] shadow-[0px_1px_2px_rgba(5,150,105,0.2)] transition-colors cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Launch Live Demo</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#F1F5F9] dark:border-slate-800 pt-5 text-xs font-mono text-[#64748B] dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span>Firebase AI Logic</span>
                  <span>Gemini Nano (prefer_on_device)</span>
                  <span>Gemini 3.8 Flash (only_in_cloud)</span>
                  <span>Firestore Persistent Local Cache</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[#006600] dark:text-[#10B981] font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Zero Sign-Up Required
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="w-full bg-white dark:bg-[#090D16] border-t border-[#E2E8F0] dark:border-slate-800 py-12">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8 flex flex-col items-center justify-center gap-4 text-center">
          <div className="flex flex-col items-center gap-2 max-w-[384px]">
            <div className="flex items-center gap-2">
              <Activity className="h-[18px] w-[18px] text-[#059669] dark:text-[#10B981]" />
              <span className="text-base font-bold tracking-[-0.4px] uppercase text-[#0F172A] dark:text-white">
                TERRAPULSE AI
              </span>
            </div>
            <p className="text-xs leading-5 text-[#64748B] dark:text-slate-400">
              Offline-first hybrid AI copilot engineered for precision agronomy and civil structural
              field operations.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 border-t border-[#F1F5F9] dark:border-slate-800 pt-3 w-full max-w-[448px] text-xs text-[#64748B] dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#006600] dark:bg-[#10B981]" />
              #BuildHybridAI Hackathon
            </span>
            <span className="text-[#006600] dark:text-[#10B981]">•</span>
            <Link href="/dashboard" className="hover:text-[#0F172A] dark:hover:text-white">
              Field Dashboard
            </Link>
            <span className="text-[#006600] dark:text-[#10B981]">•</span>
            <Link href="/settings" className="hover:text-[#0F172A] dark:hover:text-white">
              Diagnostics
            </Link>
          </div>
        </div>
      </footer>

      {/* AUTH MODAL (1-Click Anonymous Demo, Google & Email Sign-In/Sign-Up with Role Onboarding) */}
      <AuthModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
