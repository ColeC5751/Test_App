export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const ingredients = searchParams.get("ingredients");
  const apiKey = "YOUR_KEY_HERE";

  if (!ingredients) {
    return new Response(JSON.stringify({ error: "ingredients required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const searchRes = await fetch(
      `https://api.spoonacular.com/recipes/complexSearch?includeIngredients=${ingredients}&number=3&apiKey=${apiKey}`
    );
    const searchData = await searchRes.json();
    const ids = (searchData.results ?? []).map((r: any) => r.id);

    if (ids.length === 0) {
      return new Response(JSON.stringify({ recipes: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const bulkRes = await fetch(
      `https://api.spoonacular.com/recipes/informationBulk?ids=${ids.join(",")}&includeNutrition=false&apiKey=${apiKey}`
    );
    const recipes = await bulkRes.json();

    return new Response(JSON.stringify({
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
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to fetch recipes" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
