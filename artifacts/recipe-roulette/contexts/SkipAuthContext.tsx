// contexts/SkipAuthContext.tsx
// Single source of truth for "continue without account" state, shared
// between app/auth.tsx (which sets it) and app/_layout.tsx's auth gate
// (which reads it to decide navigation).
//
// Why this exists: skipAuth used to be local state in RootLayoutNav,
// loaded once from AsyncStorage on mount. auth.tsx's handleSkip wrote the
// new value straight to AsyncStorage and navigated — but RootLayoutNav
// never re-read storage, so its in-memory skipAuth stayed stale (false).
// The auth gate's effect re-ran on the navigation, saw session=null and
// skipAuth=false (stale), and immediately redirected back to /auth —
// which looked like "no response" on the button. A refresh fixed it only
// because it forced RootLayoutNav to remount and re-read storage fresh.
//
// Routing skipAuth through context fixes this: setSkipAuth updates the
// in-memory value synchronously (so the gate sees the change on its very
// next render, before any navigation-triggered effect reruns) and persists
// it to AsyncStorage in the background for the next app launch.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export const SKIP_AUTH_KEY = "@recipe_roulette_skip_auth";

type SkipAuthContextValue = {
  skipAuth: boolean;
  skipAuthLoaded: boolean;
  setSkipAuth: (value: boolean) => Promise<void>;
};

const SkipAuthContext = createContext<SkipAuthContextValue | undefined>(undefined);

export function SkipAuthProvider({ children }: { children: React.ReactNode }) {
  const [skipAuth, setSkipAuthState] = useState(false);
  const [skipAuthLoaded, setSkipAuthLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SKIP_AUTH_KEY).then((value) => {
      setSkipAuthState(value === "true");
      setSkipAuthLoaded(true);
    });
  }, []);

  const setSkipAuth = async (value: boolean) => {
    // Update in-memory state first (synchronously, before the storage
    // write resolves) so any consumer re-rendering off this context —
    // like the auth gate — sees the new value immediately, well before
    // router.replace's navigation actually completes.
    setSkipAuthState(value);
    try {
      if (value) {
        await AsyncStorage.setItem(SKIP_AUTH_KEY, "true");
      } else {
        await AsyncStorage.removeItem(SKIP_AUTH_KEY);
      }
    } catch (err) {
      // Storage write failed — in-memory state still reflects the
      // intended value for this session, but it won't survive a reload.
      // Let the caller decide whether to surface this to the user.
      throw err;
    }
  };

  return (
    <SkipAuthContext.Provider value={{ skipAuth, skipAuthLoaded, setSkipAuth }}>
      {children}
    </SkipAuthContext.Provider>
  );
}

export function useSkipAuth() {
  const ctx = useContext(SkipAuthContext);
  if (!ctx) {
    throw new Error("useSkipAuth must be used within a SkipAuthProvider");
  }
  return ctx;
}
