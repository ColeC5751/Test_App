import nutritionData, { NutritionPer100 } from "./nutritionData";

export type Macros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

// Unit conversion to grams / ml (treated as grams for liquids)
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  tsp: 4.2,
  teaspoon: 4.2,
  teaspoons: 4.2,
  tbsp: 12.6,
  tablespoon: 12.6,
  tablespoons: 12.6,
  cup: 240,
  cups: 240,
  // whole items — rough average weights in grams
  clove: 5,
  cloves: 5,
  piece: 80,
  pieces: 80,
  slice: 30,
  slices: 30,
  whole: 100,
  large: 120,
  medium: 80,
  small: 50,
  sprig: 3,
  sprigs: 3,
  pinch: 0.5,
  dash: 0.5,
  handful: 30,
  bunch: 80,
  stalk: 40,
  stalks: 40,
  head: 500,
  can: 400,
  package: 200,
  pkg: 200,
};

/**
 * Finds the best matching nutrition entry for an ingredient name.
 * Tries exact match first, then substring matches.
 */
function lookupNutrition(name: string): NutritionPer100 | null {
  const lower = name.toLowerCase().trim();

  // 1. Exact match
  if (nutritionData[lower]) return nutritionData[lower];

  // 2. Check if any key is contained in the ingredient name
  //    e.g. "boneless chicken breast" → matches "chicken breast"
  //    Sort by key length descending so more specific keys win
  const keys = Object.keys(nutritionData).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return nutritionData[key];
  }

  // 3. Check if the ingredient name is contained in a key
  //    e.g. "salmon" → matches "salmon"
  for (const key of keys) {
    if (key.includes(lower)) return nutritionData[key];
  }

  return null;
}

/**
 * Converts an ingredient amount + unit to grams.
 * Falls back to 100g if the unit is unrecognised.
 */
function toGrams(amount: number, unit: string): number {
  if (!unit) return amount > 0 ? amount : 100;
  const key = unit.toLowerCase().trim().replace(/\.$/, "");
  return amount * (UNIT_TO_GRAMS[key] ?? 100);
}

/**
 * Calculates total macros for a list of ingredients.
 * Amounts that can't be matched are silently skipped.
 */
export function calculateMacros(
  ingredients: { amount: number; unit: string; name: string }[]
): Macros {
  const totals: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

  for (const ing of ingredients) {
    const nutrition = lookupNutrition(ing.name);
    if (!nutrition) continue;

    const grams = toGrams(ing.amount, ing.unit);
    const factor = grams / 100;

    totals.calories += nutrition.calories * factor;
    totals.protein  += nutrition.protein  * factor;
    totals.carbs    += nutrition.carbs    * factor;
    totals.fat      += nutrition.fat      * factor;
    totals.fiber    += nutrition.fiber    * factor;
  }

  return {
    calories: Math.round(totals.calories),
    protein:  Math.round(totals.protein),
    carbs:    Math.round(totals.carbs),
    fat:      Math.round(totals.fat),
    fiber:    Math.round(totals.fiber),
  };
}
