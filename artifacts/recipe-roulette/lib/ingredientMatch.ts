// ─── Shared ingredient-matching data ────────────────────────────────────────
//
// Lives in its own module (rather than inside macros.ts, where it used to
// live) specifically so sync.ts can use it too. sync.ts's splitIngredientLines
// needs to know whether a comma-separated fragment ("homemade mayonnaise")
// is a real, recognizable ingredient — using the SAME local table macros.ts
// uses for nutrition — without macros.ts and sync.ts ending up importing
// from each other in a cycle (macros.ts already imports parseIngredientLine
// / splitIngredientLines from sync.ts).

export type Per100g = { calories: number; protein: number; carbs: number; fat: number; fiber: number };

export type NutritionEntry = {
  keywords: string[];
  per100g: Per100g;
  gramsPerUnit?: Record<string, number>;
};

// A fragment containing a digit or fraction character almost certainly
// carries its own quantity and is very likely a real, distinct ingredient
// (e.g. "juice of 1 lemon"). Shared by sync.ts's ingredient-line handling
// and macros.ts's stray-fragment detection.
export const HAS_QUANTITY_SIGNAL = /[\d¼½¾⅓⅔⅕⅖⅗⅘⅛⅜⅝⅞]/;

// ─── Local fallback nutrition table (per 100g, edible portion, approximate) ──
//
// Used when USDA FoodData Central has no match for an ingredient, the
// request fails, or (as of the local-first precedence change) whenever an
// ingredient IS matched here — a curated match is trusted over USDA's full-
// text search, which handles specific names well ("salmon") but poorly for
// generic recipe phrasing ("salad greens"). `gramsPerUnit` lets a specific
// ingredient override the generic unit conversions in macros.ts for units
// that don't behave like a simple liquid (e.g. a "cup" of flour is much
// lighter than a "cup" of olive oil, and leafy greens are mostly air).
// Keys are lowercased unit strings matching KNOWN_UNITS in sync.ts, plus
// the special key "each" for countable/no-unit items ("3 eggs", "2 cloves").
export const NUTRITION_DB: NutritionEntry[] = [
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
  { keywords: ["bread", "baguette", "sourdough", "brioche"], per100g: { calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7 }, gramsPerUnit: { slice: 30, slices: 30, each: 30 } },
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

  // ── Fats / oils / condiments ──
  { keywords: ["olive oil", "vegetable oil", "sesame oil", "coconut oil", "oil"], per100g: { calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 }, gramsPerUnit: { tbsp: 13.5, tsp: 4.5, cup: 216 } },
  { keywords: ["mayonnaise", "mayo"], per100g: { calories: 680, protein: 1, carbs: 0.6, fat: 75, fiber: 0 }, gramsPerUnit: { tbsp: 13.8, tsp: 4.6 } },
  { keywords: ["mustard"], per100g: { calories: 66, protein: 4.4, carbs: 5, fat: 3.3, fiber: 3.3 }, gramsPerUnit: { tbsp: 15.9, tsp: 5.3, cup: 249 } },
  { keywords: ["ketchup"], per100g: { calories: 101, protein: 1.2, carbs: 25, fat: 0.2, fiber: 0.3 }, gramsPerUnit: { tbsp: 17, tsp: 5.7 } },
  { keywords: ["hot sauce"], per100g: { calories: 12, protein: 0.5, carbs: 2, fat: 0.4, fiber: 0.3 }, gramsPerUnit: { tbsp: 15, tsp: 5 } },
  { keywords: ["vinegar"], per100g: { calories: 19, protein: 0, carbs: 0.4, fat: 0, fiber: 0 }, gramsPerUnit: { tbsp: 14.9, tsp: 5 } },

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
export const GENERIC_FALLBACK: NutritionEntry = {
  keywords: [],
  per100g: { calories: 150, protein: 5, carbs: 20, fat: 5, fiber: 2 },
};

export function matchNutritionEntry(name: string): NutritionEntry {
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

// True if `name` matches a real, curated ingredient — used by sync.ts to
// decide whether a digit-less comma fragment ("homemade mayonnaise") is a
// genuine standalone ingredient worth keeping, as opposed to leftover prep
// text ("minced", "cut into wedges") that should be dropped.
export function isRecognizedIngredient(name: string): boolean {
  return matchNutritionEntry(name) !== GENERIC_FALLBACK;
}
