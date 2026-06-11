import { Router } from "express";
import { calculateMacros } from "../lib/calculateMacros";

interface SpoonacularIngredient {
  amount?: number;
  unit?: string;
  name?: string;
  original?: string;
}

interface SpoonacularStep {
  number: number;
  step: string;
}

interface SpoonacularInstruction {
  name?: string;
  steps?: SpoonacularStep[];
}

interface SpoonacularRecipe {
  id: number;
  title: string;
  image: string;
  readyInMinutes?: number;
  servings?: number;
  extendedIngredients?: SpoonacularIngredient[];
  analyzedInstructions?: SpoonacularInstruction[];
}

interface SpoonacularSearchResponse {
  results?: { id: number }[];
}

const router = Router();

router.get("/search", async (req, res) => {
  const { ingredients } = req.query;
  const apiKey = process.env["SPOONACULAR_API_KEY"];

  if (!apiKey) {
    res.status(500).json({ error: "API key not configured" });
    return;
  }

  if (!ingredients || typeof ingredients !== "string") {
    res.status(400).json({ error: "ingredients query param is required" });
    return;
  }

  try {
    const searchUrl = new URL("https://api.spoonacular.com/recipes/complexSearch");
    searchUrl.searchParams.set("includeIngredients", ingredients);
    searchUrl.searchParams.set("number", "2");
    searchUrl.searchParams.set("apiKey", apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      req.log.warn({ status: searchRes.status }, "Spoonacular search error");
      res.status(502).json({ error: "Upstream API error" });
      return;
    }

    const searchData = (await searchRes.json()) as SpoonacularSearchResponse;
    const ids = (searchData.results ?? []).map((r) => r.id);

    if (ids.length === 0) {
      res.json({ recipes: [] });
      return;
    }

    // includeNutrition is false — we calculate macros ourselves
    const bulkUrl = new URL("https://api.spoonacular.com/recipes/informationBulk");
    bulkUrl.searchParams.set("ids", ids.join(","));
    bulkUrl.searchParams.set("includeNutrition", "false");
    bulkUrl.searchParams.set("apiKey", apiKey);

    const bulkRes = await fetch(bulkUrl.toString());
    if (!bulkRes.ok) {
      req.log.warn({ status: bulkRes.status }, "Spoonacular bulk info error");
      res.status(502).json({ error: "Upstream API error" });
      return;
    }

    const recipes = (await bulkRes.json()) as SpoonacularRecipe[];

    res.json({
      recipes: recipes.map((r) => {
        const mappedIngredients = (r.extendedIngredients ?? []).map((i) => ({
          amount: i.amount ?? 0,
          unit: i.unit ?? "",
          name: i.name ?? "",
          original: i.original ?? i.name ?? "",
        }));

        const servings = r.servings ?? 4;
        const totalMacros = calculateMacros(mappedIngredients);

        // Return per-serving macros
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
          instructions: (r.analyzedInstructions?.[0]?.steps ?? []).map((s) => s.step),
          macros,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Recipe search failed");
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

export default router;
