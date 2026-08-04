// ─── Ingredient-based macro estimation ─────────────────────────────────────
//
// Primary source: USDA FoodData Central (fdc.nal.usda.gov) — a free,
// government-run nutrition database, queried per ingredient. Falls back to
// the small local NUTRITION_DB table below when USDA has no match for an
// ingredient or the request fails (offline, rate-limited, etc.), so this
// never regresses below fully-local behavior.
//
// This only ever runs for recipes with no real nutrition source at all —
// manually-entered, photo-imported, or URL-scraped recipes. Spoonacular
// bookmarks already carry real API-provided macros (see
// handleToggleSaveRecipe in index.tsx) and skip all of this.
//
// Because this now makes network requests, it's async and cached (both
// in-memory for the session and in AsyncStorage across app restarts) —
// see useRecipeMacros() at the bottom, which is what screens should
// actually call. Still an approximation even with USDA data — ingredient
// name matching and unit-to-gram conversion are both heuristic.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { parseIngredientLine, splitIngredientLines, HAS_QUANTITY_SIGNAL } from "./sync";
import type { Macros, PersonalRecipe } from "./types";

// Re-exported so existing `import type { Macros } from "@/lib/macros"`
// call sites keep working — the canonical definition now lives in
// lib/types.ts alongside every other shared data shape.
export type { Macros };

// ─── Local fallback nutrition table (per 100g, edible portion, approximate) ──
//
// Used only when USDA FoodData Central has no match for an ingredient or
// the request fails. `gramsPerUnit` lets a specific ingredient override the
// generic unit conversions below for units that don't behave like a simple
// liquid (e.g. a "cup" of flour is much lighter than a "cup" of olive oil).
// These gramsPerUnit overrides are also reused for USDA-sourced nutrient
// values (see toGrams below) — USDA's search results don't reliably include
// household-unit portion weights, so unit-to-gram conversion stays local
// regardless of where the per-100g nutrient values themselves came from.
// Keys are lowercased unit strings matching KNOWN_UNITS in sync.ts, plus
// the special key "each" for countable/no-unit items ("3 eggs", "2 cloves").

type NutritionEntry = {
  keywords: string[];
  per100g: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  gramsPerUnit?: Record<string, number>;
};

const NUTRITION_DB: NutritionEntry[] = [
  // ── Proteins ──
  { keywords: ["chicken breast", "chicken"], per100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 }, gramsPerUnit: { each: 170 } },
  { keywords: ["ground beef", "ground turkey", "beef"], per100g: { calories: 254, protein: 17, carbs: 0, fat: 20, fiber: 0 } },
  { keywords: ["steak"], per100g: { calories: 271, protein: 25, carbs: 0, fat: 19, fiber: 0 } },
  { keywords: ["salmon"], per100g: { calories: 208, protein: 20, carbs: 0, fat: 13, fiber: 0 }, gramsPerUnit: { each: 170 } },
  { keywords: ["tuna"], per100g: { calories: 132, protein: 28, carbs: 0, fat: 1.3, fiber: 0 } },
  { keywords: ["shrimp"], per100g: { calories: 99, protein: 24, carbs: 0.2, fat: 0.3, fiber: 0 } },
  { keywords: ["cod", "tilapia", "fish"], per100g: { calories: 105, protein: 23, carbs: 0, fat: 1, fiber: 0 } },
  { keywords: ["bacon"], per100g: { calories: 541, protein: 37, carbs: 1.4, fat: 42, fiber: 0 }, gramsPerUnit: { each: 10, slice: 10 } },
  { keywords: ["sausage", "chorizo"], per100g: { calories: 301, protein: 12, carbs: 3, fat: 27, fiber: 0 }, gramsPerUnit: { each: 75 } },
  { keywords: ["ham", "prosciutto"], per100g: { calories: 145, protein: 21, carbs: 1.5, fat: 6, fiber: 0 } },
  { keywords: ["pork"], per100g: { calories: 242, protein: 27, carbs: 0, fat: 14, fiber: 0 } },
  { keywords: ["turkey"], per100g: { calories: 135, protein: 30, carbs: 0, fat: 1, fiber: 0 } },
  { keywords: ["tofu"], per100g: { calories: 76, protein: 8, carbs: 1.9, fat: 4.8, fiber: 0.3 } },
  { keywords: ["egg"], per100g: { calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0 }, gramsPerUnit: { each: 50, "large egg": 50 } },

  // ── Carbs / grains ──
  { keywords: ["white rice", "brown rice", "wild rice", "rice"], per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, gramsPerUnit: { cup: 158 } },
  { keywords: ["pasta", "spaghetti", "penne", "macaroni", "linguine", "fettuccine", "noodles", "ramen", "udon"], per100g: { calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8 }, gramsPerUnit: { cup: 140 } },
  { keywords: ["potato"], per100g: { calories: 77, protein: 2, carbs: 17, fat: 0.1, fiber: 2.2 }, gramsPerUnit: { each: 170 } },
  { keywords: ["sweet potato"], per100g: { calories: 86, protein: 1.6, carbs: 20, fat: 0.1, fiber: 3, }, gramsPerUnit: { each: 130 } },
  { keywords: ["bread", "baguette", "sourdough", "brioche"], per100g: { calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7 }, gramsPerUnit: { slice: 30, each: 30 } },
  { keywords: ["tortilla", "wrap"], per100g: { calories: 218, protein: 6, carbs: 36, fat: 5, fiber: 3 }, gramsPerUnit: { each: 45 } },
  { keywords: ["quinoa"], per100g: { calories: 120, protein: 4.4, carbs: 21, fat: 1.9, fiber: 2.8 }, gramsPerUnit: { cup: 185 } },
  { keywords: ["oats", "oatmeal"], per100g: { calories: 389, protein: 17, carbs: 66, fat: 7, fiber: 10 }, gramsPerUnit: { cup: 80 } },
  { keywords: ["flour"], per100g: { calories: 364, protein: 10, carbs: 76, fat: 1, fiber: 2.7 }, gramsPerUnit: { cup: 120, tbsp: 8 } },

  // ── Vegetables ──
  { keywords: ["broccoli"], per100g: { calories: 34, protein: 2.8, carbs: 7, fat: 0.4, fiber: 2.6 } },
  { keywords: ["spinach"], per100g: { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fiber: 2.2 } },
  { keywords: ["carrot"], per100g: { calories: 41, protein: 0.9, carbs: 10, fat: 0.2, fiber: 2.8 }, gramsPerUnit: { each: 60 } },
  { keywords: ["bell pepper", "pepper"], per100g: { calories: 31, protein: 1, carbs: 6, fat: 0.3, fiber: 2.1 }, gramsPerUnit: { each: 120 } },
  { keywords: ["onion", "scallion"], per100g: { calories: 40, protein: 1.1, carbs: 9, fat: 0.1, fiber: 1.7 }, gramsPerUnit: { each: 110 } },
  { keywords: ["garlic"], per100g: { calories: 149, protein: 6.4, carbs: 33, fat: 0.5, fiber: 2.1 }, gramsPerUnit: { each: 3, clove: 3, cloves: 3 } },
  { keywords: ["tomato"], per100g: { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 }, gramsPerUnit: { each: 120 } },
  { keywords: ["mushroom"], per100g: { calories: 22, protein: 3.1, carbs: 3.3, fat: 0.3, fiber: 1 } },
  { keywords: ["zucchini", "squash", "eggplant"], per100g: { calories: 20, protein: 1.5, carbs: 4, fat: 0.2, fiber: 1.5 } },
  { keywords: ["cucumber"], per100g: { calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1, fiber: 0.5 } },
  { keywords: ["salad greens", "mixed greens", "spring mix", "arugula", "romaine", "lettuce", "cabbage", "kale", "greens"], per100g: { calories: 20, protein: 1.5, carbs: 3.5, fat: 0.3, fiber: 1.8 }, gramsPerUnit: { cup: 30 } },
  { keywords: ["corn"], per100g: { calories: 96, protein: 3.4, carbs: 21, fat: 1.5, fiber: 2.4 } },

  // ── Dairy ──
  { keywords: ["cheddar", "mozzarella", "parmesan", "cheese"], per100g: { calories: 403, protein: 25, carbs: 1.3, fat: 33, fiber: 0 }, gramsPerUnit: { cup: 113 } },
  { keywords: ["milk"], per100g: { calories: 42, protein: 3.4, carbs: 5, fat: 1, fiber: 0 }, gramsPerUnit: { cup: 244 } },
  { keywords: ["butter"], per100g: { calories: 717, protein: 0.9, carbs: 0.1, fat: 81, fiber: 0 }, gramsPerUnit: { tbsp: 14, tsp: 4.7, cup: 227 } },
  { keywords: ["yogurt"], per100g: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4, fiber: 0 } },
  { keywords: ["cream", "half and half"], per100g: { calories: 340, protein: 2.8, carbs: 2.8, fat: 36, fiber: 0 } },
  { keywords: ["sour cream"], per100g: { calories: 198, protein: 2.4, carbs: 4.6, fat: 19, fiber: 0 } },

  // ── Fats / oils ──
  { keywords: ["olive oil", "vegetable oil", "sesame oil", "coconut oil", "oil"], per100g: { calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 }, gramsPerUnit: { tbsp: 13.5, tsp: 4.5, cup: 216 } },
  { keywords: ["mayonnaise"], per100g: { calories: 680, protein: 1, carbs: 0.6, fat: 75, fiber: 0 }, gramsPerUnit: { tbsp: 13.8, tsp: 4.6 } },

  // ── Legumes / nuts ──
  { keywords: ["black beans", "kidney beans", "pinto beans", "cannellini", "chickpeas"], per100g: { calories: 140, protein: 8.5, carbs: 24, fat: 0.7, fiber: 7.5 }, gramsPerUnit: { cup: 170 } },
  { keywords: ["lentils"], per100g: { calories: 116, protein: 9, carbs: 20, fat: 0.4, fiber: 7.9 }, gramsPerUnit: { cup: 198 } },
  { keywords: ["almond", "cashew", "walnut", "pecan", "peanut", "pistachio"], per100g: { calories: 590, protein: 20, carbs: 20, fat: 50, fiber: 9 } },
  { keywords: ["peanut butter"], per100g: { calories: 588, protein: 25, carbs: 20, fat: 50, fiber: 6 }, gramsPerUnit: { tbsp: 16 } },

  // ── Sweeteners / misc ──
  { keywords: ["sugar"], per100g: { calories: 387, protein: 0, carbs: 100, fat: 0, fiber: 0 }, gramsPerUnit: { cup: 200, tbsp: 12.5, tsp: 4.2 } },
  { keywords: ["honey", "maple syrup"], per100g: { calories: 304, protein: 0.3, carbs: 82, fat: 0, fiber: 0.2 }, gramsPerUnit: { tbsp: 21, tsp: 7 } },
];

// Used when no keyword in NUTRITION_DB matches an ingredient name at all
// (e.g. "1 tsp smoked paprika" or an unusual item). Deliberately mid-range
// rather than zero, so an unmatched ingredient doesn't just vanish from the
// total — it's still a rough guess, same caveat as everything else here.
const GENERIC_FALLBACK: NutritionEntry = {
  keywords: [],
  per100g: { calories: 150, protein: 5, carbs: 20, fat: 5, fiber: 2 },
};

// Weight units convert to grams directly. Volume units fall back to a
// water-like density (1g ≈ 1ml) unless the matched ingredient's
// gramsPerUnit overrides that unit specifically (see flour/oil/etc above).
const WEIGHT_TO_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  tsp: 4.92, teaspoon: 4.92, teaspoons: 4.92,
  tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79,
  cup: 236.6, cups: 236.6,
  "fl oz": 29.57, floz: 29.57,
};

function matchNutritionEntry(name: string): NutritionEntry {
  const lower = name.toLowerCase();
  let best: { entry: NutritionEntry; len: number } | null = null;
  for (const entry of NUTRITION_DB) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw) && (!best || kw.length > best.len)) {
        best = { entry, len: kw.length };
      }
    }
  }
  return best?.entry ?? GENERIC_FALLBACK;
}

function toGrams(amount: number, unit: string, entry: NutritionEntry): number {
  const unitLower = unit.toLowerCase().trim();

  if (!unitLower) {
    // No unit at all — a countable item like "3 eggs" or "1 onion".
    const perItem = entry.gramsPerUnit?.each ?? 100;
    return amount * perItem;
  }
  if (unitLower in WEIGHT_TO_GRAMS) {
    return amount * WEIGHT_TO_GRAMS[unitLower];
  }
  if (entry.gramsPerUnit && unitLower in entry.gramsPerUnit) {
    return amount * entry.gramsPerUnit[unitLower];
  }
  if (unitLower in VOLUME_TO_ML) {
    // No ingredient-specific override for this unit — assume water-like
    // density. Reasonable for liquids, rough for dry goods like flour
    // (which is why common dry-good units are overridden above instead).
    return amount * VOLUME_TO_ML[unitLower];
  }
  // Unrecognized unit (e.g. "can", "bunch", "sprig") — fall back to the
  // same whole-item assumption as no-unit items.
  const perItem = entry.gramsPerUnit?.each ?? 100;
  return amount * perItem;
}

// ─── USDA FoodData Central integration ─────────────────────────────────────
//
// Personal free API key (fdc.nal.usda.gov/api-key-signup) — not rate-shared
// with other DEMO_KEY users, so this is fine for real usage.
const USDA_FDC_API_KEY = "bfoO0yWqAOcdRUWF4gPkCcuUxiG9FKMO4K9lkHG3";
const USDA_FDC_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";

type Per100g = { calories: number; protein: number; carbs: number; fat: number; fiber: number };

function extractNutrient(foodNutrients: any[], nutrientName: string, unitName?: string): number {
  const match = foodNutrients.find(
    (n) => n?.nutrientName === nutrientName && (!unitName || n?.unitName === unitName)
  );
  return typeof match?.value === "number" ? match.value : 0;
}

// Ingredient names frequently carry parenthetical asides that are useful
// for a human reading the recipe ("salmon (I usually buy it in one filet
// and cut into pieces)") but actively hurt a full-text search API — extra
// words dilute relevance and can push an irrelevant result to the top.
// Similarly, splitIngredientLines now merges digit-less trailing clauses
// like ", minced" or ", cut into wedges" back onto the previous
// ingredient's raw text (see sync.ts) so they aren't treated as separate
// fake ingredients — but that merged text still isn't useful to feed into
// a nutrition search verbatim, so strip it here too. This is ONLY used
// for nutrition lookup (local match + USDA query); the original name with
// everything intact is still used everywhere else (display, grocery
// list, etc.).
function stripDescriptiveAsides(name: string): string {
  const noParens = name.replace(/\([^)]*\)/g, "").trim();
  // Drop a trailing ", <clause with no quantity signal>" — e.g.
  // "of garlic, minced" -> "of garlic". A clause that DOES contain a
  // digit/fraction is left alone, since it likely carries real
  // information (amount, size, etc.) rather than being pure description.
  const withoutTrailingClause = noParens.replace(
    new RegExp(`,\\s*[^,]*$`),
    (match) => (HAS_QUANTITY_SIGNAL.test(match) ? match : "")
  );
  return withoutTrailingClause.trim() || noParens || name.trim();
}

// Restricted to Foundation + SR Legacy data types: both report nutrients
// per 100g consistently (matching this module's whole architecture).
// Branded-food results get excluded — those report per-serving-as-labeled
// rather than per-100g, and would need a completely different unit-
// handling path to use correctly.
async function fetchUsdaNutrition(
  rawName: string
): Promise<{ status: "found"; data: Per100g; matchedDescription?: string } | { status: "not_found" } | { status: "error" }> {
  const name = stripDescriptiveAsides(rawName);
  try {
    const url =
      `${USDA_FDC_SEARCH_URL}?api_key=${USDA_FDC_API_KEY}` +
      `&query=${encodeURIComponent(name)}&pageSize=5&dataType=Foundation,SR%20Legacy`;
    const res = await fetch(url);
    if (!res.ok) return { status: "error" };

    const data = await res.json();
    const foods: any[] = data?.foods ?? [];
    if (foods.length === 0) return { status: "not_found" };

    // pageSize=1 previously trusted whatever ranked first, with no way to
    // tell a good match from a bad one. Preferring a "raw"/plain result
    // among the top few candidates avoids landing on a prepared dish or
    // an unrelated cut/variant that happens to rank #1 for a noisy query.
    const preferred = foods.find((f) => typeof f?.description === "string" && /\braw\b/i.test(f.description));
    const food = preferred ?? foods[0];

    const nutrients: any[] = food.foodNutrients ?? [];
    return {
      status: "found",
      matchedDescription: food.description,
      data: {
        calories: extractNutrient(nutrients, "Energy", "KCAL"),
        protein: extractNutrient(nutrients, "Protein"),
        carbs: extractNutrient(nutrients, "Carbohydrate, by difference"),
        fat: extractNutrient(nutrients, "Total lipid (fat)"),
        fiber: extractNutrient(nutrients, "Fiber, total dietary"),
      },
    };
  } catch {
    return { status: "error" };
  }
}

// ─── Per-ingredient nutrition cache ─────────────────────────────────────────
//
// Recipe lists render macros for every row, and a single recipe has
// multiple ingredients — without caching, that's a fresh network call per
// ingredient per recipe on every render, which would blow through even a
// generous free-tier limit almost immediately. Cached at the ingredient
// name level (not the recipe level) since common ingredients like "olive
// oil" or "salt" are shared across many recipes.
//
// Two tiers: an in-memory Map for the current session (instant, no
// AsyncStorage round-trip), backed by AsyncStorage so lookups survive app
// restarts too. Nutrition facts don't change, so entries never expire.

const NUTRITION_CACHE_PREFIX = "@nutrition_cache:";
const memoryNutritionCache = new Map<string, Per100g>();

function cacheKeyFor(name: string): string {
  return name.toLowerCase().trim();
}

async function getCachedNutrition(name: string): Promise<Per100g | null> {
  const key = cacheKeyFor(name);
  if (memoryNutritionCache.has(key)) return memoryNutritionCache.get(key)!;
  try {
    const stored = await AsyncStorage.getItem(NUTRITION_CACHE_PREFIX + key);
    if (stored) {
      const parsed = JSON.parse(stored) as Per100g;
      memoryNutritionCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // Corrupt/unreadable cache entry — treat as a miss and re-resolve.
  }
  return null;
}

// Separate from the value cache above, and deliberately NOT reusing
// GENERIC_FALLBACK as a stored value: a cache hit here must still report
// wasResolved: false (it's remembering "USDA doesn't know this either",
// not a real resolution), so callers can keep treating unmatched stray
// text as zero-contribution rather than fabricating mass for it. Without
// this, an ingredient neither the local table nor USDA recognizes would
// hit USDA again on every single lookup.
const NUTRITION_NOTFOUND_PREFIX = "@nutrition_notfound:";
const memoryNotFoundCache = new Set<string>();

async function isCachedNotFound(name: string): Promise<boolean> {
  const key = cacheKeyFor(name);
  if (memoryNotFoundCache.has(key)) return true;
  try {
    const stored = await AsyncStorage.getItem(NUTRITION_NOTFOUND_PREFIX + key);
    if (stored) {
      memoryNotFoundCache.add(key);
      return true;
    }
  } catch {
    // Treat as a miss and re-resolve.
  }
  return false;
}

async function markNotFound(name: string): Promise<void> {
  const key = cacheKeyFor(name);
  memoryNotFoundCache.add(key);
  try {
    await AsyncStorage.setItem(NUTRITION_NOTFOUND_PREFIX + key, "1");
  } catch {
    // Non-fatal — just re-resolves next session instead of persisting.
  }
}

async function setCachedNutrition(name: string, data: Per100g): Promise<void> {
  const key = cacheKeyFor(name);
  memoryNutritionCache.set(key, data);
  try {
    await AsyncStorage.setItem(NUTRITION_CACHE_PREFIX + key, JSON.stringify(data));
  } catch {
    // Non-fatal — just means this ingredient re-resolves next session
    // instead of hitting the persistent cache.
  }
}

// Resolves per-100g nutrition + the local entry (for its gramsPerUnit
// overrides) for one ingredient name: local table → cache → USDA.
//
// Local table is checked FIRST and, if matched, used directly — not as a
// last resort. USDA's full-text search is reliable for specific,
// unambiguous ingredient names ("salmon", "chicken breast"), but poorly
// suited to generic recipe phrasing ("salad greens", "mixed veggies"),
// where it has no way to know it landed on an unrelated composite dish
// rather than the plain ingredient. The local table is deliberately
// curated for exactly the common ingredients where that ambiguity bites,
// so trusting it first avoids that whole failure mode. USDA remains
// valuable for the long tail of ingredients not worth curating by hand.
//
// Deliberately does NOT cache "error" results (network failure, API
// down) — those are worth retrying next time rather than permanently
// locking in a rough guess because of a transient issue.
//
// `wasResolved: false` means NEITHER the local table NOR USDA actually
// recognized this as a food — used by estimateMacrosPerServing to detect
// genuinely-unmatched stray text.
async function resolveIngredientNutrition(
  name: string
): Promise<{ per100g: Per100g; entry: NutritionEntry; wasResolved: boolean; matchedDescription?: string }> {
  const localEntry = matchNutritionEntry(name);
  const localMatched = localEntry !== GENERIC_FALLBACK;

  if (localMatched) {
    return {
      per100g: localEntry.per100g,
      entry: localEntry,
      wasResolved: true,
      matchedDescription: `local table: ${localEntry.keywords[0]}`,
    };
  }

  const cached = await getCachedNutrition(name);
  if (cached) return { per100g: cached, entry: localEntry, wasResolved: true, matchedDescription: "cached USDA match" };

  if (await isCachedNotFound(name)) {
    return { per100g: localEntry.per100g, entry: localEntry, wasResolved: false, matchedDescription: undefined };
  }

  const usda = await fetchUsdaNutrition(name);
  if (usda.status === "found") {
    await setCachedNutrition(name, usda.data);
    return { per100g: usda.data, entry: localEntry, wasResolved: true, matchedDescription: usda.matchedDescription };
  }
  if (usda.status === "not_found") {
    await markNotFound(name);
  }

  return { per100g: localEntry.per100g, entry: localEntry, wasResolved: false, matchedDescription: undefined };
}

/**
 * One ingredient's contribution to a recipe's macro estimate — the data
 * backing the "ingredient breakdown" feature in the recipe detail screen
 * (see IngredientBreakdown in MacroDisplay.tsx). Whole-recipe amounts,
 * NOT divided by servings (estimateMacrosPerServing divides the totals
 * by servings only in its final return value).
 */
export interface IngredientBreakdownItem {
  /** The original recipe text this line came from, e.g. "1-2 pounds salmon (...)" */
  line: string;
  /** Parsed/cleaned ingredient name used for the nutrition lookup */
  name: string;
  /** Where the nutrition data came from — a USDA food description, a
   *  local-table match, or undefined if this line matched nothing */
  matchedDescription?: string;
  /** True if this line couldn't be matched to any real food and
   *  contributes nothing — almost always leftover prep text that
   *  survived comma-splitting (see splitIngredientLines in sync.ts) */
  unresolved: boolean;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/**
 * Estimates PER-SERVING macros for a raw ingredients string, resolving
 * each ingredient's nutrition via USDA FoodData Central (cached, with a
 * local-table fallback) — see resolveIngredientNutrition above.
 *
 * `servings` must be the recipe's own yield (how many servings the full
 * ingredients list produces) — NOT a live "how many do you want to cook"
 * multiplier. Per-serving nutrition is a fixed property of the recipe; it
 * doesn't change when someone scales the batch size up or down (same
 * principle MacroDisplay.tsx's MacroBar already relies on). Callers
 * scaling ingredient amounts for a bigger batch should still pass the
 * recipe's original servings count here, not the scaled target.
 */
export async function estimateMacrosPerServing(
  rawIngredientsText: string,
  servings: number
): Promise<Macros & { ingredientBreakdown: IngredientBreakdownItem[] }> {
  const lines = splitIngredientLines(rawIngredientsText);

  const perIngredientTotals = await Promise.all(
    lines.map(async (line) => {
      const { name, amount, unit, hasExplicitAmount } = parseIngredientLine(line);
      const { per100g, entry, wasResolved, matchedDescription } = await resolveIngredientNutrition(name);

      // Comma-splitting can still leave stray non-ingredient fragments
      // (e.g. "minced", "cut into wedges" — trailing clauses that share a
      // comma with the real ingredient line but aren't food themselves).
      // Those never had a parseable leading quantity (hasExplicitAmount
      // is false) AND don't resolve to anything real, whether from the
      // local table OR USDA (wasResolved is false). That combination is a
      // strong signal this fragment isn't really an ingredient, so it
      // contributes 0g rather than the usual "assume 100g of something"
      // default — which previously fabricated a full ~150 kcal / 20c / 5f
      // "ingredient" out of leftover prep text.
      //
      // Note this deliberately checks wasResolved (local match OR USDA
      // hit), not just the local entry — an ingredient with no leading
      // quantity that ISN'T in the local table but IS found via USDA
      // (e.g. "juice of 1 lemon") is a real ingredient and must still
      // count. A genuine quantity-less ingredient (e.g. "salt to taste")
      // also still has hasExplicitAmount: true from its own line, so this
      // only affects fragments with neither a quantity nor any food match.
      const isStrayFragment = !hasExplicitAmount && !wasResolved;
      const grams = isStrayFragment ? 0 : toGrams(amount, unit, entry);
      const scale = grams / 100;
      const result = {
        calories: per100g.calories * scale,
        protein: per100g.protein * scale,
        carbs: per100g.carbs * scale,
        fat: per100g.fat * scale,
        fiber: per100g.fiber * scale,
      };
      const breakdownItem: IngredientBreakdownItem = {
        line,
        name,
        matchedDescription: isStrayFragment ? undefined : matchedDescription,
        unresolved: isStrayFragment,
        grams,
        ...result,
      };
      return { ...result, breakdownItem };
    })
  );

  const breakdown: IngredientBreakdownItem[] = perIngredientTotals.map((t) => t.breakdownItem);

  const totals = perIngredientTotals.reduce(
    (acc, t) => ({
      calories: acc.calories + t.calories,
      protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs,
      fat: acc.fat + t.fat,
      fiber: acc.fiber + t.fiber,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );

  // Falls back to 4 when passed an invalid/unknown serving count — matching
  // the same default already used elsewhere (index.tsx, plan.tsx) rather
  // than assuming 1. Assuming 1 here previously meant: for any recipe
  // without a real servings value (i.e. every manually-typed,
  // photo-imported, or URL-scraped recipe — only Spoonacular bookmarks
  // ever get servings set), the estimator's *whole-recipe* total got
  // reported as if it were a single serving, inflating calories by
  // roughly however many servings the recipe actually makes.
  const safeServings = servings > 0 ? servings : 4;

  return {
    calories: totals.calories / safeServings,
    protein: totals.protein / safeServings,
    carbs: totals.carbs / safeServings,
    fat: totals.fat / safeServings,
    fiber: totals.fiber / safeServings,
    estimated: true,
    ingredientBreakdown: breakdown,
  };
}

/**
 * React hook: resolves the best available per-serving macros for a
 * personal recipe. Real API-sourced data (bookmarked from a Spoonacular
 * search result — see handleToggleSaveRecipe in index.tsx) resolves
 * synchronously with no loading state; anything else triggers the async
 * USDA-backed estimate above and reports `loading: true` until it
 * resolves. Shared by roulette.tsx (My Dinners) and plan.tsx (Planner) so
 * both screens resolve/display macros the same way.
 *
 * Must be called at a component's top level per the rules of hooks — for
 * a list of recipes, that means each row needs to be its own component
 * (see RecipeListRow in roulette.tsx / PickerRecipeRow in plan.tsx for the
 * pattern), not called inline inside a .map() callback.
 */
export function useRecipeMacros(
  recipe: PersonalRecipe | null
): { macros: (Macros & { ingredientBreakdown?: IngredientBreakdownItem[] }) | null; loading: boolean } {
  const [macros, setMacros] = useState<(Macros & { ingredientBreakdown?: IngredientBreakdownItem[] }) | null>(
    recipe?.macros ?? null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recipe) {
      setMacros(null);
      setLoading(false);
      return;
    }
    if (recipe.macros) {
      setMacros(recipe.macros);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setMacros(null);
    setLoading(true);

    estimateMacrosPerServing(recipe.ingredients, recipe.servings ?? 4).then((result) => {
      if (!cancelled) {
        setMacros(result);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
    // Re-resolve when the recipe's identity, ingredients, servings, or
    // real macros change — not on every render.
  }, [recipe?.id, recipe?.ingredients, recipe?.servings, recipe?.macros]);

  return { macros, loading };
}

/**
 * Scales numeric values in a freeform ingredient string by a multiplier.
 * e.g. "2 tbsp butter, 1 cup milk" × 2 → "4 tbsp butter, 2 cup milk"
 * Handles integers, decimals, and simple fractions (1/2, 3/4 etc.)
 *
 * Consolidated here from what were previously two identical copies (one
 * in roulette.tsx, one in plan.tsx). Not really "macro" logic, but this
 * is the closest existing shared home for ingredient-text utilities —
 * worth a dedicated lib/ingredients.ts if more of these show up.
 */
export function scaleIngredientText(text: string, multiplier: number): string {
  if (multiplier === 1) return text;
  return text.replace(/(\d+\/\d+|\d+\.?\d*)/g, (match) => {
    let val: number;
    if (match.includes("/")) {
      const [num, den] = match.split("/").map(Number);
      val = den ? num / den : 0;
    } else {
      val = parseFloat(match);
    }
    if (isNaN(val)) return match;
    const scaled = val * multiplier;
    const rounded = Math.round(scaled * 100) / 100;
    return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
  });
}
