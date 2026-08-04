import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// ─── Onboarding state machine ──────────────────────────────────────────────
//
// Guides a brand-new user through: Spin once → Save that recipe to My
// Dinners → Add it to either the Grocery List or the Plan (either satisfies
// this step). Intentionally local-only (AsyncStorage, not synced to
// Supabase) — this is a per-device "have you seen this" flag, not user data
// worth persisting across devices or surviving a fresh install.
//
// IMPORTANT — this is a Context, not a bare hook. An earlier version made
// this a plain useState-based hook that any component could call directly.
// That broke Skip: _layout.tsx (the banner) and index.tsx (the pulse ring /
// highlighted Save button) each called useOnboarding() independently, which
// gave each of them their own private copy of `step`. Tapping Skip updated
// only the banner's copy — index.tsx's copy never found out until it
// remounted (i.e. on a full reload). Routing everything through one
// Provider means there's exactly one `step` in memory, and every screen
// that reads it re-renders together the instant it changes.
//
// Design choices, and why:
//   - "plan_or_grocery" is a single step satisfied by EITHER action. Forcing
//     a specific one of the two would be arbitrary — both are equally valid
//     "next steps" after saving a recipe, and the user should pick whichever
//     matches their actual intent.
//   - Skippable at any point. A hard-forced flow with no exit risks
//     frustrating a user who opened the app already knowing what they want
//     (e.g. importing a URL recipe immediately). Skipping marks onboarding
//     complete rather than leaving it in limbo, so it never resurfaces.
//   - Steps only advance forward (see advance()) — if a step's hook fires
//     out of order for any reason, we don't move backward or double-fire.

export type OnboardingStep = "spin" | "save" | "plan_or_grocery" | "complete";

const ONBOARDING_KEY = "@thats_dinner_onboarding_step";

const STEP_ORDER: OnboardingStep[] = ["spin", "save", "plan_or_grocery", "complete"];

function stepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

export type OnboardingCopy = {
  bannerTitle: string;
  bannerSubtitle: string;
};

// Centralized copy so the banner text and any per-screen nudges stay in
// sync with whatever step actually gates them.
export const ONBOARDING_COPY: Record<Exclude<OnboardingStep, "complete">, OnboardingCopy> = {
  spin: {
    bannerTitle: "Spin to find your first recipe",
    bannerSubtitle: "Tap SPIN below to get started",
  },
  save: {
    bannerTitle: "Save it to My Dinners",
    bannerSubtitle: "Tap the bookmark so it's easy to find again",
  },
  plan_or_grocery: {
    bannerTitle: "Add it to your plan or grocery list",
    bannerSubtitle: "Either one finishes setup — whichever you'll use first",
  },
};

type OnboardingContextValue = {
  step: OnboardingStep | null;
  isOnboarding: boolean;
  advance: (next: OnboardingStep) => void;
  skip: () => void;
  copy: OnboardingCopy | null;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

// Wrap the app (or at minimum, everything under the tabs layout) in this
// once, at the top. See app/(tabs)/_layout.tsx for where this is mounted —
// it needs to be an ancestor of every screen that reads onboarding state
// (Spin, Grocery, Plan), not just the layout's own overlay.
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  // null while the persisted value is still loading, so consumers can avoid
  // flashing onboarding UI for a returning user before we know their state.
  const [step, setStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_KEY).then((saved) => {
      if (cancelled) return;
      setStep((saved as OnboardingStep | null) ?? "spin");
    }).catch(() => {
      if (!cancelled) setStep("spin");
    });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next: OnboardingStep) => {
    setStep(next);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, next);
    } catch {
      // Local-only, low-stakes — if this fails to persist, worst case the
      // banner reappears next launch. Not worth surfacing an error for.
    }
  }, []);

  // Only moves forward. Prevents a stale hook (e.g. a slow network response
  // from an earlier step) from overwriting further progress made in the
  // meantime.
  const advance = useCallback((next: OnboardingStep) => {
    setStep((current) => {
      if (current === null) return current;
      if (stepIndex(next) <= stepIndex(current)) return current;
      persist(next);
      return current; // persist() will setStep once the write kicks off
    });
  }, [persist]);

  const skip = useCallback(() => {
    persist("complete");
  }, [persist]);

  const value: OnboardingContextValue = {
    step,
    isOnboarding: step !== null && step !== "complete",
    advance,
    skip,
    copy: step && step !== "complete" ? ONBOARDING_COPY[step] : null,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

// Same call signature as before (`const { step, advance, ... } =
// useOnboarding()`), so no changes are needed anywhere this was already
// being called — index.tsx, and the grocery.tsx / plan.tsx hook points from
// ONBOARDING_STEP3_PATCH.md all continue to work unmodified. The only
// change required is wrapping the tree in <OnboardingProvider> once (see
// _layout.tsx).
export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error(
      "useOnboarding() was called outside of <OnboardingProvider>. " +
      "Make sure app/(tabs)/_layout.tsx wraps its content in <OnboardingProvider>."
    );
  }
  return ctx;
}
