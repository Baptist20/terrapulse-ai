"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getRedirectResult,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile as updateFirebaseAuthProfile,
} from "firebase/auth";
import {
  Timestamp,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  getFirebaseAuth,
  getFirebaseDb,
  googleAuthProvider,
  initFirebaseAppCheck,
} from "@/lib/firebase/config";
import { FieldDomain, UserProfile } from "@/types/terrapulse";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

interface SignUpParams {
  email: string;
  password: string;
  displayName: string;
  defaultDomain: FieldDomain;
  locationLabel: string;
}

export interface CachedFieldUser {
  uid: string;
  email: string | null;
  displayName: string;
  domain: FieldDomain;
  zone: string;
  locationLabel?: string;
  onboardingCompleted: boolean;
  isAnonymous?: boolean;
}

interface AuthContextValue {
  firebaseUser: User | null;
  cachedUser: CachedFieldUser | null;
  effectiveUid: string | null;
  profile: UserProfile | null;
  loading: boolean;
  needsOnboarding: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInAsDemo: (preferredDomain?: FieldDomain, locationLabel?: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (params: SignUpParams) => Promise<void>;
  signInWithGoogle: (
    preferredDomain?: FieldDomain,
    locationLabel?: string
  ) => Promise<{ needsOnboarding: boolean; redirected?: boolean }>;
  completeOnboarding: (params: {
    domain: FieldDomain;
    zone: string;
    displayName?: string;
  }) => Promise<void>;
  updateUserProfile: (partial: Partial<UserProfile>) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const CACHED_USER_KEY = "terrapulse_cached_user";
const AuthContext = createContext<AuthContextValue | null>(null);

function loadCachedFieldUser(): CachedFieldUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedFieldUser>;
    if (typeof parsed.uid !== "string" || !parsed.uid.trim()) return null;
    const hasValidDomain =
      parsed.domain === "agri" || parsed.domain === "construction";
    const zone = typeof parsed.zone === "string" ? parsed.zone.trim() : "";
    const onboardingCompleted = Boolean(
      parsed.onboardingCompleted === true && hasValidDomain && zone.length > 0
    );
    if (!hasValidDomain) return null;
    return {
      uid: parsed.uid,
      email: typeof parsed.email === "string" ? parsed.email : null,
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName
          : "Field Operator",
      domain: parsed.domain as FieldDomain,
      zone,
      locationLabel: zone,
      onboardingCompleted,
      isAnonymous: Boolean(parsed.isAnonymous),
    };
  } catch {
    return null;
  }
}

function saveCachedFieldUser(profile: UserProfile): CachedFieldUser {
  const domain: FieldDomain =
    profile.domain ?? profile.defaultDomain ?? "agri";
  const zone = (profile.zone ?? profile.locationLabel ?? "").trim();
  const cached: CachedFieldUser = {
    uid: profile.uid,
    email: profile.email ?? null,
    displayName: profile.displayName,
    domain,
    zone,
    locationLabel: zone,
    onboardingCompleted: Boolean(profile.onboardingCompleted && zone),
    isAnonymous: profile.isAnonymous,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(cached));
    } catch {
      // ignore storage quota errors
    }
  }
  return cached;
}

function clearCachedFieldUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    // ignore
  }
}

function profileFromCachedUser(cached: CachedFieldUser): UserProfile {
  return {
    uid: cached.uid,
    displayName: cached.displayName,
    email: cached.email,
    domain: cached.domain,
    defaultDomain: cached.domain,
    zone: cached.zone,
    locationLabel: cached.zone,
    onboardingCompleted: cached.onboardingCompleted,
    isAnonymous: cached.isAnonymous,
    createdAt: Timestamp.now(),
  };
}

function defaultDemoZoneFor(domain: FieldDomain): string {
  return domain === "agri" ? "Demo Maize Plot" : "Demo Site Sector 1";
}

function isProfileComplete(
  data: Partial<UserProfile> | null | undefined
): boolean {
  if (!data) return false;
  const hasValidDomain =
    data.domain === "agri" || data.domain === "construction";
  const hasValidZone =
    typeof data.zone === "string" && data.zone.trim().length > 0;
  return data.onboardingCompleted === true && hasValidDomain && hasValidZone;
}

function buildDemoProfile(
  user: User,
  domain: FieldDomain = "agri",
  zoneOverride?: string
): UserProfile {
  const zone = zoneOverride?.trim() || defaultDemoZoneFor(domain);
  return {
    uid: user.uid,
    displayName:
      user.displayName || (user.isAnonymous ? "Field Operator (Demo)" : "Field Operator"),
    email: user.email ?? null,
    domain,
    defaultDomain: domain,
    zone,
    locationLabel: zone,
    onboardingCompleted: true,
    isAnonymous: user.isAnonymous,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

function formatFirebaseAuthError(err: unknown): string {
  return formatUserFacingError(err);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [cachedUser, setCachedUser] = useState<CachedFieldUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    initFirebaseAppCheck();
    const auth = getFirebaseAuth();
    const db = getFirebaseDb();

    // Hydrate cached offline role/profile immediately so cold-starts offline
    // render the user's exact role without waiting for network fetches.
    const initialCached = loadCachedFieldUser();
    if (initialCached) {
      queueMicrotask(() => {
        setCachedUser(initialCached);
        setProfile((prev) => prev ?? profileFromCachedUser(initialCached));
      });
    }

    let unsubProfile: (() => void) | null = null;
    let isMounted = true;
    let authReadyResolved = false;

    // Handle returning users from a Google signInWithRedirect fallback cleanly
    getRedirectResult(auth)
      .then(async (result) => {
        if (!isMounted || !result?.user) return;
        const user = result.user;
        try {
          const existing = await getDoc(doc(db, "users", user.uid));
          if (existing.exists()) {
            const data = existing.data() as Partial<UserProfile>;
            if (isProfileComplete(data)) {
              await setDoc(
                doc(db, "users", user.uid),
                {
                  email: user.email ?? null,
                  displayName:
                    data.displayName || user.displayName || "Field Operator",
                  isAnonymous: false,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
              router.replace("/dashboard");
              return;
            }
          }
          router.replace("/onboarding");
        } catch (redirectProfileErr) {
          console.error("[Auth] Redirect profile resolution failed:", redirectProfileErr);
          router.replace("/onboarding");
        }
      })
      .catch((redirectErr) => {
        if (!isMounted) return;
        const message = formatFirebaseAuthError(redirectErr);
        setAuthError(message);
      });

    // Wait for Firebase Auth to finish restoring IndexedDB state before allowing route redirects.
    auth
      .authStateReady()
      .then(() => {
        authReadyResolved = true;
      })
      .catch(() => {
        authReadyResolved = true;
      });

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!authReadyResolved) {
        try {
          await auth.authStateReady();
        } catch {
          // ignore offline token refresh errors
        }
        authReadyResolved = true;
      }

      if (!isMounted) return;

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(user);

      if (!user) {
        // Never log out or wipe cached role if we're physically offline with a cached session.
        const latestCached = loadCachedFieldUser();
        const isDeviceOffline =
          typeof navigator !== "undefined" && !navigator.onLine;
        if (isDeviceOffline && latestCached) {
          setCachedUser(latestCached);
          setProfile(profileFromCachedUser(latestCached));
        } else {
          setProfile(null);
        }
        setLoading(false);
        return;
      }

      const latestCached = loadCachedFieldUser();
      const cachedForThisUser =
        latestCached?.uid === user.uid ? latestCached : null;

      const userRef = doc(db, "users", user.uid);

      unsubProfile = onSnapshot(
        userRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as Partial<UserProfile>;
            const resolvedDomain: FieldDomain | undefined =
              data.domain === "construction"
                ? "construction"
                : data.domain === "agri"
                  ? "agri"
                  : undefined;
            const resolvedZone =
              typeof data.zone === "string" ? data.zone.trim() : "";
            const completed =
              data.onboardingCompleted === true &&
              Boolean(resolvedDomain) &&
              resolvedZone.length > 0;

            const resolvedProfile: UserProfile = {
              uid: user.uid,
              displayName:
                data.displayName ||
                user.displayName ||
                (user.isAnonymous ? "Field Operator (Demo)" : "Field Operator"),
              email: data.email ?? user.email ?? null,
              domain: resolvedDomain,
              defaultDomain: resolvedDomain ?? "agri",
              zone: resolvedZone,
              locationLabel: resolvedZone,
              onboardingCompleted: completed,
              isAnonymous: user.isAnonymous,
              createdAt: data.createdAt ?? Timestamp.now(),
              updatedAt: data.updatedAt,
            };
            setProfile(resolvedProfile);
            if (completed) {
              setCachedUser(saveCachedFieldUser(resolvedProfile));
            }
          } else if (user.isAnonymous) {
            const demoProfile = buildDemoProfile(
              user,
              cachedForThisUser?.domain ?? "agri",
              cachedForThisUser?.zone
            );
            setProfile(demoProfile);
            setCachedUser(saveCachedFieldUser(demoProfile));
            setDoc(userRef, demoProfile, { merge: true }).catch(() => {
              // Offline cache handles retry cleanly
            });
          } else if (
            cachedForThisUser &&
            cachedForThisUser.onboardingCompleted &&
            cachedForThisUser.zone.trim()
          ) {
            setProfile(profileFromCachedUser(cachedForThisUser));
          } else {
            // New Google / non-onboarded account: do NOT invent a static zone.
            setProfile(null);
          }
          setLoading(false);
        },
        () => {
          if (cachedForThisUser) {
            setProfile(profileFromCachedUser(cachedForThisUser));
          } else if (user.isAnonymous) {
            const demoProfile = buildDemoProfile(user, "agri");
            setProfile(demoProfile);
            setCachedUser(saveCachedFieldUser(demoProfile));
          } else {
            setProfile(null);
          }
          setLoading(false);
        }
      );
    });

    return () => {
      isMounted = false;
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, [router]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const provisionProfile = useCallback(
    async (
      user: User,
      preferredDomain: FieldDomain = "agri",
      zoneInput?: string,
      displayNameOverride?: string,
      onboardingCompleted = true
    ) => {
      const db = getFirebaseDb();
      const userRef = doc(db, "users", user.uid);
      const trimmedZone = zoneInput?.trim() ?? "";
      const resolvedZone =
        trimmedZone || (user.isAnonymous ? defaultDemoZoneFor(preferredDomain) : "");
      const isComplete = onboardingCompleted && resolvedZone.length > 0;
      const now = Timestamp.now();

      const nextProfile: UserProfile = {
        uid: user.uid,
        displayName:
          displayNameOverride?.trim() ||
          user.displayName ||
          (user.isAnonymous ? "Field Operator (Demo)" : "Field Operator"),
        email: user.email ?? null,
        domain: preferredDomain,
        defaultDomain: preferredDomain,
        zone: resolvedZone,
        locationLabel: resolvedZone,
        onboardingCompleted: isComplete,
        isAnonymous: user.isAnonymous,
        createdAt: now,
        updatedAt: now,
      };
      setProfile(nextProfile);
      if (isComplete) {
        setCachedUser(saveCachedFieldUser(nextProfile));
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setDoc(userRef, nextProfile, { merge: true }).catch(() => {});
        return;
      }
      await setDoc(userRef, nextProfile, { merge: true });
    },
    []
  );

  const completeOnboarding = useCallback(
    async (params: {
      domain: FieldDomain;
      zone: string;
      displayName?: string;
    }) => {
      const trimmedZone = params.zone.trim();
      if (!trimmedZone) {
        throw new Error("Please enter your active farm, site, or field zone name.");
      }

      const auth = getFirebaseAuth();
      const activeUser = firebaseUser ?? auth.currentUser;
      const uid = activeUser?.uid ?? cachedUser?.uid;
      if (!uid) {
        throw new Error("You must be signed in to complete onboarding.");
      }

      const db = getFirebaseDb();
      const userRef = doc(db, "users", uid);
      const now = Timestamp.now();
      const resolvedDisplayName =
        params.displayName?.trim() ||
        activeUser?.displayName ||
        profile?.displayName ||
        cachedUser?.displayName ||
        "Field Operator";

      const completedProfile: UserProfile = {
        uid,
        email: activeUser?.email ?? profile?.email ?? cachedUser?.email ?? null,
        displayName: resolvedDisplayName,
        domain: params.domain,
        defaultDomain: params.domain,
        zone: trimmedZone,
        locationLabel: trimmedZone,
        onboardingCompleted: true,
        isAnonymous: activeUser?.isAnonymous ?? profile?.isAnonymous ?? false,
        createdAt: profile?.createdAt ?? now,
        updatedAt: now,
      };

      setProfile(completedProfile);
      setCachedUser(saveCachedFieldUser(completedProfile));

      const firestorePayload = {
        uid,
        email: completedProfile.email,
        displayName: completedProfile.displayName,
        domain: params.domain,
        defaultDomain: params.domain,
        zone: trimmedZone,
        locationLabel: trimmedZone,
        onboardingCompleted: true,
        isAnonymous: completedProfile.isAnonymous,
        updatedAt: serverTimestamp(),
      };

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setDoc(userRef, firestorePayload, { merge: true }).catch(() => {});
        return;
      }
      await setDoc(userRef, firestorePayload, { merge: true });
    },
    [cachedUser, firebaseUser, profile]
  );

  const signInAsDemo = useCallback(
    async (preferredDomain: FieldDomain = "agri", locationLabel?: string) => {
      setAuthError(null);
      const auth = getFirebaseAuth();
      try {
        if (auth.currentUser) {
          await provisionProfile(
            auth.currentUser,
            preferredDomain,
            locationLabel || defaultDemoZoneFor(preferredDomain),
            undefined,
            true
          );
          return;
        }
        const credential = await signInAnonymously(auth);
        await provisionProfile(
          credential.user,
          preferredDomain,
          locationLabel || defaultDemoZoneFor(preferredDomain),
          undefined,
          true
        );
      } catch (err) {
        const message = formatFirebaseAuthError(err);
        setAuthError(message);
        throw new Error(message);
      }
    },
    [provisionProfile]
  );

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const auth = getFirebaseAuth();
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const message = formatFirebaseAuthError(err);
      setAuthError(message);
      throw new Error(message);
    }
  }, []);

  const signUpWithEmail = useCallback(
    async (params: SignUpParams) => {
      setAuthError(null);
      const auth = getFirebaseAuth();
      try {
        let user: User;
        if (auth.currentUser && auth.currentUser.isAnonymous) {
          const emailCred = EmailAuthProvider.credential(
            params.email.trim(),
            params.password
          );
          const linked = await linkWithCredential(auth.currentUser, emailCred);
          user = linked.user;
        } else {
          const created = await createUserWithEmailAndPassword(
            auth,
            params.email.trim(),
            params.password
          );
          user = created.user;
        }

        if (params.displayName.trim()) {
          await updateFirebaseAuthProfile(user, {
            displayName: params.displayName.trim(),
          });
        }

        const hasZone = params.locationLabel.trim().length > 0;
        await provisionProfile(
          user,
          params.defaultDomain,
          params.locationLabel,
          params.displayName,
          hasZone
        );
      } catch (err) {
        const message = formatFirebaseAuthError(err);
        setAuthError(message);
        throw new Error(message);
      }
    },
    [provisionProfile]
  );

  const signInWithGoogle = useCallback(async (): Promise<{
    needsOnboarding: boolean;
    redirected?: boolean;
  }> => {
    setAuthError(null);
    const auth = getFirebaseAuth();
    const db = getFirebaseDb();

    try {
      let user: User;
      if (auth.currentUser && auth.currentUser.isAnonymous) {
        try {
          const linked = await linkWithPopup(auth.currentUser, googleAuthProvider);
          user = linked.user;
        } catch (linkErr) {
          // If Google account already exists, sign into it cleanly
          if (
            linkErr instanceof Error &&
            linkErr.message.includes("credential-already-in-use")
          ) {
            const signed = await signInWithPopup(auth, googleAuthProvider);
            user = signed.user;
          } else {
            throw linkErr;
          }
        }
      } else {
        const signed = await signInWithPopup(auth, googleAuthProvider);
        user = signed.user;
      }

      const existing = await getDoc(doc(db, "users", user.uid));
      if (existing.exists()) {
        const data = existing.data() as Partial<UserProfile>;
        if (isProfileComplete(data)) {
          await setDoc(
            doc(db, "users", user.uid),
            {
              email: user.email ?? null,
              displayName: data.displayName || user.displayName || "Field Operator",
              isAnonymous: false,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          return { needsOnboarding: false };
        }
      }

      // First-time Google sign-in or incomplete profile: do NOT invent a static zone.
      return { needsOnboarding: true };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (
        code === "auth/popup-blocked" ||
        (err instanceof Error && err.message.includes("auth/popup-blocked"))
      ) {
        if (auth.currentUser && auth.currentUser.isAnonymous) {
          await linkWithRedirect(auth.currentUser, googleAuthProvider);
        } else {
          await signInWithRedirect(auth, googleAuthProvider);
        }
        return { needsOnboarding: false, redirected: true };
      }

      const message = formatFirebaseAuthError(err);
      setAuthError(message);
      throw new Error(message);
    }
  }, []);

  const updateUserProfile = useCallback(
    async (partial: Partial<UserProfile>) => {
      const uid = firebaseUser?.uid ?? cachedUser?.uid;
      if (!uid) return;
      const db = getFirebaseDb();
      const userRef = doc(db, "users", uid);

      const normalizedPartial: Partial<UserProfile> = {
        ...partial,
        updatedAt: Timestamp.now(),
      };
      if (partial.zone !== undefined && partial.locationLabel === undefined) {
        normalizedPartial.locationLabel = partial.zone;
      } else if (
        partial.locationLabel !== undefined &&
        partial.zone === undefined
      ) {
        normalizedPartial.zone = partial.locationLabel;
      }
      if (partial.domain !== undefined && partial.defaultDomain === undefined) {
        normalizedPartial.defaultDomain = partial.domain;
      } else if (
        partial.defaultDomain !== undefined &&
        partial.domain === undefined
      ) {
        normalizedPartial.domain = partial.defaultDomain;
      }

      setProfile((prev) => {
        if (!prev) return prev;
        const merged = { ...prev, ...normalizedPartial };
        if (isProfileComplete(merged)) {
          setCachedUser(saveCachedFieldUser(merged));
        }
        return merged;
      });

      const firestoreUpdate = {
        ...normalizedPartial,
        updatedAt: serverTimestamp(),
      };
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setDoc(userRef, firestoreUpdate, { merge: true }).catch(() => {});
        return;
      }
      await setDoc(userRef, firestoreUpdate, { merge: true });
    },
    [cachedUser?.uid, firebaseUser]
  );

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    clearCachedFieldUser();
    setCachedUser(null);
    setProfile(null);
    const auth = getFirebaseAuth();
    await signOut(auth);
  }, []);

  const effectiveUid = firebaseUser?.uid ?? cachedUser?.uid ?? null;
  const needsOnboarding = Boolean(
    effectiveUid && !loading && !isProfileComplete(profile)
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        cachedUser,
        effectiveUid,
        profile,
        loading,
        needsOnboarding,
        authError,
        clearAuthError,
        signInAsDemo,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        completeOnboarding,
        updateUserProfile,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
