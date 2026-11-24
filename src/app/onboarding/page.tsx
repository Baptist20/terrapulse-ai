"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sprout,
  HardHat,
  MapPin,
  Radio,
  ArrowRight,
  Loader2,
  ShieldCheck,
  LogOut,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatUserFacingError } from "@/lib/utils/errorMessages";
import type { FieldDomain } from "@/types/terrapulse";

export default function OnboardingPage() {
  const router = useRouter();
  const {
    firebaseUser,
    cachedUser,
    profile,
    loading,
    needsOnboarding,
    completeOnboarding,
    signOutUser,
  } = useAuth();

  const [selectedDomain, setSelectedDomain] = useState<FieldDomain | null>(null);
  const [zone, setZone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasSession = Boolean(firebaseUser || cachedUser);

  // Pre-fill displayName from Google / Firebase Auth once available
  useEffect(() => {
    const initialName =
      firebaseUser?.displayName || profile?.displayName || cachedUser?.displayName || "";
    if (initialName && !displayName) {
      queueMicrotask(() => setDisplayName(initialName));
    }
  }, [cachedUser?.displayName, displayName, firebaseUser?.displayName, profile?.displayName]);

  // Redirect unauthenticated users to "/" and already-onboarded users to "/dashboard"
  useEffect(() => {
    if (loading) return;
    if (!hasSession) {
      router.replace("/");
      return;
    }
    if (!needsOnboarding) {
      router.replace("/dashboard");
    }
  }, [hasSession, loading, needsOnboarding, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedDomain) {
      setErrorMsg("Please select your operational role (Agri-Field or Site-Ops).");
      return;
    }
    if (!zone.trim()) {
      setErrorMsg("Please enter your active farm, plot, or construction site zone.");
      return;
    }

    setSubmitting(true);
    try {
      await completeOnboarding({
        domain: selectedDomain,
        zone: zone.trim(),
        displayName: displayName.trim() || undefined,
      });
      router.replace("/dashboard");
    } catch (err) {
      setErrorMsg(formatUserFacingError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    await signOutUser();
    router.replace("/");
  };

  if (loading || !hasSession || !needsOnboarding) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
          <p className="text-sm text-[var(--text-secondary)]">
            Preparing your TerraPulse AI workspace…
          </p>
        </div>
      </div>
    );
  }

  const accountEmail =
    firebaseUser?.email || profile?.email || cachedUser?.email || null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col justify-between p-4 sm:p-6">
      {/* Top Bar */}
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold tracking-tight text-sm block leading-none">
              TerraPulse AI
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              Field Profile Setup
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSwitchAccount}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </header>

      {/* Main Onboarding Card */}
      <main className="max-w-2xl w-full mx-auto my-8">
        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xl p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 text-[11px] font-semibold uppercase tracking-wider mb-3">
                <ShieldCheck className="w-3.5 h-3.5" />
                Mandatory Workspace Setup
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Configure Your Field Profile
              </h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1.5">
                Choose your operational discipline and active field zone. Your dashboard, AI prompts, and logs will be scoped exclusively to this role.
              </p>
            </div>
          </div>

          {accountEmail && (
            <div className="mb-6 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
              <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>
                Signed in as{" "}
                <strong className="text-[var(--text-primary)]">{accountEmail}</strong>
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <fieldset
              disabled={submitting}
              className="space-y-6 border-0 p-0 m-0 min-w-0 disabled:opacity-75"
            >
            {/* Step 1: Operational Role */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
                1. Operational Role <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDomain("agri");
                    setErrorMsg(null);
                  }}
                  className={`text-left p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedDomain === "agri"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-500/10"
                      : "border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 hover:border-emerald-500/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                      <Sprout className="w-5 h-5" />
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        selectedDomain === "agri"
                          ? "bg-emerald-500 text-white"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                      }`}
                    >
                      {selectedDomain === "agri" ? "Selected" : "Agronomy"}
                    </span>
                  </div>
                  <div className="font-bold text-base">Agri-Field</div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    Crop disease triage, pest scouting, soil &amp; irrigation audits, and farm zone synthesis.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedDomain("construction");
                    setErrorMsg(null);
                  }}
                  className={`text-left p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                    selectedDomain === "construction"
                      ? "border-amber-500 bg-amber-500/10 shadow-md shadow-amber-500/10"
                      : "border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 hover:border-amber-500/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                      <HardHat className="w-5 h-5" />
                    </div>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        selectedDomain === "construction"
                          ? "bg-amber-500 text-slate-950"
                          : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                      }`}
                    >
                      {selectedDomain === "construction" ? "Selected" : "Engineering"}
                    </span>
                  </div>
                  <div className="font-bold text-base">Site-Ops</div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    Structural defect inspections, OSHA hazard triage, concrete &amp; foundation audits.
                  </p>
                </button>
              </div>
            </div>

            {/* Step 2: Active Zone / Farm / Site Name */}
            <div>
              <label
                htmlFor="onboarding-zone"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
              >
                2. Active Zone / Farm / Site Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="onboarding-zone"
                  type="text"
                  required
                  value={zone}
                  onChange={(e) => {
                    setZone(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder={
                    selectedDomain === "construction"
                      ? "e.g. Sector 4 Foundation, Bridge Pier North"
                      : "e.g. Block C Maize Plot, North Valley Orchard"
                  }
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">
                Saved directly to your Firestore profile and synced offline. You can update your zone later in Settings.
              </p>
            </div>

            {/* Optional Operator Name */}
            <div>
              <label
                htmlFor="onboarding-name"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
              >
                Operator Display Name
              </label>
              <input
                id="onboarding-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name or callsign"
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>

            {errorMsg && (
              <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-medium">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !selectedDomain || !zone.trim()}
              className={`w-full py-3.5 px-5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                selectedDomain === "construction"
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
                  : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving Field Profile…
                </>
              ) : (
                <>
                  Enter{" "}
                  {selectedDomain === "construction"
                    ? "Site-Ops"
                    : selectedDomain === "agri"
                      ? "Agri-Field"
                      : "TerraPulse"}{" "}
                  Workspace
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            </fieldset>
          </form>
        </div>
      </main>

      <footer className="max-w-2xl w-full mx-auto text-center text-[11px] text-[var(--text-secondary)] pb-2">
        Offline-First Hybrid AI • Your assigned role and zone are cached locally for zero-signal field deployments.
      </footer>
    </div>
  );
}
