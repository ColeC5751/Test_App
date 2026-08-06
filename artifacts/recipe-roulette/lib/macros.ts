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
import { parseIngredientLine, splitIngredientLines } from "./sync";
import {
  matchNutritionEntry,
  GENERIC_FALLBACK,
  HAS_QUANTITY_SIGNAL,
  type NutritionEntry,
  type Per100g,
} from "./ingredientMatch";
import type { Macros, PersonalRecipe } from "./types";

// Re-exported so existing `import type { Macros } from "@/lib/macros"`
// call sites keep working — the canonical definition now lives in
// lib/types.ts alongside every other shared data shape.
export type { Macros };

// NUTRITION_DB, GENERIC_FALLBACK, and matchNutritionEntry now live in
// ./ingredientMatch — sync.ts needs them too (to recognize real
// quantity-less ingredients like "homemade mayonnaise" when deciding what
// belongs in the grocery list), and having macros.ts and sync.ts import
// from each other directly would be a circular dependency. See
// ingredientMatch.ts for the full local table and its docs.

// Weight units convert to grams directly. Volume units fall back to a
// water-like density (1g ≈ 1ml) unless the matched ingredient's
// gramsPerUnit overrides that unit specifically (see flour/oil/etc in
// ingredientMatch.ts).
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

// ─── Non-food fragment filtering ────────────────────────────────────────────
//
// Comma-splitting in sync.ts can leave prep-instruction fragments that
// share a comma with a real ingredient but aren't food themselves — e.g.
// "2 cloves garlic, minced" -> "2 cloves garlic" + "minced". Previously
// these were only caught AFTER a USDA round-trip, by checking whether
// USDA happened to return nothing (wasResolved: false). That's not
// reliable: USDA's full-text search often returns *something* for a bare
// prep word or instruction (e.g. "minced" can match an unrelated branded
// product, "divided" can match a random SR Legacy entry), so `wasResolved`
// comes back true for text that was never actually food, and that false
// macro value then gets fed into the recipe's totals AND cached under this
// fragment's name for every future lookup.
//
// KNOWN_BAD_FRAGMENTS lists exactly that kind of text — pure prep/
// instruction language with no nutritional content of its own — so it can
// be rejected before ever reaching USDA, rather than trusting whatever
// USDA's ranker returns for it. Exported so it doubles as the fixture list
// for a "does the filter still catch these" unit test.
export const KNOWN_BAD_FRAGMENTS: readonly string[] = [
  "minced",
  "chopped",
  "finely chopped",
  "roughly chopped",
  "diced",
  "finely diced",
  "sliced",
  "thinly sliced",
  "julienned",
  "crushed",
  "grated",
  "shredded",
  "peeled",
  "seeded",
  "deveined",
  "trimmed",
  "rinsed",
  "drained",
  "melted",
  "softened",
  "room temperature",
  "at room temperature",
  "divided",
  "to taste",
  "or to taste",
  "for garnish",
  "for serving",
  "optional",
  "if desired",
  "plus more for garnish",
  "plus more for serving",
  "freshly ground",
  "cut into wedges",
  "cut into cubes",
  "cut into pieces",
  "cut into chunks",
  "cut into strips",
  "cut in half",
  "halved",
  "quartered",
  "lengthwise",
  "crosswise",
];

// Matches an exact known-bad fragment, or a "cut into <word(s)>" pattern
// generally (KNOWN_BAD_FRAGMENTS only lists the common specific cases,
// but the shape generalizes and new variants shouldn't need a code
// change to be caught).
const NON_FOOD_FRAGMENT = new RegExp(
  `^(?:${KNOWN_BAD_FRAGMENTS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
    "|"
  )}|cut\\s+into\\s+\\w+(?:\\s+\\w+)?)$`,
  "i"
);

// Cheap pre-filter run BEFORE any local-table/USDA lookup. Deliberately
// conservative — it only rejects text that's either too short to be a
// real food name or an exact/near match for known prep language. Anything
// else still goes through the normal local-table -> cache -> USDA path,
// so real quantity-less ingredients ("salt", "olive oil") are unaffected.
function isLikelyFoodFragment(name: string): boolean {
  const cleaned = stripDescriptiveAsides(name).trim();
  if (cleaned.length < 3) return false;
  if (NON_FOOD_FRAGMENT.test(cleaned)) return false;
  return true;
}

// ─── USDA FoodData Central integration ─────────────────────────────────────
//
// Personal free API key (fdc.nal.usda.gov/api-key-signup) — not rate-shared
// with other DEMO_KEY users, so this is fine for real usage.
const USDA_FDC_API_KEY = "bfoO0yWqAOcdRUWF4gPkCcuUxiG9FKMO4K9lkHG3";
const USDA_FDC_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";

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
// This is ONLY used for nutrition lookup (local match + USDA query); the
// original name with everything intact is still used everywhere else
// (display, grocery list, etc.).
//
// The trailing-clause stripping below is a defensive fallback for any
// comma that survives into a single parsed name (parenthetical commas are
// already handled by splitIngredientLines in sync.ts, which never merges
// separate comma-fragments together — each stays its own ingredient line,
// specifically so a real ingredient like "homemade mayonnaise" can never
// get glued onto an unrelated neighbor's quantity).
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

// Significant (non-stopword, length > 2) words in a string, lowercased —
// used by hasWordOverlap below to sanity-check that a USDA search result
// is actually about the ingredient we searched for, not just whatever
// ranked #1 in the API's full-text search.
const STOPWORDS = new Set(["of", "and", "the", "a", "an", "or", "with", "for", "to", "in"]);
function significantWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

// Requires at least one shared significant word between the query and a
// candidate USDA result's description. This is deliberately loose (one
// word, not all of them — "raw" vs "roasted" style variants should still
// match) but it's enough to reject results that are just noise: a search
// for a prep fragment or an odd/rare ingredient name occasionally returns
// a top-5 with zero actual relation to the query, and without this check
// that unrelated food's macros get silently attributed to the ingredient.
function hasWordOverlap(query: string, description: string): boolean {
  const qWords = significantWords(query);
  if (qWords.size === 0) return false;
  const dWords = significantWords(description);
  for (const w of qWords) {
    if (dWords.has(w)) return true;
  }
  return false;
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

    // Reject candidates that don't share even one significant word with
    // the query — see hasWordOverlap above. Without this, a noisy or
    // unusual ingredient name can land on a completely unrelated food
    // (e.g. a prep fragment matching a random branded item's name) and
    // that gets reported as a confident "found" match.
    const relevant = foods.filter((f) => hasWordOverlap(name, f.description ?? ""));
    if (relevant.length === 0) return { status: "not_found" };

    // Among relevant candidates, prefer a "raw"/plain result — avoids
    // landing on a prepared dish or an unrelated cut/variant that happens
    // to rank #1 for a noisy query.
    const preferred = relevant.find((f) => typeof f?.description === "string" && /\braw\b/i.test(f.description));
    const food = preferred ?? relevant[0];

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

  // Reject text that's a known/likely prep instruction before it ever
  // reaches USDA or the persistent caches — see isLikelyFoodFragment and
  // KNOWN_BAD_FRAGMENTS above. This is checked here (not earlier, in the
  // caller) so the local-table path above still runs first — some short
  // "prep-looking" strings can coincidentally be real foods.
  if (!isLikelyFoodFragment(name)) {
    return { per100g: localEntry.per100g, entry: localEntry, wasResolved: false, matchedDescription: undefined };
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
 * (see IngredientBreakdown in MacroDisplay.tsx). Scaled to a SINGLE
 * serving, same as the aggregate Macros totals this is attached to — a
 * whole-recipe amount here would read as contradictory next to a
 * per-serving total.
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
      //
      // wasResolved is now also false for anything caught by the
      // KNOWN_BAD_FRAGMENTS / isLikelyFoodFragment pre-filter inside
      // resolveIngredientNutrition, so prep fragments that USDA would
      // otherwise have "found" a false match for are correctly treated
      // as stray fragments here too.
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

  // Falls back to 4 when passed an invalid/unknown serving count — matching
  // the same default already used elsewhere (index.tsx, plan.tsx) rather
  // than assuming 1. Assuming 1 here previously meant: for any recipe
  // without a real servings value (i.e. every manually-typed,
  // photo-imported, or URL-scraped recipe — only Spoonacular bookmarks
  // ever get servings set), the estimator's *whole-recipe* total got
  // reported as if it were a single serving, inflating calories by
  // roughly however many servings the recipe actually makes.
  const safeServings = servings > 0 ? servings : 4;

  // Breakdown items are scaled to a single serving too, matching the
  // aggregate totals below — showing whole-recipe amounts here (e.g.
  // "680g salmon, 1414 kcal") next to a per-serving total ("354 kcal")
  // read as contradictory even though both numbers were individually
  // correct, just at different scales.
  const breakdown: IngredientBreakdownItem[] = perIngredientTotals.map((t) => ({
    ...t.breakdownItem,
    grams: t.breakdownItem.grams / safeServings,
    calories: t.breakdownItem.calories / safeServings,
    protein: t.breakdownItem.protein / safeServings,
    carbs: t.breakdownItem.carbs / safeServings,
    fat: t.breakdownItem.fat / safeServings,
    fiber: t.breakdownItem.fiber / safeServings,
  }));

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
