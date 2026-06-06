import { Router } from "express";

interface SpoonacularRecipe {
  id: number;
  title: string;
  image: string;
  readyInMinutes?: number;
}

interface SpoonacularResponse {
  results?: SpoonacularRecipe[];
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
    const url = new URL("https://api.spoonacular.com/recipes/complexSearch");
    url.searchParams.set("includeIngredients", ingredients);
    url.searchParams.set("number", "3");
    url.searchParams.set("addRecipeInformation", "true");
    url.searchParams.set("apiKey", apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      req.log.warn({ status: response.status }, "Spoonacular API error");
      res.status(502).json({ error: "Upstream API error" });
      return;
    }

    const data = (await response.json()) as SpoonacularResponse;

    res.json({
      recipes: (data.results ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        image: r.image,
        readyInMinutes: r.readyInMinutes ?? 30,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Recipe search failed");
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

export default router;
