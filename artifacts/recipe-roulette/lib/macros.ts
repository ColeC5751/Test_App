// ─── Ingredient-based macro estimation ─────────────────────────────────────
//
// There is no backend endpoint that computes nutrition from an arbitrary
// ingredients list — the spin tab's `recipe.macros` comes pre-computed from
// the `/api/recipes/search` response for Spoonacular-sourced recipes only.
// Manually-entered, photo-imported, and URL-scraped recipes have no
// nutrition source at all. This module fills that gap with a small,
// self-contained, rough estimator: match each ingredient line against a
// keyword-based nutrition table (same pattern as AISLE_MAP/getAisle in
// sync.ts), convert its amount to grams, and sum per-100g nutrition scaled
// by weight.
//
// This is explicitly a *rough* estimate, not the accuracy of a real
// nutrition API — treat it as "close enough for planning a meal," not as
// something to build strict calorie-counting features on top of.

import { parseIngredientLine, splitIngredientLines } from "./sync";
import type { Macros, PersonalRecipe } from "./types";

// Re-exported so existing `import type { Macros } from "@/lib/macros"`
// call sites keep working — the canonical definition now lives in
// lib/types.ts alongside every other shared data shape.
export type { Macros };

// ─── Nutrition table (per 100g, edible portion, approximate) ──────────────
//
// `gramsPerUnit` lets a specific ingredient override the generic unit
// conversions below for units that don't behave like a simple liquid
// (e.g. a "cup" of flour is much lighter than a "cup" of olive oil). Keys
// are lowercased unit strings matching KNOWN_UNITS in sync.ts, plus the
// special key "each" for countable/no-unit items ("3 eggs", "2 cloves").

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
  { keywords: ["lettuce", "cabbage", "kale"], per100g: { calories: 20, protein: 1.5, carbs: 3.5, fat: 0.3, fiber: 1.8 } },
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

/**
 * Estimates PER-SERVING macros for a raw ingredients string.
 *
 * `servings` must be the recipe's own yield (how many servings the full
 * ingredients list produces) — NOT a live "how many do you want to cook"
 * multiplier. Per-serving nutrition is a fixed property of the recipe; it
 * doesn't change when someone scales the batch size up or down (same
 * principle the spin tab's MacroBar already relies on — see its comment).
 * Callers scaling ingredient amounts for a bigger batch should still pass
 * the recipe's original servings count here, not the scaled target.
 */
export function estimateMacrosPerServing(rawIngredientsText: string, servings: number): Macros {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

  for (const line of splitIngredientLines(rawIngredientsText)) {
    const { name, amount, unit } = parseIngredientLine(line);
    const entry = matchNutritionEntry(name);
    const grams = toGrams(amount, unit, entry);
    const scale = grams / 100;

    totals.calories += entry.per100g.calories * scale;
    totals.protein += entry.per100g.protein * scale;
    totals.carbs += entry.per100g.carbs * scale;
    totals.fat += entry.per100g.fat * scale;
    totals.fiber += entry.per100g.fiber * scale;
  }

  const safeServings = servings > 0 ? servings : 1;

  return {
    calories: totals.calories / safeServings,
    protein: totals.protein / safeServings,
    carbs: totals.carbs / safeServings,
    fat: totals.fat / safeServings,
    fiber: totals.fiber / safeServings,
    estimated: true,
  };
}

/**
 * Resolves the best available per-serving macros for a personal recipe:
 * real API-sourced data if it has any (set when bookmarked from a
 * Spoonacular search result — see handleToggleSaveRecipe in index.tsx),
 * otherwise falls back to the ingredient-based estimate above. Shared by
 * roulette.tsx (My Dinners) and plan.tsx (Planner) so both screens
 * resolve/display macros the same way instead of duplicating this
 * fallback logic.
 */
export function getRecipeMacros(recipe: PersonalRecipe): Macros {
  return recipe.macros ?? estimateMacrosPerServing(recipe.ingredients, recipe.servings ?? 1);
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
