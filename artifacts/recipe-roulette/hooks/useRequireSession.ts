// hooks/useRequireSession.ts
// Locks a screen behind a real Supabase session — used for features (like
// Shared) that aren't available in "continue without account" mode, even
// though the rest of the app is. Self-contained: fetches its own session
// rather than relying on root layout state, so any screen can use it
// without prop-drilling.
//
// Pass an optional `reason` key to have the auth screen show a contextual
// message (e.g. "Sign in to view shared plans") when the redirect fires.
// See REASON_MESSAGES in app/auth.tsx for the available keys.

import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export function useRequireSession(reason?: string) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setChecked(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (checked && !session) {
      router.replace(
        reason ? (`/auth?reason=${encodeURIComponent(reason)}` as any) : "/auth"
      );
    }
  }, [checked, session]);

  // "locked" = definitely no session, about to redirect — screen should
  // render nothing (or a brief loading state) rather than its real content.
  return { session, loading: !checked, locked: checked && !session };
}
