// hooks/useSessionStatus.ts
// Read-only session status — no redirect side effects. Used by things
// like the tab bar that need to know "is there a real account" purely to
// change what they render, not to gate navigation (that's useRequireSession).

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export function useSessionStatus() {
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

  // Locked = we've checked and there's definitely no real session (skip-auth
  // mode or nothing at all). Stays false while loading, so the tab bar
  // doesn't flash a lock icon before the check resolves.
  return { locked: checked && !session };
}
