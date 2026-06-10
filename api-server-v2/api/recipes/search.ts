export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { ingredients } = req.query;
  const apiKey = "257283d53ee54b63acc667363a5791e7";

  if (!ingredients) return res.status(400).json({ error: "ingredients required" });

  try {
    const searchRes = await fetch(
      `https://api.spoonacular.com/recipes/complexSearch?includeIngredients=${ingredients}&number=3&apiKey=${apiKey}`
    );
    const searchData = await searchRes.json();
    const ids = (searchData.results ?? []).map((r: any) => r.id);

    if (ids.length === 0) return res.status(200).json({ recipes: [] });

    const bulkRes = await fetch(
      `https://api.spoonacular.com/recipes/informationBulk?ids=${ids.join(",")}&includeNutrition=false&apiKey=${apiKey}`
    );
    const recipes = await bulkRes.json();

    return res.status(200).json({
      recipes: recipes.map((r: any) => ({
        id: r.id,
        title: r.title,
        image: r.image,
        readyInMinutes: r.readyInMinutes ?? 30,
        servings: r.servings ?? 4,
        ingredients: (r.extendedIngredients ?? []).map((i: any) => ({
          amount: i.amount ?? 0,
          unit: i.unit ?? "",
          name: i.name ?? "",
          original: i.original ?? i.name ?? "",
        })),
        instructions: (r.analyzedInstructions?.[0]?.steps ?? []).map((s: any) => s.step),
      })),
    });
  } catch {
    return res.status(500).json({ error: "Failed to fetch recipes" });
  }
}
