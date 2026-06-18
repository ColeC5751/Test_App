export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { ingredients } = req.query;
  const apiKey = process.env.SPOONACULAR_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "API key not configured", code: "config_error" });
  if (!ingredients) return res.status(400).json({ error: "ingredients required", code: "bad_request" });

  try {
    const searchRes = await fetch(
      `https://api.spoonacular.com/recipes/complexSearch?includeIngredients=${ingredients}&number=2&type=main+course&sort=popularity&sortDirection=desc&apiKey=${apiKey}`
    );

    // Spoonacular quota errors
    if (searchRes.status === 401) {
      return res.status(402).json({ error: "Invalid Spoonacular API key.", code: "api_key_invalid" });
    }
    if (searchRes.status === 402 || searchRes.status === 429) {
      return res.status(429).json({ error: "Daily recipe search limit reached. Try again tomorrow.", code: "quota_exceeded" });
    }
    if (!searchRes.ok) {
      return res.status(502).json({ error: `Recipe service error (${searchRes.status}). Try again shortly.`, code: "upstream_error" });
    }

    const searchData = await searchRes.json();

    // Spoonacular sometimes returns 200 with a quota message in the body
    if (searchData.status === "failure" || searchData.code === 402) {
      return res.status(429).json({ error: "Daily recipe search limit reached. Try again tomorrow.", code: "quota_exceeded" });
    }

    const ids = (searchData.results ?? []).map((r: any) => r.id);
    if (ids.length === 0) return res.status(200).json({ recipes: [] });

    const bulkRes = await fetch(
      `https://api.spoonacular.com/recipes/informationBulk?ids=${ids.join(",")}&includeNutrition=false&apiKey=${apiKey}`
    );

    if (bulkRes.status === 402 || bulkRes.status === 429) {
      return res.status(429).json({ error: "Daily recipe search limit reached. Try again tomorrow.", code: "quota_exceeded" });
    }
    if (!bulkRes.ok) {
      return res.status(502).json({ error: `Recipe service error (${bulkRes.status}). Try again shortly.`, code: "upstream_error" });
    }

    const recipes = await bulkRes.json();

    return res.status(200).json({
      recipes: recipes.map((r: any) => {
        const mappedIngredients = (r.extendedIngredients ?? []).map((i: any) => ({
          amount: i.amount ?? 0,
          unit: i.unit ?? "",
          name: i.name ?? "",
          original: i.original ?? i.name ?? "",
        }));

        const servings = r.servings ?? 4;
        const totalMacros = calculateMacros(mappedIngredients);

        const macros = {
          calories: Math.round(totalMacros.calories / servings),
          protein:  Math.round(totalMacros.protein  / servings),
          carbs:    Math.round(totalMacros.carbs     / servings),
          fat:      Math.round(totalMacros.fat       / servings),
          fiber:    Math.round(totalMacros.fiber     / servings),
        };

        return {
          id: r.id,
          title: r.title,
          image: r.image,
          readyInMinutes: r.readyInMinutes ?? 30,
          servings,
          ingredients: mappedIngredients,
          instructions: (r.analyzedInstructions?.[0]?.steps ?? []).map((s: any) => s.step),
          macros,
        };
      }),
    });
  } catch (err: any) {
    // Network-level failure (no connection, DNS, timeout)
    const isNetworkError = err?.cause?.code === "ENOTFOUND"
      || err?.cause?.code === "ECONNREFUSED"
      || err?.name === "TypeError";
    if (isNetworkError) {
      return res.status(503).json({ error: "Could not reach recipe service. Check your connection.", code: "network_error" });
    }
    return res.status(500).json({ error: "Something went wrong. Please try again.", code: "unknown_error" });
  }
}
// ─── Macro Calculator ────────────────────────────────────────────────────────

type NutritionPer100 = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

type Macros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, liter: 1000, liters: 1000,
  tsp: 4.2, teaspoon: 4.2, teaspoons: 4.2,
  tbsp: 12.6, tablespoon: 12.6, tablespoons: 12.6,
  cup: 240, cups: 240,
  clove: 5, cloves: 5,
  piece: 80, pieces: 80,
  slice: 30, slices: 30,
  whole: 100, large: 120, medium: 80, small: 50,
  sprig: 3, sprigs: 3,
  pinch: 0.5, dash: 0.5,
  handful: 30, bunch: 80,
  stalk: 40, stalks: 40,
  head: 500, can: 400,
  package: 200, pkg: 200,
};

const nutritionData: Record<string, NutritionPer100> = {
  // Proteins
  "chicken breast":  { calories: 165, protein: 31,  carbs: 0,   fat: 3.6, fiber: 0 },
  "chicken thigh":   { calories: 209, protein: 26,  carbs: 0,   fat: 11,  fiber: 0 },
  "chicken":         { calories: 165, protein: 31,  carbs: 0,   fat: 3.6, fiber: 0 },
  "ground beef":     { calories: 254, protein: 26,  carbs: 0,   fat: 17,  fiber: 0 },
  "beef":            { calories: 250, protein: 26,  carbs: 0,   fat: 17,  fiber: 0 },
  "steak":           { calories: 271, protein: 26,  carbs: 0,   fat: 18,  fiber: 0 },
  "pork":            { calories: 242, protein: 27,  carbs: 0,   fat: 14,  fiber: 0 },
  "pork chop":       { calories: 231, protein: 25,  carbs: 0,   fat: 14,  fiber: 0 },
  "bacon":           { calories: 541, protein: 37,  carbs: 1,   fat: 42,  fiber: 0 },
  "sausage":         { calories: 301, protein: 13,  carbs: 2,   fat: 27,  fiber: 0 },
  "salmon":          { calories: 208, protein: 20,  carbs: 0,   fat: 13,  fiber: 0 },
  "fish":            { calories: 136, protein: 20,  carbs: 0,   fat: 6,   fiber: 0 },
  "tuna":            { calories: 144, protein: 30,  carbs: 0,   fat: 2,   fiber: 0 },
  "shrimp":          { calories: 99,  protein: 24,  carbs: 0,   fat: 0.3, fiber: 0 },
  "cod":             { calories: 82,  protein: 18,  carbs: 0,   fat: 0.7, fiber: 0 },
  "tilapia":         { calories: 96,  protein: 20,  carbs: 0,   fat: 2,   fiber: 0 },
  "turkey":          { calories: 189, protein: 29,  carbs: 0,   fat: 7,   fiber: 0 },
  "lamb":            { calories: 294, protein: 25,  carbs: 0,   fat: 21,  fiber: 0 },
  "egg":             { calories: 155, protein: 13,  carbs: 1,   fat: 11,  fiber: 0 },
  "eggs":            { calories: 155, protein: 13,  carbs: 1,   fat: 11,  fiber: 0 },
  "tofu":            { calories: 76,  protein: 8,   carbs: 2,   fat: 4,   fiber: 0.3 },
  "tempeh":          { calories: 193, protein: 19,  carbs: 9,   fat: 11,  fiber: 0 },
  "lentils":         { calories: 116, protein: 9,   carbs: 20,  fat: 0.4, fiber: 8 },
  "chickpeas":       { calories: 164, protein: 9,   carbs: 27,  fat: 2.6, fiber: 8 },
  "black beans":     { calories: 132, protein: 9,   carbs: 24,  fat: 0.5, fiber: 8 },
  "kidney beans":    { calories: 127, protein: 9,   carbs: 23,  fat: 0.5, fiber: 7 },
  "beans":           { calories: 127, protein: 9,   carbs: 23,  fat: 0.5, fiber: 7 },
  // Carbs
  "rice":            { calories: 130, protein: 2.7, carbs: 28,  fat: 0.3, fiber: 0.4 },
  "white rice":      { calories: 130, protein: 2.7, carbs: 28,  fat: 0.3, fiber: 0.4 },
  "brown rice":      { calories: 123, protein: 2.6, carbs: 26,  fat: 1,   fiber: 1.8 },
  "pasta":           { calories: 158, protein: 5.8, carbs: 31,  fat: 0.9, fiber: 1.8 },
  "spaghetti":       { calories: 158, protein: 5.8, carbs: 31,  fat: 0.9, fiber: 1.8 },
  "noodles":         { calories: 138, protein: 4.5, carbs: 25,  fat: 2,   fiber: 1.2 },
  "bread":           { calories: 265, protein: 9,   carbs: 49,  fat: 3.2, fiber: 2.7 },
  "tortilla":        { calories: 218, protein: 5.7, carbs: 37,  fat: 5.6, fiber: 2.5 },
  "potato":          { calories: 77,  protein: 2,   carbs: 17,  fat: 0.1, fiber: 2.2 },
  "potatoes":        { calories: 77,  protein: 2,   carbs: 17,  fat: 0.1, fiber: 2.2 },
  "sweet potato":    { calories: 86,  protein: 1.6, carbs: 20,  fat: 0.1, fiber: 3 },
  "oats":            { calories: 389, protein: 17,  carbs: 66,  fat: 7,   fiber: 11 },
  "quinoa":          { calories: 120, protein: 4.4, carbs: 22,  fat: 1.9, fiber: 2.8 },
  "flour":           { calories: 364, protein: 10,  carbs: 76,  fat: 1,   fiber: 2.7 },
  "breadcrumbs":     { calories: 395, protein: 14,  carbs: 72,  fat: 5,   fiber: 3.5 },
  "cornstarch":      { calories: 381, protein: 0.3, carbs: 91,  fat: 0.1, fiber: 0.9 },
  "couscous":        { calories: 112, protein: 3.8, carbs: 23,  fat: 0.2, fiber: 1.4 },
  // Vegetables
  "broccoli":        { calories: 34,  protein: 2.8, carbs: 7,   fat: 0.4, fiber: 2.6 },
  "spinach":         { calories: 23,  protein: 2.9, carbs: 3.6, fat: 0.4, fiber: 2.2 },
  "kale":            { calories: 49,  protein: 4.3, carbs: 9,   fat: 0.9, fiber: 3.6 },
  "carrots":         { calories: 41,  protein: 0.9, carbs: 10,  fat: 0.2, fiber: 2.8 },
  "carrot":          { calories: 41,  protein: 0.9, carbs: 10,  fat: 0.2, fiber: 2.8 },
  "peppers":         { calories: 31,  protein: 1,   carbs: 7,   fat: 0.3, fiber: 2.5 },
  "bell pepper":     { calories: 31,  protein: 1,   carbs: 7,   fat: 0.3, fiber: 2.5 },
  "onion":           { calories: 40,  protein: 1.1, carbs: 9,   fat: 0.1, fiber: 1.7 },
  "onions":          { calories: 40,  protein: 1.1, carbs: 9,   fat: 0.1, fiber: 1.7 },
  "garlic":          { calories: 149, protein: 6.4, carbs: 33,  fat: 0.5, fiber: 2.1 },
  "tomato":          { calories: 18,  protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 },
  "tomatoes":        { calories: 18,  protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 },
  "cucumber":        { calories: 15,  protein: 0.7, carbs: 3.6, fat: 0.1, fiber: 0.5 },
  "zucchini":        { calories: 17,  protein: 1.2, carbs: 3.1, fat: 0.3, fiber: 1 },
  "mushroom":        { calories: 22,  protein: 3.1, carbs: 3.3, fat: 0.3, fiber: 1 },
  "mushrooms":       { calories: 22,  protein: 3.1, carbs: 3.3, fat: 0.3, fiber: 1 },
  "celery":          { calories: 16,  protein: 0.7, carbs: 3,   fat: 0.2, fiber: 1.6 },
  "corn":            { calories: 86,  protein: 3.2, carbs: 19,  fat: 1.2, fiber: 2 },
  "peas":            { calories: 81,  protein: 5.4, carbs: 14,  fat: 0.4, fiber: 5.5 },
  "asparagus":       { calories: 20,  protein: 2.2, carbs: 3.9, fat: 0.1, fiber: 2.1 },
  "cauliflower":     { calories: 25,  protein: 1.9, carbs: 5,   fat: 0.3, fiber: 2 },
  "cabbage":         { calories: 25,  protein: 1.3, carbs: 6,   fat: 0.1, fiber: 2.5 },
  "lettuce":         { calories: 15,  protein: 1.4, carbs: 2.9, fat: 0.2, fiber: 1.3 },
  "eggplant":        { calories: 25,  protein: 1,   carbs: 6,   fat: 0.2, fiber: 3 },
  "leek":            { calories: 61,  protein: 1.5, carbs: 14,  fat: 0.3, fiber: 1.8 },
  "olives":          { calories: 115, protein: 0.8, carbs: 6,   fat: 11,  fiber: 3.2 },
  "olive":           { calories: 115, protein: 0.8, carbs: 6,   fat: 11,  fiber: 3.2 },
  "parsley":         { calories: 36,  protein: 3,   carbs: 6.3, fat: 0.8, fiber: 3.3 },
  // Dairy
  "milk":            { calories: 61,  protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0 },
  "butter":          { calories: 717, protein: 0.9, carbs: 0.1, fat: 81,  fiber: 0 },
  "cream":           { calories: 340, protein: 2.1, carbs: 2.8, fat: 36,  fiber: 0 },
  "heavy cream":     { calories: 340, protein: 2.1, carbs: 2.8, fat: 36,  fiber: 0 },
  "cheese":          { calories: 402, protein: 25,  carbs: 1.3, fat: 33,  fiber: 0 },
  "cheddar":         { calories: 403, protein: 25,  carbs: 1.3, fat: 33,  fiber: 0 },
  "parmesan":        { calories: 431, protein: 38,  carbs: 4,   fat: 29,  fiber: 0 },
  "mozzarella":      { calories: 280, protein: 28,  carbs: 2.2, fat: 17,  fiber: 0 },
  "yogurt":          { calories: 59,  protein: 10,  carbs: 3.6, fat: 0.4, fiber: 0 },
  "sour cream":      { calories: 198, protein: 2.4, carbs: 4.6, fat: 19,  fiber: 0 },
  "cream cheese":    { calories: 342, protein: 6,   carbs: 4,   fat: 34,  fiber: 0 },
  // Oils & Fats
  "olive oil":       { calories: 884, protein: 0,   carbs: 0,   fat: 100, fiber: 0 },
  "oil":             { calories: 884, protein: 0,   carbs: 0,   fat: 100, fiber: 0 },
  "vegetable oil":   { calories: 884, protein: 0,   carbs: 0,   fat: 100, fiber: 0 },
  "coconut oil":     { calories: 892, protein: 0,   carbs: 0,   fat: 99,  fiber: 0 },
  "sesame oil":      { calories: 884, protein: 0,   carbs: 0,   fat: 100, fiber: 0 },
  // Sauces & Condiments
  "soy sauce":       { calories: 53,  protein: 8.1, carbs: 5,   fat: 0.1, fiber: 0.8 },
  "ketchup":         { calories: 101, protein: 1.7, carbs: 26,  fat: 0.1, fiber: 0.3 },
  "tomato sauce":    { calories: 29,  protein: 1.5, carbs: 5.9, fat: 0.4, fiber: 1.5 },
  "tomato paste":    { calories: 82,  protein: 4.3, carbs: 19,  fat: 0.5, fiber: 4.2 },
  "bbq sauce":       { calories: 172, protein: 1.6, carbs: 41,  fat: 0.5, fiber: 0.7 },
  "hot sauce":       { calories: 11,  protein: 0.5, carbs: 2,   fat: 0.2, fiber: 0.4 },
  "mayonnaise":      { calories: 680, protein: 1,   carbs: 0.6, fat: 75,  fiber: 0 },
  "mustard":         { calories: 66,  protein: 4.4, carbs: 6,   fat: 3.3, fiber: 3.3 },
  "honey":           { calories: 304, protein: 0.3, carbs: 82,  fat: 0,   fiber: 0.2 },
  "maple syrup":     { calories: 260, protein: 0,   carbs: 67,  fat: 0.1, fiber: 0 },
  "vinegar":         { calories: 21,  protein: 0,   carbs: 0.9, fat: 0,   fiber: 0 },
  "stock":           { calories: 15,  protein: 1.5, carbs: 1.4, fat: 0.5, fiber: 0 },
  "broth":           { calories: 15,  protein: 1.5, carbs: 1.4, fat: 0.5, fiber: 0 },
  "chicken broth":   { calories: 15,  protein: 1.5, carbs: 1.4, fat: 0.5, fiber: 0 },
  "lemon juice":     { calories: 22,  protein: 0.4, carbs: 6.9, fat: 0.2, fiber: 0.3 },
  // Nuts & Seeds
  "almonds":         { calories: 579, protein: 21,  carbs: 22,  fat: 50,  fiber: 12.5 },
  "peanuts":         { calories: 567, protein: 26,  carbs: 16,  fat: 49,  fiber: 8.5 },
  "peanut butter":   { calories: 588, protein: 25,  carbs: 20,  fat: 50,  fiber: 6 },
  "walnuts":         { calories: 654, protein: 15,  carbs: 14,  fat: 65,  fiber: 6.7 },
  "cashews":         { calories: 553, protein: 18,  carbs: 30,  fat: 44,  fiber: 3.3 },
  "sesame seeds":    { calories: 573, protein: 17,  carbs: 23,  fat: 50,  fiber: 11.8 },
  // Fruit
  "lemon":           { calories: 29,  protein: 1.1, carbs: 9,   fat: 0.3, fiber: 2.8 },
  "lime":            { calories: 30,  protein: 0.7, carbs: 11,  fat: 0.2, fiber: 2.8 },
  "avocado":         { calories: 160, protein: 2,   carbs: 9,   fat: 15,  fiber: 7 },
  // Herbs & Spices
  "salt":            { calories: 0,   protein: 0,   carbs: 0,   fat: 0,   fiber: 0 },
  "pepper":          { calories: 251, protein: 10,  carbs: 64,  fat: 3.3, fiber: 25 },
  "cumin":           { calories: 375, protein: 18,  carbs: 44,  fat: 22,  fiber: 10.5 },
  "paprika":         { calories: 282, protein: 14,  carbs: 54,  fat: 13,  fiber: 35 },
  "oregano":         { calories: 265, protein: 9,   carbs: 69,  fat: 4.3, fiber: 42.5 },
  "basil":           { calories: 22,  protein: 3.2, carbs: 2.7, fat: 0.6, fiber: 1.6 },
  "thyme":           { calories: 101, protein: 5.6, carbs: 24,  fat: 1.7, fiber: 14 },
  "rosemary":        { calories: 131, protein: 3.3, carbs: 21,  fat: 5.9, fiber: 14 },
  "ginger":          { calories: 80,  protein: 1.8, carbs: 18,  fat: 0.8, fiber: 2 },
  "turmeric":        { calories: 312, protein: 9.7, carbs: 67,  fat: 3.3, fiber: 22 },
  "chili":           { calories: 40,  protein: 1.9, carbs: 9,   fat: 0.4, fiber: 1.5 },
  "chili powder":    { calories: 282, protein: 13,  carbs: 50,  fat: 14,  fiber: 34 },
  "sugar":           { calories: 387, protein: 0,   carbs: 100, fat: 0,   fiber: 0 },
  "brown sugar":     { calories: 380, protein: 0,   carbs: 98,  fat: 0,   fiber: 0 },
};

function lookupNutrition(name: string): NutritionPer100 | null {
  const lower = name.toLowerCase().trim();
  if (nutritionData[lower]) return nutritionData[lower];
  const keys = Object.keys(nutritionData).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return nutritionData[key];
  }
  for (const key of keys) {
    if (key.includes(lower)) return nutritionData[key];
  }
  return null;
}

function toGrams(amount: number, unit: string): number {
  if (!unit) return amount > 0 ? amount : 100;
  const key = unit.toLowerCase().trim().replace(/\.$/, "");
  return amount * (UNIT_TO_GRAMS[key] ?? 100);
}

function calculateMacros(ingredients: { amount: number; unit: string; name: string }[]): Macros {
  const totals: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const ing of ingredients) {
    const nutrition = lookupNutrition(ing.name);
    if (!nutrition) continue;
    const factor = toGrams(ing.amount, ing.unit) / 100;
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
