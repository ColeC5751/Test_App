export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    // Fetch the page HTML server-side
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeBot/1.0)" },
    });
    if (!pageRes.ok) throw new Error(`Could not fetch URL (${pageRes.status})`);
    const html = await pageRes.text();

    // ── Step 1: Try schema.org/Recipe structured data (free, instant) ──
    const schemaResult = extractSchemaOrg(html);
    if (schemaResult) {
      return res.status(200).json(schemaResult);
    }

    // ── Step 2: Fall back to Claude if no structured data found ──
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(422).json({ error: "No structured recipe data found on this page. Try a different URL." });
    }

    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Extract the recipe from this webpage text. Return JSON only with these exact keys:
- name: string (recipe name)
- ingredients: array of strings (each ingredient on its own)
- steps: array of strings (each step on its own, without numbers)
- servings: number (optional)
- readyInMinutes: number (optional)
- image: string (image URL if found, optional)

Return only valid JSON, no markdown, no backticks, no explanation.

Webpage text:
${stripped}`,
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Anthropic API error");

    const text = data.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Failed to scrape recipe" });
  }
}

// ─── Schema.org extractor ─────────────────────────────────────────────────────

function extractSchemaOrg(html: string): object | null {
  try {
    // Find all <script type="application/ld+json"> blocks
    const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(match[1]);
        const recipe = findRecipeNode(json);
        if (recipe) return formatSchemaRecipe(recipe);
      } catch {
        // Invalid JSON in this block, try next
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function findRecipeNode(node: any): any {
  if (!node) return null;

  // Direct Recipe type
  if (node["@type"] === "Recipe") return node;

  // Array of types (e.g. ["Recipe", "Thing"])
  if (Array.isArray(node["@type"]) && node["@type"].includes("Recipe")) return node;

  // @graph array (common on many sites)
  if (Array.isArray(node["@graph"])) {
    for (const item of node["@graph"]) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
  }

  // Array of nodes at the top level
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
  }

  return null;
}

function formatSchemaRecipe(recipe: any): object {
  // Parse ingredients
  const ingredients: string[] = (recipe.recipeIngredient ?? []).map((i: any) =>
    typeof i === "string" ? i.trim() : String(i)
  );

  // Parse instructions — can be string, array of strings, or array of HowToStep objects
  const steps: string[] = [];
  const instructions = recipe.recipeInstructions;
  if (typeof instructions === "string") {
    // Plain text — split by newline or period
    steps.push(...instructions.split(/\n+/).map((s: string) => s.trim()).filter(Boolean));
  } else if (Array.isArray(instructions)) {
    for (const inst of instructions) {
      if (typeof inst === "string") {
        steps.push(inst.trim());
      } else if (inst["@type"] === "HowToSection" && Array.isArray(inst.itemListElement)) {
        for (const step of inst.itemListElement) {
          steps.push((step.text ?? step.name ?? "").trim());
        }
      } else {
        steps.push((inst.text ?? inst.name ?? "").trim());
      }
    }
  }

  // Parse cook/prep time from ISO 8601 duration (e.g. PT30M)
  const totalTime = recipe.totalTime ?? recipe.cookTime ?? recipe.prepTime;
  const readyInMinutes = totalTime ? parseDuration(totalTime) : undefined;

  // Parse servings
  const servingsRaw = recipe.recipeYield;
  const servings = servingsRaw
    ? parseInt(Array.isArray(servingsRaw) ? servingsRaw[0] : servingsRaw, 10) || undefined
    : undefined;

  // Find image URL
  const imageRaw = recipe.image;
  let image: string | undefined;
  if (typeof imageRaw === "string") image = imageRaw;
  else if (Array.isArray(imageRaw)) image = imageRaw[0]?.url ?? imageRaw[0];
  else if (imageRaw?.url) image = imageRaw.url;

  return {
    name: recipe.name ?? "",
    ingredients: ingredients.filter(Boolean),
    steps: steps.filter(Boolean),
    ...(servings ? { servings } : {}),
    ...(readyInMinutes ? { readyInMinutes } : {}),
    ...(image ? { image } : {}),
    source: "schema.org",
  };
}

function parseDuration(iso: string): number | undefined {
  // PT1H30M → 90, PT30M → 30
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  return hours * 60 + minutes || undefined;
}
