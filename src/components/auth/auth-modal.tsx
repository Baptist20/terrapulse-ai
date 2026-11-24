"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import {
  AlertCircle,
  CheckCircle2,
  HardHat,
  Loader2,
  MapPin,
  Sprout,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTerraPulse } from "@/context/terrapulse-context";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { formatUserFacingError } from "@/lib/utils/errorMessages";
import { FieldDomain } from "@/types/terrapulse";
import { cn } from "@/lib/utils";

type AuthTab = "demo" | "signin" | "signup";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: AuthTab;
  isLinking?: boolean;
}

export function AuthModal({
  open,
  onClose,
  defaultTab = "demo",
  isLinking = false,
}: AuthModalProps) {
  const router = useRouter();
  const {
    signInAsDemo,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    authError,
    clearAuthError,
  } = useAuth();
  const { setDomain, isOffline } = useTerraPulse();

  const [tab, setTab] = useState<AuthTab>(isLinking ? "signup" : defaultTab);
  const [role, setRole] = useState<FieldDomain>("agri");
  const [locationLabel, setLocationLabel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  if (!open) return null;

  const isDeviceOffline =
    isOffline || (typeof navigator !== "undefined" && !navigator.onLine);

  const handleForgotPassword = async () => {
    clearAuthError();
    setResetError(null);
    setResetSuccess(null);

    if (isDeviceOffline) {
      setResetError("Password reset requires an internet connection.");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setResetError(
        "Enter your email address above first to receive a password reset link."
      );
      return;
    }

    setResetBusy(true);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), trimmedEmail);
      setResetSuccess(
        `Password reset link sent to ${trimmedEmail}. Check your inbox or spam folder.`
      );
    } catch (err) {
      setResetError(formatUserFacingError(err));
    } finally {
      setResetBusy(false);
    }
  };

  const handleRoleChange = (nextRole: FieldDomain) => {
    setRole(nextRole);
  };

  const finishAndNavigate = (targetDomain?: FieldDomain, routeOverride?: string) => {
    if (targetDomain) setDomain(targetDomain);
    onClose();
    if (routeOverride) {
      router.push(routeOverride);
      return;
    }
    if (!isLinking) {
      router.push("/dashboard");
    }
  };

  const handleDemo = async (targetDomain: FieldDomain) => {
    setBusy(true);
    clearAuthError();
    try {
      await signInAsDemo(
        targetDomain,
        targetDomain === "agri" ? "Demo Maize Plot" : "Demo Site Sector 1"
      );
      finishAndNavigate(targetDomain);
    } catch {
      // authError displays in UI
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    clearAuthError();
    try {
      const { needsOnboarding, redirected } = await signInWithGoogle();
      if (redirected) return;
      if (needsOnboarding) {
        finishAndNavigate(undefined, "/onboarding");
      } else {
        finishAndNavigate();
      }
    } catch {
      // authError displays in UI
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    clearAuthError();
    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
        setEmail("");
        setPassword("");
        finishAndNavigate();
      } else {
        const trimmedZone = locationLabel.trim();
        await signUpWithEmail({
          email,
          password,
          displayName:
            displayName.trim() ||
            (role === "agri" ? "Agronomist Operator" : "Site Engineer"),
          defaultDomain: role,
          locationLabel: trimmedZone,
        });
        setEmail("");
        setPassword("");
        finishAndNavigate(role, trimmedZone ? "/dashboard" : "/onboarding");
      }
    } catch {
      // authError displays in UI
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-[#111827] p-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0] dark:border-slate-800">
          <div>
            <h3
              id="auth-modal-title"
              className="text-lg font-bold text-[#0F172A] dark:text-white"
            >
              {isLinking ? "Link Your Field Account" : "Access TerraPulse AI"}
            </h3>
            <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5">
              {isLinking
                ? "Preserve your offline logs by linking Google or Email"
                : "Instant anonymous demo account"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAuthError();
              onClose();
            }}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        {!isLinking && (
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-[#F1F5F9] dark:bg-slate-900 p-1">
            {(
              [
                { key: "demo", label: "Quick Demo" },
                { key: "signin", label: "Sign In" },
                { key: "signup", label: "Sign Up" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  clearAuthError();
                  setResetError(null);
                  setResetSuccess(null);
                  setTab(t.key);
                }}
                className={cn(
                  "h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                  tab === t.key
                    ? "bg-white dark:bg-slate-800 text-[#0F172A] dark:text-white shadow-xs"
                    : "text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {(authError || resetError) && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{resetError || authError}</span>
          </div>
        )}

        {resetSuccess && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
            <span>{resetSuccess}</span>
          </div>
        )}

        {/* TAB 1: QUICK ANONYMOUS DEMO */}
        {tab === "demo" && !isLinking && (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleDemo("agri")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] text-sm font-semibold text-white dark:text-[#090D16] disabled:opacity-50 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 fill-current" />
              )}
              <span>1-Click Anonymous Demo (Recommended)</span>
            </button>

            <div className="my-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#E2E8F0] dark:bg-slate-800" />
              <span className="shrink-0 whitespace-nowrap text-[11px] uppercase tracking-wide text-[#64748B]">
                or pick mode directly
              </span>
              <div className="h-px flex-1 bg-[#E2E8F0] dark:bg-slate-800" />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDemo("agri")}
                className="h-10 rounded-xl border border-[#006600]/40 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs font-semibold text-[#065F46] dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 cursor-pointer"
              >
                Agri-Field Mode
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDemo("construction")}
                className="h-10 rounded-xl border border-[#92400E]/40 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/30 text-xs font-semibold text-[#92400E] dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/60 cursor-pointer"
              >
                Site-Ops Mode
              </button>
            </div>
          </div>
        )}

        {/* TAB 2 & 3: SIGN IN / SIGN UP (with Role Selector & Location Label + Google) */}
        {(tab === "signin" || tab === "signup" || isLinking) && (
          <form onSubmit={handleEmailSubmit} autoComplete="off" className="mt-4">
            <fieldset
              disabled={busy || resetBusy}
              className="flex flex-col gap-3 border-0 p-0 m-0 min-w-0 disabled:opacity-75"
            >
              {/* Google Sign-In / Link */}
              <button
                type="button"
                disabled={busy || resetBusy}
                onClick={handleGoogle}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#CBD5E1] dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-[#0F172A] dark:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
              <span>
                {isLinking ? "Link with Google Account" : "Continue with Google"}
              </span>
            </button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[#E2E8F0] dark:bg-slate-800" />
              <span className="shrink-0 whitespace-nowrap text-[11px] uppercase tracking-wide text-[#64748B]">
                or with email
              </span>
              <div className="h-px flex-1 bg-[#E2E8F0] dark:bg-slate-800" />
            </div>

            {(tab === "signup" || isLinking) && (
              <>
                {/* Integrated Role Selector */}
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#64748B] dark:text-slate-400">
                    Field Role
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleRoleChange("agri")}
                      className={cn(
                        "flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                        role === "agri"
                          ? "border-[#059669] bg-emerald-500/15 text-[#065F46] dark:text-emerald-300"
                          : "border-[#E2E8F0] dark:border-slate-700 text-[#64748B] dark:text-slate-400"
                      )}
                    >
                      <Sprout className="h-3.5 w-3.5" />
                      <span>Agri-Field Farmer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRoleChange("construction")}
                      className={cn(
                        "flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                        role === "construction"
                          ? "border-[#B45309] bg-amber-500/15 text-[#92400E] dark:text-amber-300"
                          : "border-[#E2E8F0] dark:border-slate-700 text-[#64748B] dark:text-slate-400"
                      )}
                    >
                      <HardHat className="h-3.5 w-3.5" />
                      <span>Site-Ops Engineer</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Full Name"
                    className="h-10 rounded-xl border border-[#CBD5E1] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-900 px-3 text-xs text-[#0F172A] dark:text-white outline-none focus:border-[#10B981]"
                  />
                  <div className="relative">
                    <MapPin className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                    <input
                      type="text"
                      value={locationLabel}
                      onChange={(e) => setLocationLabel(e.target.value)}
                      placeholder="Abia State, Zone B"
                      className="h-10 w-full rounded-xl border border-[#CBD5E1] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-900 pl-8 pr-3 text-xs text-[#0F172A] dark:text-white outline-none focus:border-[#10B981]"
                    />
                  </div>
                </div>
              </>
            )}

            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="h-10 rounded-xl border border-[#CBD5E1] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-900 px-3 text-xs text-[#0F172A] dark:text-white outline-none focus:border-[#10B981] disabled:opacity-60 disabled:cursor-not-allowed"
            />

            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min. 6 characters)"
              className="h-10 rounded-xl border border-[#CBD5E1] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-900 px-3 text-xs text-[#0F172A] dark:text-white outline-none focus:border-[#10B981] disabled:opacity-60 disabled:cursor-not-allowed"
            />

            {tab === "signin" && !isLinking && (
              <div className="flex items-center justify-between -mt-1">
                {isDeviceOffline ? (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    Password reset requires an internet connection.
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={resetBusy || busy || isDeviceOffline}
                  onClick={() => void handleForgotPassword()}
                  title={
                    isDeviceOffline
                      ? "Password reset requires an internet connection."
                      : "Send a Firebase password reset link to your email"
                  }
                  className="text-xs font-medium text-[#059669] dark:text-emerald-400 hover:underline disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {resetBusy ? "Sending reset link..." : "Forgot password?"}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || resetBusy}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#006600] hover:bg-[#005200] dark:bg-[#10B981] dark:hover:bg-[#059669] text-sm font-semibold text-white dark:text-[#090D16] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>
                {isLinking
                  ? "Link Email Account"
                  : tab === "signin"
                    ? "Sign In to Workspace"
                    : "Create Field Account"}
              </span>
            </button>
            </fieldset>
          </form>
        )}
      </div>
    </div>
  );
}
