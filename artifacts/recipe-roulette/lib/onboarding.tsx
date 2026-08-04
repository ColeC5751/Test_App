import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

// ─── Onboarding state machine ──────────────────────────────────────────────
//
// Guides a brand-new user through: Spin once → Save that recipe to My
// Dinners → Add it to either the Grocery List or the Plan (either satisfies
// this step). Intentionally local-only (AsyncStorage, not synced to
// Supabase) — this is a per-device "have you seen this" flag, not user data
// worth persisting across devices or surviving a fresh install.
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

export function useOnboarding() {
  // null while the persisted value is still loading, so callers can avoid
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

  return {
    step,
    isOnboarding: step !== null && step !== "complete",
    advance,
    skip,
    copy: step && step !== "complete" ? ONBOARDING_COPY[step] : null,
  };
}
