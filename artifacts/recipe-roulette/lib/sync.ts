import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { HAS_QUANTITY_SIGNAL, isRecognizedIngredient } from "./ingredientMatch";
import type {
  GroceryItem,
  MealPlan,
  PersonalRecipe,
  SharePermission,
  SyncStatus,
} from "./types";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ─── Grocery List Sync ────────────────────────────────────────────────────────
//
// Canonical grocery data flow. This file is the ONLY place that:
//   - parses raw ingredient text into GroceryItem objects
//   - merges/combines ingredient lists
//   - categorizes items into aisles
//   - persists grocery items locally and to Supabase
//
// grocery.tsx (display/editing) and plan.tsx (meal-plan → grocery) both
// call useGrocerySync() and use its addIngredients/deleteItem/toggleItem/
// updateItemAmount methods rather than keeping their own storage, parsing,
// or "compute next list from current items" logic. The shared-viewer
// screen ([token].tsx) uses useSharedGrocerySync() below, which mirrors the
// same mutation surface (save/addIngredients/deleteItem/rename) scoped to
// the row identified by share_token instead of owner_id.

const GROCERY_LOCAL_KEY = "@recipe_roulette_grocery";
const GROCERY_ROW_KEY = "@recipe_roulette_grocery_row_id";

// ─── Aisle categorization ─────────────────────────────────────────────────────

export const AISLE_MAP: { aisle: string; icon: string; keywords: string[] }[] = [
  {
    aisle: "Produce", icon: "🥦",
    keywords: ["apple","apples","avocado","basil","bean","beans","bell pepper","broccoli","cabbage","carrot","carrots","cauliflower","celery","cherry","chili","cilantro","corn","cucumber","eggplant","garlic","ginger","grape","kale","leek","lemon","lettuce","lime","mint","mushroom","mushrooms","onion","onions","orange","parsley","pea","peas","pepper","peppers","potato","potatoes","rosemary","scallion","spinach","squash","sweet potato","thyme","tomato","tomatoes","zucchini","asparagus","fennel","leeks","parsnip","radish","shallot","turnip"],
  },
  {
    aisle: "Meat & Seafood", icon: "🥩",
    keywords: ["bacon","beef","chicken","chorizo","clam","cod","crab","duck","fish","ground beef","ground turkey","ham","lamb","lobster","pork","prosciutto","salmon","sausage","scallop","shrimp","steak","tilapia","tuna","turkey","venison","anchovy","anchovies","mussels","sardines","squid"],
  },
  {
    aisle: "Dairy & Eggs", icon: "🧀",
    keywords: ["butter","cheddar","cheese","cottage cheese","cream","cream cheese","egg","eggs","feta","goat cheese","gouda","gruyere","half and half","heavy cream","milk","mozzarella","parmesan","ricotta","sour cream","whipping cream","yogurt","brie","manchego","pecorino"],
  },
  {
    aisle: "Bakery & Bread", icon: "🍞",
    keywords: ["bagel","baguette","bread","breadcrumbs","brioche","bun","ciabatta","crouton","croutons","english muffin","flatbread","naan","pita","roll","rolls","sourdough","tortilla","wrap"],
  },
  {
    aisle: "Pantry", icon: "🫙",
    keywords: ["baking powder","baking soda","bay leaf","black beans","bouillon","broth","brown sugar","capers","chickpeas","chili powder","chocolate","cinnamon","clove","cloves","cocoa","coconut milk","cornstarch","cumin","curry","flour","honey","hot sauce","ketchup","kidney beans","lentils","maple syrup","mayonnaise","molasses","mustard","nutritional yeast","oats","oil","olive oil","oregano","oyster sauce","paprika","peanut butter","pepper","quinoa","red pepper flakes","salt","sesame oil","soy sauce","stock","sugar","tahini","tomato paste","tomato sauce","turmeric","vanilla","vegetable oil","vinegar","worcestershire","yeast","coconut oil","fish sauce","hoisin","miso","sriracha","tabasco"],
  },
  {
    aisle: "Pasta, Rice & Grains", icon: "🍝",
    keywords: ["barley","brown rice","couscous","egg noodles","farro","fettuccine","lasagna","linguine","macaroni","noodles","orzo","pasta","penne","polenta","ramen","rice","rigatoni","risotto","spaghetti","udon","vermicelli","white rice","wild rice"],
  },
  {
    aisle: "Canned & Jarred", icon: "🥫",
    keywords: ["artichoke","canned corn","canned tomato","canned tuna","cannellini","crushed tomatoes","diced tomatoes","green chile","green olives","jalapeño","jalapeños","kidney beans","olives","pinto beans","roasted peppers","sun-dried tomato","tomato"],
  },
  {
    aisle: "Frozen", icon: "🧊",
    keywords: ["frozen broccoli","frozen corn","frozen peas","frozen spinach","frozen shrimp","ice cream","edamame","frozen","tater tots"],
  },
  {
    aisle: "Nuts, Seeds & Dried Fruit", icon: "🥜",
    keywords: ["almond","almonds","cashew","cashews","chia","cranberry","dried fruit","flaxseed","hemp seed","macadamia","peanut","peanuts","pecan","pecans","pistachio","poppy seed","pumpkin seed","raisin","raisins","sesame","sunflower seed","walnut","walnuts","pine nuts"],
  },
  {
    aisle: "Beverages", icon: "🧃",
    keywords: ["apple juice","beer","broth","coffee","coconut water","juice","lemonade","orange juice","soda","sparkling water","tea","water","wine","champagne","cider","kombucha","milk alternative","oat milk","almond milk","soy milk"],
  },
  {
    aisle: "Condiments & Sauces", icon: "🫙",
    keywords: ["barbecue sauce","bbq sauce","buffalo sauce","caesar dressing","dijon","dressing","guacamole","hummus","jam","jelly","pesto","pickle","pickles","ranch","relish","salsa","teriyaki","tzatziki"],
  },
  {
    aisle: "Herbs & Spices", icon: "🌿",
    keywords: ["allspice","anise","cardamom","cayenne","chives","coriander","dill","fennel seed","herbes","marjoram","nutmeg","saffron","sage","smoked paprika","star anise","tarragon","za'atar"],
  },
];

export const AISLE_ORDER = AISLE_MAP.map((a) => a.aisle).concat(["Other"]);

export function getAisle(name: string): string {
  const lower = name.toLowerCase().trim();
  let best = { aisle: "Other", len: 0 };
  for (const { aisle, keywords } of AISLE_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > best.len) {
        best = { aisle, len: kw.length };
      }
    }
  }
  return best.aisle;
}

// ─── Unit conversion ──────────────────────────────────────────────────────────

const TO_ML: Record<string, number> = {
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, liter: 1000, liters: 1000,
  tsp: 4.92, teaspoon: 4.92, teaspoons: 4.92,
  tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79,
  cup: 236.6, cups: 236.6,
  "fl oz": 29.57, floz: 29.57,
};

function mlToReadable(ml: number): { amount: number; unit: string } {
  if (ml >= 900) return { amount: Math.round((ml / 1000) * 10) / 10, unit: "l" };
  if (ml >= 60) return { amount: Math.round(ml / 14.79 * 10) / 10, unit: "tbsp" };
  if (ml >= 5) return { amount: Math.round(ml / 4.92 * 10) / 10, unit: "tsp" };
  return { amount: Math.round(ml), unit: "ml" };
}

// ─── Ingredient line parsing ──────────────────────────────────────────────────
//
// Single source of truth for turning a raw ingredient line (from a recipe or
// from manual entry) into { name, amount, unit }. A word is only treated as
// a unit if it's in KNOWN_UNITS, so lines like "6 green onions" or
// "4 tablespoons lemon pepper" keep their full name instead of having a word
// misread as the unit.

const KNOWN_UNITS = new Set([
  "g", "gram", "grams", "kg", "kilogram", "kilograms",
  "ml", "l", "liter", "liters", "litre", "litres",
  "tsp", "teaspoon", "teaspoons",
  "tbsp", "tablespoon", "tablespoons",
  "cup", "cups",
  "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "pinch", "pinches", "dash", "dashes",
  "clove", "cloves", "can", "cans", "jar", "jars",
  "package", "packages", "pkg",
  "bunch", "bunches", "head", "heads",
  "slice", "slices", "piece", "pieces",
  "stalk", "stalks", "sprig", "sprigs",
  "quart", "quarts", "pint", "pints", "gallon", "gallons",
  "fl oz", "floz",
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 1 / 4, "½": 1 / 2, "¾": 3 / 4,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5,
  "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8,
};

function parseAmountToken(token: string): number {
  const fracMatch = token.match(/^(\d*)([¼½¾⅓⅔⅕⅖⅗⅘⅛⅜⅝⅞])$/);
  if (fracMatch) {
    const whole = fracMatch[1] ? parseInt(fracMatch[1], 10) : 0;
    return whole + UNICODE_FRACTIONS[fracMatch[2]];
  }
  if (token.includes("/")) {
    const [n, d] = token.split("/").map(Number);
    return d ? n / d : parseFloat(token) || 0;
  }
  return parseFloat(token) || 0;
}

function parseAmount(raw: string): number {
  const total = raw
    .trim()
    .split(/\s+/)
    .reduce((sum, tok) => sum + parseAmountToken(tok), 0);
  return total || 1;
}

const AMOUNT_PREFIX = /^([\d./¼½¾⅓⅔⅕⅖⅗⅘⅛⅜⅝⅞]+(?:\s+[\d./¼½¾⅓⅔⅕⅖⅗⅘⅛⅜⅝⅞]+)?)\s+(.+)$/;

// Recipes very commonly write ranges like "1-2 pounds salmon" or "3-4
// cloves of garlic". The character class in AMOUNT_PREFIX has no "-", so
// without this step those lines fail to match AMOUNT_PREFIX entirely —
// the whole line (unit included) falls back to `{ amount: 1, unit: "" }`,
// which is silently wrong by however large the range is (e.g. treating
// "1-2 pounds of salmon" as a single ~170g fillet instead of ~680g).
// Expanding "X-Y" to its average up front lets the normal parsing path
// take over correctly, unit and all.
function expandLeadingRange(line: string): string {
  const rangeMatch = line.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\b/);
  if (!rangeMatch) return line;
  const avg = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
  return line.slice(0, rangeMatch.index) + avg + line.slice(rangeMatch.index! + rangeMatch[0].length);
}

export function parseIngredientLine(
  rawLine: string
): { name: string; amount: number; unit: string; hasExplicitAmount: boolean } {
  const line = expandLeadingRange(decodeEntities(rawLine).trim());
  const match = line.match(AMOUNT_PREFIX);
  // `hasExplicitAmount: false` signals this line had no parseable leading
  // quantity at all — used by macros.ts to distinguish a genuine
  // quantity-less ingredient ("salt to taste") from a stray fragment left
  // over from comma-splitting ("minced", "cut into wedges") that isn't
  // really a separate ingredient. See macros.ts for how that's used.
  if (!match) return { name: line, amount: 1, unit: "", hasExplicitAmount: false };

  const amount = parseAmount(match[1]);
  const rest = match[2].trim();
  const words = rest.split(/\s+/);
  const firstWord = words[0].toLowerCase();
  const firstTwoWords = words.slice(0, 2).join(" ").toLowerCase(); // catches "fl oz"

  if (words.length > 2 && KNOWN_UNITS.has(firstTwoWords)) {
    return { name: words.slice(2).join(" "), amount, unit: words.slice(0, 2).join(" "), hasExplicitAmount: true };
  }
  if (words.length > 1 && KNOWN_UNITS.has(firstWord)) {
    return { name: words.slice(1).join(" "), amount, unit: words[0], hasExplicitAmount: true };
  }
  return { name: rest, amount, unit: "", hasExplicitAmount: true };
}

// ─── Pantry staple detection ───────────────────────────────────────────────
//
// Recipes almost always list staples like salt, pepper, and olive oil with
// an explicit quantity ("1/2 tsp black pepper", "2 tbsp olive oil"). That
// quantity made them trip the "keep anything with a quantity" rule in
// toGroceryItems below unconditionally, so they always ended up on the
// list even though most people already have them on hand and don't want
// them added every time a recipe calls for them. This only ever applies to
// lines pulled in automatically from a recipe (fromRecipe set) — something
// a person manually types in, staple or not, is always kept as-is, since
// they clearly want it.

const STAPLE_DESCRIPTORS = [
  "freshly ground",
  "ground",
  "cracked",
  "fine grain",
  "fine",
  "coarse",
  "kosher",
  "sea",
  "table",
  "fresh",
  "extra virgin",
  "extra-virgin",
  "virgin",
  "pure",
  "granulated",
  "all purpose",
  "all-purpose",
];

function normalizeForStapleCheck(name: string): string {
  let n = name.toLowerCase().trim().replace(/[().]/g, "").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of STAPLE_DESCRIPTORS) {
      if (n.startsWith(`${d} `)) {
        n = n.slice(d.length + 1).trim();
        changed = true;
      }
    }
  }
  return n;
}

// Deliberately a short, conservative list of near-universal staples, and
// matched by exact phrase (after stripping descriptors like "ground" or
// "kosher") rather than substring — a substring match would wrongly catch
// things like "bell pepper" or "red pepper flakes" just for containing
// "pepper".
const PANTRY_STAPLES = new Set([
  "salt", "pepper", "black pepper", "white pepper", "peppercorns",
  "oil", "olive oil", "vegetable oil", "canola oil", "cooking oil",
  "cooking spray", "nonstick spray", "water", "sugar", "flour",
  "baking soda", "baking powder", "cornstarch", "garlic powder", "onion powder",
]);

export function isPantryStaple(name: string): boolean {
  return PANTRY_STAPLES.has(normalizeForStapleCheck(name));
}

export function splitIngredientLines(raw: string): string[] {
  // Split on commas/newlines, but never inside parentheses — recipe text
  // routinely has asides like "(optional, for color)" or "(I usually cut
  // it into pieces)" where an internal comma is NOT a new ingredient.
  // Splitting blindly on every comma chopped those asides into their own
  // "ingredient" lines (e.g. "for color)"), which then got treated as
  // real food.
  //
  // Deliberately does NOT try to merge or drop digit-less fragments here
  // (an earlier version did, merging things like ", minced" into the
  // previous line) — that approach could glue a genuinely separate
  // ingredient onto an unrelated neighbor's identity and quantity (e.g.
  // "6 slices bread, homemade mayonnaise" merging into one "ingredient"
  // whose keyword match picked mayonnaise's nutrition data but kept
  // bread's "6 slices" quantity, reporting ~600g of mayo). Every fragment
  // is kept here; each CONSUMER decides what to do with a fragment that
  // has no explicit quantity — see toGroceryItems below (a cheap,
  // synchronous, local-table-only check) and estimateMacrosPerServing in
  // macros.ts (a more accurate check that also tries USDA before giving
  // up on a fragment).
  const lines: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of raw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if ((ch === "," || ch === "\n") && depth === 0) {
      lines.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.filter(Boolean);
}

export function toGroceryItems(
  raw: string,
  opts?: { fromRecipe?: string; servingMultiplier?: number; isManualEntry?: boolean }
): GroceryItem[] {
  return splitIngredientLines(raw)
    .filter((line) => {
      // Anything the person typed in themselves is kept as-is, full stop —
      // including one-word entries like "napkins" or "vinegar" that don't
      // happen to be in our local food-recognition table. The
      // recognized-ingredient check further down exists only to drop
      // leftover prep-text fragments ("minced", "cut into wedges") that
      // survive comma-splitting a RECIPE's ingredient list; it was never
      // meant to gate what someone can manually add, and running it there
      // is what silently swallowed valid single-word manual entries.
      if (opts?.isManualEntry) return true;

      // Drop common pantry staples pulled in automatically from a recipe
      // (see isPantryStaple above for why this only applies here, not to
      // manual entries).
      if (opts?.fromRecipe) {
        const { name } = parseIngredientLine(line);
        if (isPantryStaple(name)) return false;
      }

      // Keep anything with its own quantity signal anywhere in the text
      // (covers "juice of 1 lemon" as well as "2 cloves garlic") OR
      // anything that matches a real ingredient in the local table even
      // without a quantity ("homemade mayonnaise", "salt to taste").
      // Only genuinely unrecognized, quantity-less fragments — almost
      // always leftover prep text that survived comma-splitting, like
      // "minced" or "cut into wedges" — get dropped. This can't check
      // USDA (this function has to stay synchronous — it's called
      // directly, not awaited, from several places), so an obscure real
      // ingredient not in the local table could still be dropped here;
      // that's a real but much narrower limitation than the previous
      // merge-based approach, which could corrupt an unrelated
      // ingredient's data instead of just omitting an uncommon one.
      if (HAS_QUANTITY_SIGNAL.test(line)) return true;
      const { name } = parseIngredientLine(line);
      return isRecognizedIngredient(name);
    })
    .map((line, i) => {
      const { name, amount, unit } = parseIngredientLine(line);
      return {
        id: `g_${Date.now()}_${i}`,
        name,
        amount,
        unit,
        checked: false,
        aisle: getAisle(name),
        addedFromRecipe: opts?.fromRecipe,
        servingMultiplier: opts?.servingMultiplier,
      };
    });
}

export function combineIngredients(existing: GroceryItem[], incoming: GroceryItem[]): GroceryItem[] {
  const result = [...existing];
  for (const inc of incoming) {
    const incLower = inc.name.toLowerCase().trim();
    const idx = result.findIndex((e) => e.name.toLowerCase().trim() === incLower);
    if (idx === -1) {
      result.push({ ...inc });
    } else {
      const ex = result[idx];
      const exUnit = ex.unit.toLowerCase().trim();
      const incUnit = inc.unit.toLowerCase().trim();
      if (exUnit === incUnit) {
        result[idx] = { ...ex, amount: Math.round((ex.amount + inc.amount) * 100) / 100 };
      } else if (TO_ML[exUnit] && TO_ML[incUnit]) {
        const totalMl = ex.amount * TO_ML[exUnit] + inc.amount * TO_ML[incUnit];
        const readable = mlToReadable(totalMl);
        result[idx] = { ...ex, amount: readable.amount, unit: readable.unit };
      } else {
        result.push({ ...inc, id: `${inc.id}_${Date.now()}` });
      }
    }
  }
  return result;
}

// ─── useGrocerySync (canonical grocery state manager) ────────────────────────

export function useGrocerySync() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [status, setStatus] = useState<SyncStatus>("synced");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  // The owner-side sharing permission for this list (i.e. what level of
  // access anyone who opens the share link gets). Previously this wasn't
  // tracked here at all — grocery.tsx kept its own local useState that
  // reset to "view" on every mount and never reached Supabase, which is
  // why toggling the Share modal's switch appeared to do nothing.
  const [permission, setPermission] = useState<SharePermission>("view");

  // Diagnostics
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);
  const [lastOperation, setLastOperation] = useState<string | null>(null);

  const rowIdRef = useRef<string | null>(null);
  // Mirrors `items` synchronously (not subject to React batching), so any
  // handler can always compute the *next* list off the latest known state
  // even if several mutations fire back-to-back before a re-render commits.
  const itemsRef = useRef<GroceryItem[]>([]);
  // True while a save() is persisting to Supabase. Guards load() from
  // clobbering a very-recent local mutation with a remote row that may not
  // reflect it yet (e.g. focus-triggered load right after a delete).
  const savingRef = useRef(false);

  const setActiveRowId = useCallback((id: string | null) => {
    rowIdRef.current = id;
    setRowId(id);
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setErrorCode(null);
    setErrorDetails(null);
  }, []);

  const recordSupabaseError = useCallback(
    (operation: string, error: any) => {
      const message = error?.message ?? "Unknown Supabase error";
      const code = error?.code ?? null;
      const details = error?.details ?? error?.hint ?? null;

      setLastOperation(operation);
      setErrorMessage(message);
      setErrorCode(code);
      setErrorDetails(details);
      setStatus("error");

      console.error(`GROCERY SUPABASE ERROR: ${operation}`, error);

      return error;
    },
    []
  );

  // ─────────────────────────────────────────────────────────────
  // LOAD GROCERY LIST
  // ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    clearError();
    setLastOperation("Loading grocery list");

    try {
      const local = await AsyncStorage.getItem(GROCERY_LOCAL_KEY);

      if (local) {
        const parsed: GroceryItem[] = JSON.parse(local);
        if (!savingRef.current) {
          itemsRef.current = parsed;
          setItems(parsed);
        }
      }
    } catch (error: any) {
      console.error("GROCERY LOCAL LOAD ERROR:", error);

      setErrorMessage(
        `Local storage error: ${
          error?.message ?? "Unable to read local grocery list"
        }`
      );
    }

    setStatus("syncing");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        recordSupabaseError("Get authenticated user", authError);
        return;
      }

      const currentUserId = user?.id ?? null;

      setUserId(currentUserId);

      if (!currentUserId) {
        setStatus("offline");
        setLastOperation("No authenticated user");

        setErrorMessage(
          "No authenticated Supabase user was found. The grocery list is currently local-only."
        );

        return;
      }

      // ── PRIMARY LOOKUP: by owner_id + is_default, not by cached row id ──
      // The AsyncStorage-cached row id (GROCERY_ROW_KEY) is a write-through
      // cache/fast-path only. It must never be the sole way of finding a
      // person's list: settings.tsx's sign-out flow clears this exact key,
      // and if it were the source of truth, signing back in as the same
      // owner would look like "no list yet" and silently insert a second,
      // empty row while the real one (still is_default: true) sits
      // orphaned in Supabase forever. Alexa's webhook also resolves the
      // list by owner_id + is_default, so this keeps the app and Alexa
      // pointed at the same row.
      //
      // .order + .limit(1) instead of .single()/.maybeSingle() so this
      // doesn't throw if a prior occurrence of this exact bug already left
      // more than one is_default: true row for this owner — it just picks
      // the most recently updated one. That does NOT retroactively merge
      // or clean up any such duplicate rows; that requires a one-time
      // manual data fix, not something this hook should attempt silently.
      setLastOperation(`Looking up grocery list for owner ${currentUserId}`);

      const { data: ownerRows, error: ownerLookupError } = await supabase
        .from("grocery_lists")
        .select("id, items, share_token, name, owner_id, permission, is_default")
        .eq("owner_id", currentUserId)
        .eq("is_default", true)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (ownerLookupError) {
        recordSupabaseError("Look up grocery list by owner", ownerLookupError);
        return;
      }

      const ownerRow = ownerRows && ownerRows.length > 0 ? ownerRows[0] : null;

      if (ownerRow) {
        // Found the person's real row. Heal the cached row id — it may have
        // been missing (wiped on sign-out), stale, or never set — so future
        // loads/saves can use it as a fast path again.
        setActiveRowId(ownerRow.id);
        await AsyncStorage.setItem(GROCERY_ROW_KEY, ownerRow.id);

        const remoteItems: GroceryItem[] = ownerRow.items ?? [];

        // A save() may have started (or completed) after this fetch was
        // issued but before it resolved. Don't stomp on it with a remote
        // snapshot that could be stale relative to the in-flight write.
        if (!savingRef.current) {
          itemsRef.current = remoteItems;
          setItems(remoteItems);
          await AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(remoteItems));
        }

        setShareToken(ownerRow.share_token ?? null);
        setName(ownerRow.name ?? null);
        setOwnerId(ownerRow.owner_id ?? null);
        setIsOwner(true);
        setPermission((ownerRow.permission ?? "view") as SharePermission);

        setStatus("synced");
        setLastOperation("Loaded grocery list successfully");

        return;
      }

      // No is_default row exists for this owner at all — genuinely a new
      // user (or first sync ever). Only now do we create one, with
      // is_default explicitly true, since this will be the only
      // grocery_lists row for this owner_id.
      setLastOperation("Creating new grocery list");

      const local = await AsyncStorage.getItem(GROCERY_LOCAL_KEY);
      const localItems: GroceryItem[] = local ? JSON.parse(local) : [];

      const { data: newRow, error: insertError } = await supabase
        .from("grocery_lists")
        .insert({ owner_id: currentUserId, items: localItems, is_default: true })
        .select("id, share_token, name, owner_id, permission")
        .single();

      if (insertError) {
        recordSupabaseError("Create new grocery list", insertError);
        return;
      }

      if (newRow) {
        setActiveRowId(newRow.id);
        setShareToken(newRow.share_token ?? null);
        setName(newRow.name ?? null);
        setOwnerId(newRow.owner_id ?? null);
        setIsOwner(newRow.owner_id === currentUserId);
        setPermission((newRow.permission ?? "view") as SharePermission);

        await AsyncStorage.setItem(GROCERY_ROW_KEY, newRow.id);

        setLastOperation(`Created grocery list ${newRow.id}`);
      }

      setStatus("synced");
    } catch (error: any) {
      console.error("GROCERY LOAD EXCEPTION:", error);

      setStatus("offline");
      setLastOperation("Unexpected grocery sync error");
      setErrorMessage(error?.message ?? "Unexpected error while syncing grocery list");
      setErrorCode(error?.code ?? null);
      setErrorDetails(error?.details ?? null);
    }
  }, [clearError, recordSupabaseError, setActiveRowId]);

  // ─────────────────────────────────────────────────────────────
  // SAVE GROCERY LIST
  // ─────────────────────────────────────────────────────────────

  const save = useCallback(
    async (updated: GroceryItem[]): Promise<boolean> => {
      savingRef.current = true;

      // Update the ref synchronously so a subsequent mutation call (even
      // one fired before this render commits) sees the up-to-date list.
      itemsRef.current = updated;
      setItems(updated);

      try {
        await AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(updated));
      } catch (localError) {
        console.error("GROCERY LOCAL SAVE ERROR:", localError);
      }

      const activeRowId = rowIdRef.current;

      if (!activeRowId) {
        setLastOperation("Saved locally — no Supabase row ID available");
        setStatus("offline");
        savingRef.current = false;
        // Nothing remote to fail — local-only mode is a legitimate,
        // fully-persisted state here, not an error.
        return true;
      }

      setStatus("syncing");
      setLastOperation(`Updating grocery row ${activeRowId}`);

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          recordSupabaseError("Get user before grocery save", authError);
          return false;
        }

        const currentUserId = user?.id ?? null;

        setUserId(currentUserId);

        if (!currentUserId) {
          setStatus("offline");
          setErrorMessage("Cannot save to Supabase because no authenticated user was found.");
          setLastOperation("Save failed — no authenticated user");
          return false;
        }

        const { data: rowCheck, error: rowCheckError } = await supabase
          .from("grocery_lists")
          .select("id, owner_id, items")
          .eq("id", activeRowId)
          .single();

        if (rowCheckError) {
          recordSupabaseError("Check grocery row before save", rowCheckError);
          setErrorMessage(`Could not find grocery row: ${rowCheckError.message}`);
          setLastOperation(`Failed to find grocery row ${activeRowId}`);
          return false;
        }

        const owner = rowCheck.owner_id === currentUserId;

        setOwnerId(rowCheck.owner_id ?? null);
        setIsOwner(owner);

        if (!owner) {
          setStatus("error");
          setErrorMessage("You are not the owner of this grocery list.");
          setLastOperation("Save blocked — authenticated user is not the row owner");
          return false;
        }

        const { data: savedRow, error: updateError } = await supabase
          .from("grocery_lists")
          .update({ items: updated, updated_at: new Date().toISOString() })
          .eq("id", activeRowId)
          .eq("owner_id", currentUserId)
          .select("id, owner_id, items, updated_at")
          .single();

        if (updateError) {
          recordSupabaseError("Update grocery list", updateError);
          setErrorMessage(`Supabase save failed: ${updateError.message}`);
          setLastOperation(`Supabase update failed for row ${activeRowId}`);
          return false;
        }

        if (!savedRow) {
          setStatus("error");
          setErrorMessage("Supabase accepted the request but returned no saved grocery row.");
          setLastOperation("Save failed — no row returned after update");
          return false;
        }

        const savedItems = (savedRow.items ?? []) as GroceryItem[];

        if (JSON.stringify(savedItems) !== JSON.stringify(updated)) {
          setStatus("error");
          setErrorMessage("Supabase returned data that does not match the grocery items that were saved.");
          setLastOperation("Save mismatch — Supabase data differs from local data");

          console.error("GROCERY SAVE MISMATCH", {
            rowId: activeRowId,
            expected: updated,
            actual: savedItems,
          });

          return false;
        }

        setStatus("synced");
        clearError();
        setLastOperation(`Successfully saved ${updated.length} items to Supabase`);
        return true;
      } catch (error: any) {
        console.error("GROCERY SAVE EXCEPTION:", error);

        setStatus("offline");
        setErrorMessage(error?.message ?? "Unknown error while saving grocery list");
        setLastOperation("Grocery save failed with an unexpected error");
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [clearError, recordSupabaseError]
  );

  // ─────────────────────────────────────────────────────────────
  // ADD INGREDIENTS (canonical mutation used by grocery.tsx and plan.tsx)
  // ─────────────────────────────────────────────────────────────

  const addIngredients = useCallback(
    async (raw: string, opts?: { fromRecipe?: string; servingMultiplier?: number; isManualEntry?: boolean }) => {
      const incoming = toGroceryItems(raw, opts);
      const combined = combineIngredients(itemsRef.current, incoming);
      await save(combined);
    },
    [save]
  );

  // ─────────────────────────────────────────────────────────────
  // DELETE / TOGGLE / EDIT a single item (race-safe: computed off
  // itemsRef, not the React `items` closure, so rapid consecutive taps
  // never overwrite each other's result)
  // ─────────────────────────────────────────────────────────────

  const deleteItem = useCallback(
    async (id: string): Promise<boolean> => {
      const previous = itemsRef.current;
      const updated = previous.filter((it) => it.id !== id);
      const ok = await save(updated);
      if (!ok) {
        // The remote save failed, so keeping the optimistic local removal
        // would just get silently undone the next time load() runs (e.g.
        // on screen focus), with no indication anything went wrong. Roll
        // back immediately instead so the UI stays consistent with what's
        // actually persisted, and let the caller inform the user.
        itemsRef.current = previous;
        setItems(previous);
      }
      return ok;
    },
    [save]
  );

  const toggleItem = useCallback(
    async (id: string): Promise<boolean> => {
      const previous = itemsRef.current;
      const updated = previous.map((it) =>
        it.id === id ? { ...it, checked: !it.checked, checkedAt: Date.now() } : it
      );
      const ok = await save(updated);
      if (!ok) {
        itemsRef.current = previous;
        setItems(previous);
      }
      return ok;
    },
    [save]
  );

  const updateItemAmount = useCallback(
    async (id: string, amount: number): Promise<boolean> => {
      const previous = itemsRef.current;
      const updated = previous.map((it) =>
        it.id === id ? { ...it, amount } : it
      );
      const ok = await save(updated);
      if (!ok) {
        itemsRef.current = previous;
        setItems(previous);
      }
      return ok;
    },
    [save]
  );

  // ─────────────────────────────────────────────────────────────
  // RENAME GROCERY LIST
  // ─────────────────────────────────────────────────────────────

  const rename = useCallback(
    async (newName: string) => {
      const trimmed = newName.trim();

      setName(trimmed || null);

      const activeRowId = rowIdRef.current;

      if (!activeRowId) {
        return;
      }

      try {
        const { error } = await supabase
          .from("grocery_lists")
          .update({ name: trimmed || null })
          .eq("id", activeRowId);

        if (error) {
          recordSupabaseError("Rename grocery list", error);
          return;
        }

        setLastOperation("Grocery list renamed");
      } catch (error: any) {
        recordSupabaseError("Rename grocery list", error);
      }
    },
    [recordSupabaseError]
  );

  // ─────────────────────────────────────────────────────────────
  // SET SHARE PERMISSION
  // ─────────────────────────────────────────────────────────────
  //
  // Previously there was no way to persist this at all: grocery.tsx kept
  // its own local `sharePermission` useState, which the Share modal's
  // toggle wrote to, but that state was never sent to Supabase and reset
  // to "view" on every remount. This mirrors usePlanSync's
  // setSharePermission — it updates the owner-side `permission` column on
  // the grocery_lists row, which useSharedGrocerySync's realtime
  // subscription (see below) now also re-reads so already-open viewers
  // pick up the change without needing to rejoin via the link.

  const setSharePermission = useCallback(
    async (perm: SharePermission) => {
      setPermission(perm);

      const activeRowId = rowIdRef.current;

      if (!activeRowId) {
        return;
      }

      try {
        const { error } = await supabase
          .from("grocery_lists")
          .update({ permission: perm })
          .eq("id", activeRowId);

        if (error) {
          recordSupabaseError("Update grocery list permission", error);
          return;
        }

        setLastOperation(`Grocery list permission set to ${perm}`);
      } catch (error: any) {
        recordSupabaseError("Update grocery list permission", error);
      }
    },
    [recordSupabaseError]
  );

  // ─────────────────────────────────────────────────────────────
  // RETURN
  // ─────────────────────────────────────────────────────────────

  return {
    items,
    status,
    shareToken,
    name,
    permission,

    save,
    load,
    rename,
    setSharePermission,
    addIngredients,
    deleteItem,
    toggleItem,
    updateItemAmount,

    // Diagnostics
    errorMessage,
    errorCode,
    errorDetails,
    userId,
    ownerId,
    isOwner,
    rowId,
    lastOperation,
  };
}

// ─── Shared (view/edit) Grocery Sync ─────────────────────────────────────────
//
// Mirrors useGrocerySync's mutation surface (save/addIngredients/deleteItem/
// rename), scoped to the row identified by share_token instead of owner_id,
// and gated by the row's `permission` column rather than ownership. Added
// itemsRef (mirroring useGrocerySync) so addIngredients/deleteItem compute
// off the latest known list rather than a possibly-stale `items` closure,
// and save() now returns a real boolean so callers (the shared list screen)
// can tell success from failure instead of always getting `undefined`.
//
// NOTE: `rowId` is now tracked as real state (not just a ref). Refs don't
// trigger re-renders when mutated, so a `useEffect` dependency array of
// `[rowIdRef.current]` never actually reruns when the ref changes — it only
// reruns on unrelated re-renders. Combined with React Strict Mode / Fast
// Refresh double-invoking effects, this could re-run the realtime
// subscription effect while the previous `removeChannel()` call for the
// same channel name was still in flight, causing Supabase to hand back the
// same already-subscribed channel object and throw "cannot add
// postgres_changes callbacks ... after subscribe()" when `.on()` was called
// on it again. Using real state for `rowId` makes the effect dependency
// meaningful and keeps subscribe/unsubscribe cycles properly ordered.

export function useSharedGrocerySync(token: string | undefined) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const rowIdRef = useRef<string | null>(null);
  const itemsRef = useRef<GroceryItem[]>([]);
  const permissionRef = useRef<SharePermission>("view");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setStatus("syncing");
      try {
        const { data, error } = await supabase
          .from("grocery_lists")
          .select("id, items, permission, name")
          .eq("share_token", token)
          .single();

        if (cancelled) return;

        if (error || !data) {
          setNotFound(true);
          setStatus("error");
          return;
        }

        rowIdRef.current = data.id;
        setRowId(data.id);
        const loadedItems: GroceryItem[] = data.items ?? [];
        itemsRef.current = loadedItems;
        setItems(loadedItems);
        const loadedPermission = (data.permission ?? "view") as SharePermission;
        permissionRef.current = loadedPermission;
        setPermission(loadedPermission);
        setName(data.name ?? null);
        setStatus("synced");

        const userId = await getUserId();
        if (userId) {
          supabase
            .from("grocery_list_members")
            .upsert(
              { list_id: data.id, user_id: userId, permission: data.permission ?? "view" },
              { onConflict: "list_id,user_id" }
            )
            .then(() => {});
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setStatus("error");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!rowId) return;
    const channel = supabase
      .channel(`shared_grocery_${rowId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "grocery_lists", filter: `id=eq.${rowId}` },
        (payload) => {
          const remoteItems: GroceryItem[] = (payload.new as any).items ?? [];
          // Previously only `items` was re-read here, so a viewer who had
          // already opened the link kept whichever permission they joined
          // with forever — the owner flipping view/edit afterward never
          // reached them without a fresh page load. Re-read `permission`
          // off the same UPDATE payload so it updates live alongside items.
          const remotePermission = (payload.new as any).permission as SharePermission | undefined;
          itemsRef.current = remoteItems;
          setItems(remoteItems);
          if (remotePermission) {
            permissionRef.current = remotePermission;
            setPermission(remotePermission);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowId]);

  const save = useCallback(async (updated: GroceryItem[]): Promise<boolean> => {
    itemsRef.current = updated;
    setItems(updated);

    try {
      await AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(updated));
    } catch (localError) {
      console.error("Failed to save grocery list locally:", localError);
    }

    if (!rowIdRef.current) {
      console.warn("No grocery row ID available. Saved locally only.");
      // Nothing remote to fail against — treat as success, matching
      // useGrocerySync's local-only fallback.
      return true;
    }

    setStatus("syncing");

    try {
      const { error } = await supabase
        .from("grocery_lists")
        .update({ items: updated, updated_at: new Date().toISOString() })
        .eq("id", rowIdRef.current);

      if (error) {
        console.error("Failed to save grocery list to Supabase:", error);
        setStatus("error");
        return false;
      }

      setStatus("synced");
      return true;
    } catch (error) {
      console.error("Unexpected grocery sync error:", error);
      setStatus("offline");
      return false;
    }
  }, []);

  // Mirrors useGrocerySync's addIngredients: parses + merges off the
  // latest known list. No-ops (returns false) for view-only visitors —
  // Supabase RLS should also enforce this, but this avoids a wasted round
  // trip and keeps the UI's error path consistent.
  const addIngredients = useCallback(
    async (raw: string, opts?: { fromRecipe?: string; servingMultiplier?: number; isManualEntry?: boolean }): Promise<boolean> => {
      if (permissionRef.current !== "edit") return false;
      const incoming = toGroceryItems(raw, opts);
      const combined = combineIngredients(itemsRef.current, incoming);
      return save(combined);
    },
    [save]
  );

  // Mirrors useGrocerySync's deleteItem: race-safe (computed off itemsRef)
  // with an optimistic-rollback on failure so the UI never shows an item
  // as deleted when it wasn't actually persisted.
  const deleteItem = useCallback(
    async (id: string): Promise<boolean> => {
      if (permissionRef.current !== "edit") return false;
      const previous = itemsRef.current;
      const updated = previous.filter((it) => it.id !== id);
      const ok = await save(updated);
      if (!ok) {
        itemsRef.current = previous;
        setItems(previous);
      }
      return ok;
    },
    [save]
  );

  const rename = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    setName(trimmed || null);
    if (!rowIdRef.current || permissionRef.current !== "edit") return;
    try {
      await supabase
        .from("grocery_lists")
        .update({ name: trimmed || null })
        .eq("id", rowIdRef.current);
    } catch {}
  }, []);

  return { items, status, permission, notFound, name, save, addIngredients, deleteItem, rename };
}

// ─── Recipe Sync ──────────────────────────────────────────────────────────────
//
// This is the canonical, Supabase-backed store for "My Dinners" personal
// recipes. roulette.tsx, plan.tsx, and spin.tsx all read/write recipes
// through this hook rather than touching AsyncStorage directly, so that
// recipes survive sign-out/sign-in (the `recipes` table is keyed by the
// stable Supabase `user_id`, unlike the local-only cache which the sign-out
// flow in settings.tsx intentionally clears).

const RECIPE_LOCAL_KEY = "@recipe_roulette_personal";
const RECIPE_ROW_PREFIX = "@recipe_roulette_supabase_id_";

export function useRecipeSync() {
  const [recipes, setRecipes] = useState<PersonalRecipe[]>([]);
  const [status, setStatus] = useState<SyncStatus>("synced");

  const load = useCallback(async () => {
    try {
      const local = await AsyncStorage.getItem(RECIPE_LOCAL_KEY);
      if (local) setRecipes(JSON.parse(local));
    } catch {}

    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const { data, error } = await supabase
        .from("recipes")
        .select("id, data")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        const remoteRecipes: PersonalRecipe[] = data.map((r) => r.data as PersonalRecipe);
        setRecipes(remoteRecipes);
        await AsyncStorage.setItem(RECIPE_LOCAL_KEY, JSON.stringify(remoteRecipes));
      }
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, []);

  const save = useCallback(async (recipe: PersonalRecipe) => {
    const existing = recipes.findIndex((r) => r.id === recipe.id);
    const updated = existing !== -1
      ? recipes.map((r) => (r.id === recipe.id ? recipe : r))
      : [...recipes, recipe];

    setRecipes(updated);
    await AsyncStorage.setItem(RECIPE_LOCAL_KEY, JSON.stringify(updated));

    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const rowKey = RECIPE_ROW_PREFIX + recipe.id;
      let storedRowId = await AsyncStorage.getItem(rowKey);

      // The cached row ID can be missing even though a Supabase row for
      // this recipe already exists — e.g. a fresh install, a second
      // device, or any cache clear that isn't sign-out (sign-out doesn't
      // wipe these specific keys today, but nothing should depend on that
      // staying true). Blindly inserting in that case would silently
      // create a duplicate row instead of updating the real one, so when
      // there's no cached ID, look the row up by owner + the recipe's own
      // `id` field (stored inside `data`) before deciding to insert.
      if (!storedRowId) {
        const { data: found } = await supabase
          .from("recipes")
          .select("id")
          .eq("user_id", userId)
          .eq("data->>id", recipe.id)
          .maybeSingle();

        if (found) {
          storedRowId = found.id;
          await AsyncStorage.setItem(rowKey, found.id);
        }
      }

      if (storedRowId) {
        const { error } = await supabase
          .from("recipes")
          .update({ data: recipe, updated_at: new Date().toISOString() })
          .eq("id", storedRowId);

        if (error) {
          // The cached ID we had was stale (e.g. the row was deleted out
          // from under us). Clear it so the next save re-resolves via the
          // owner+id lookup above instead of failing against a dead row
          // forever.
          await AsyncStorage.removeItem(rowKey);
        }
      } else {
        const { data: newRow, error } = await supabase
          .from("recipes")
          .insert({ user_id: userId, data: recipe })
          .select("id")
          .single();
        if (!error && newRow) await AsyncStorage.setItem(rowKey, newRow.id);
      }
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, [recipes]);

  const remove = useCallback(async (id: string) => {
    const updated = recipes.filter((r) => r.id !== id);
    setRecipes(updated);
    await AsyncStorage.setItem(RECIPE_LOCAL_KEY, JSON.stringify(updated));

    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const rowKey = RECIPE_ROW_PREFIX + id;
      let storedRowId = await AsyncStorage.getItem(rowKey);

      // Same fallback as save(): if the cached row ID is missing, don't
      // just silently no-op and leave an orphaned row in Supabase — look
      // it up by owner + recipe id first.
      if (!storedRowId) {
        const { data: found } = await supabase
          .from("recipes")
          .select("id")
          .eq("user_id", userId)
          .eq("data->>id", id)
          .maybeSingle();
        if (found) storedRowId = found.id;
      }

      if (storedRowId) {
        await supabase.from("recipes").delete().eq("id", storedRowId);
        await AsyncStorage.removeItem(rowKey);
      }
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, [recipes]);

  useEffect(() => { load(); }, [load]);

  return { recipes, status, load, save, remove };
}

// ─── Meal Plan Sync ───────────────────────────────────────────────────────────

const PLAN_LOCAL_KEY = "@recipe_roulette_plan";
const PLAN_ROW_KEY = "@recipe_roulette_plan_row_id";

export function usePlanSync() {
  const [plan, setPlan] = useState<MealPlan>({});
  const [status, setStatus] = useState<SyncStatus>("synced");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [permission, setPermission] = useState<SharePermission>("view");
  const [name, setName] = useState<string | null>(null);
  // Tracked as real state (in addition to the ref) so the realtime
  // subscription effect below has a dependency that actually changes on
  // re-render. See the note above useSharedGrocerySync for why a
  // ref-only dependency (`[rowIdRef.current]`) doesn't reliably rerun the
  // effect and can cause "cannot add postgres_changes callbacks ... after
  // subscribe()" under Strict Mode / Fast Refresh double-invocation.
  const [rowId, setRowId] = useState<string | null>(null);
  const rowIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const local = await AsyncStorage.getItem(PLAN_LOCAL_KEY);
      if (local) setPlan(JSON.parse(local));
    } catch {}

    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      // ── PRIMARY LOOKUP: by owner_id, not by cached row id ──────────────
      // Same fix as useGrocerySync().load(): the cached PLAN_ROW_KEY is
      // wiped on sign-out (see settings.tsx), and if it were the only way
      // load() could find a person's plan, signing back in as the same
      // owner would look like "no plan yet" and silently insert a brand
      // new empty row while the real one sits orphaned in Supabase. There's
      // no is_default concept on meal_plans (one row per owner), so this is
      // just an owner_id lookup, picking the most recently updated row if
      // more than one somehow exists for this owner (this does not merge
      // or clean up any such duplicates — that would need a manual fix).
      const { data: ownerRows, error: ownerLookupError } = await supabase
        .from("meal_plans")
        .select("id, slots, share_token, permission, name")
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      const ownerRow = !ownerLookupError && ownerRows && ownerRows.length > 0 ? ownerRows[0] : null;

      if (ownerRow) {
        // Found the person's real plan row. Heal the cached row id in case
        // it was missing, stale, or never set.
        rowIdRef.current = ownerRow.id;
        setRowId(ownerRow.id);
        await AsyncStorage.setItem(PLAN_ROW_KEY, ownerRow.id);

        setPlan(ownerRow.slots ?? {});
        setShareToken(ownerRow.share_token);
        setPermission(ownerRow.permission as SharePermission);
        setName(ownerRow.name ?? null);
        await AsyncStorage.setItem(PLAN_LOCAL_KEY, JSON.stringify(ownerRow.slots ?? {}));
        setStatus("synced");
        return;
      }

      // No plan row exists for this owner at all — genuinely new. Only now
      // do we create one.
      const local = await AsyncStorage.getItem(PLAN_LOCAL_KEY);
      const localPlan: MealPlan = local ? JSON.parse(local) : {};
      const { data: newRow } = await supabase
        .from("meal_plans")
        .insert({ owner_id: userId, slots: localPlan, permission: "view" })
        .select("id, share_token, name")
        .single();

      if (newRow) {
        rowIdRef.current = newRow.id;
        setRowId(newRow.id);
        setShareToken(newRow.share_token);
        setName(newRow.name ?? null);
        await AsyncStorage.setItem(PLAN_ROW_KEY, newRow.id);
      }
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, []);

  const save = useCallback(async (updated: MealPlan) => {
    setPlan(updated);
    await AsyncStorage.setItem(PLAN_LOCAL_KEY, JSON.stringify(updated));
    if (!rowIdRef.current) return;
    setStatus("syncing");
    try {
      await supabase
        .from("meal_plans")
        .update({ slots: updated, updated_at: new Date().toISOString() })
        .eq("id", rowIdRef.current);
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, []);

  const setSharePermission = useCallback(async (perm: SharePermission) => {
    setPermission(perm);
    if (!rowIdRef.current) return;
    try {
      await supabase
        .from("meal_plans")
        .update({ permission: perm })
        .eq("id", rowIdRef.current);
    } catch {}
  }, []);

  const loadShared = useCallback(async (token: string) => {
    setStatus("syncing");
    try {
      const { data, error } = await supabase
        .from("meal_plans")
        .select("id, slots, share_token, permission")
        .eq("share_token", token)
        .single();

      if (!error && data) {
        rowIdRef.current = data.id;
        setRowId(data.id);
        setPlan(data.slots ?? {});
        setShareToken(data.share_token);
        setPermission(data.permission as SharePermission);
        setStatus("synced");
        return data.permission as SharePermission;
      }
    } catch {}
    setStatus("error");
    return null;
  }, []);

  useEffect(() => {
    if (!rowId) return;
    const channel = supabase
      .channel(`plan_${rowId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "meal_plans", filter: `id=eq.${rowId}` },
        (payload) => {
          const remoteSlots: MealPlan = (payload.new as any).slots ?? {};
          setPlan(remoteSlots);
          AsyncStorage.setItem(PLAN_LOCAL_KEY, JSON.stringify(remoteSlots));
          setStatus("synced");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowId]);

  useEffect(() => { load(); }, [load]);

  const rename = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    setName(trimmed || null);
    if (!rowIdRef.current) return;
    try {
      await supabase
        .from("meal_plans")
        .update({ name: trimmed || null })
        .eq("id", rowIdRef.current);
    } catch {}
  }, []);

  return { plan, status, shareToken, permission, name, save, load, loadShared, setSharePermission, rename };
}

// ─── Shared (read-only viewer) Meal Plan Sync ────────────────────────────────

export function useSharedPlanSync(token: string | undefined) {
  const [plan, setPlan] = useState<MealPlan>({});
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState<string | null>(null);
  // Same real-state fix as usePlanSync/useSharedGrocerySync — see the note
  // above useSharedGrocerySync for the full explanation of why a
  // ref-only effect dependency isn't safe here.
  const [rowId, setRowId] = useState<string | null>(null);
  const rowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setStatus("syncing");
      try {
        const { data, error } = await supabase
          .from("meal_plans")
          .select("id, slots, permission, name")
          .eq("share_token", token)
          .single();

        if (cancelled) return;

        if (error || !data) {
          setNotFound(true);
          setStatus("error");
          return;
        }

        rowIdRef.current = data.id;
        setRowId(data.id);
        setPlan(data.slots ?? {});
        setPermission((data.permission ?? "view") as SharePermission);
        setName(data.name ?? null);
        setStatus("synced");

        const userId = await getUserId();
        if (userId) {
          supabase
            .from("plan_members")
            .upsert(
              { plan_id: data.id, user_id: userId, permission: data.permission ?? "view" },
              { onConflict: "plan_id,user_id" }
            )
            .then(() => {});
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setStatus("error");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!rowId) return;
    const channel = supabase
      .channel(`shared_plan_${rowId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "meal_plans", filter: `id=eq.${rowId}` },
        (payload) => {
          const remoteSlots: MealPlan = (payload.new as any).slots ?? {};
          // Previously only `slots` was re-read here, so a viewer who had
          // already opened the link kept whichever permission they joined
          // with forever — the owner flipping the Share modal's switch
          // never reached them without closing and reopening from a fresh
          // link. Re-read `permission` off the same UPDATE payload so it
          // updates live alongside the plan contents.
          const remotePermission = (payload.new as any).permission as SharePermission | undefined;
          setPlan(remoteSlots);
          if (remotePermission) setPermission(remotePermission);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowId]);

  const save = useCallback(async (updated: MealPlan) => {
    setPlan(updated);
    if (!rowIdRef.current || permission !== "edit") return;
    try {
      await supabase
        .from("meal_plans")
        .update({ slots: updated, updated_at: new Date().toISOString() })
        .eq("id", rowIdRef.current);
    } catch {}
  }, [permission]);

  const rename = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    setName(trimmed || null);
    if (!rowIdRef.current || permission !== "edit") return;
    try {
      await supabase
        .from("meal_plans")
        .update({ name: trimmed || null })
        .eq("id", rowIdRef.current);
    } catch {}
  }, [permission]);

  return { plan, status, permission, notFound, name, save, rename };
}

// ─── "Shared With Me" ─────────────────────────────────────────────────────────

export type SharedWithMePlan = {
  planId: string;
  shareToken: string;
  permission: SharePermission;
  joinedAt: string;
  name: string | null;
};

export function useSharedWithMePlans() {
  const [plans, setPlans] = useState<SharedWithMePlan[]>([]);
  const [status, setStatus] = useState<SyncStatus>("syncing");

  const load = useCallback(async () => {
    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const { data, error } = await supabase
        .from("plan_members")
        .select("plan_id, permission, joined_at, meal_plans(share_token, name)")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false });

      if (!error && data) {
        const mapped: SharedWithMePlan[] = data
          .filter((row: any) => row.meal_plans?.share_token)
          .map((row: any) => ({
            planId: row.plan_id,
            shareToken: row.meal_plans.share_token,
            permission: row.permission as SharePermission,
            joinedAt: row.joined_at,
            name: row.meal_plans.name ?? null,
          }));
        setPlans(mapped);
        setStatus("synced");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { plans, status, reload: load };
}

export type SharedWithMeGroceryList = {
  listId: string;
  shareToken: string;
  permission: SharePermission;
  joinedAt: string;
  name: string | null;
};

export function useSharedWithMeGroceryLists() {
  const [lists, setLists] = useState<SharedWithMeGroceryList[]>([]);
  const [status, setStatus] = useState<SyncStatus>("syncing");

  const load = useCallback(async () => {
    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const { data, error } = await supabase
        .from("grocery_list_members")
        .select("list_id, permission, joined_at, grocery_lists(share_token, name)")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false });

      if (!error && data) {
        const mapped: SharedWithMeGroceryList[] = data
          .filter((row: any) => row.grocery_lists?.share_token)
          .map((row: any) => ({
            listId: row.list_id,
            shareToken: row.grocery_lists.share_token,
            permission: row.permission as SharePermission,
            joinedAt: row.joined_at,
            name: row.grocery_lists.name ?? null,
          }));
        setLists(mapped);
        setStatus("synced");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { lists, status, reload: load };
}
