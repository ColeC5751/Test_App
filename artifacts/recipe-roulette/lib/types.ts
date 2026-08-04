// ─── Shared Types ─────────────────────────────────────────────────────────────
// Single source of truth for all data shapes across the app.
// Import from here rather than defining locally in each tab.

export interface GroceryItem {
  id: string;
  name: string;
  amount: number;
  unit: string;
  checked: boolean;
  aisle: string;
  checkedAt?: number;       // timestamp for last-write-wins on checkbox state
  addedFromRecipe?: string; // recipe name this came from
  servingMultiplier?: number; // multiplier applied when added
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  // True when these numbers came from lib/macros.ts's ingredient-based
  // estimator rather than a real nutrition API (e.g. Spoonacular via
  // /api/recipes/search). Not currently read anywhere in the UI — left
  // available so a screen can label estimated vs. sourced macros later.
  estimated?: boolean;
}

export interface PersonalRecipe {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
  updatedAt?: number;
  source?: "manual" | "photo" | "url";
  // The recipe's own serving yield. For recipes bookmarked from the That's
  // Dinner tab, this is set to whatever the servings stepper was showing
  // at the moment of bookmarking (see handleToggleSaveRecipe in index.tsx)
  // — it is NOT re-synced on every later view, only at save time. For
  // manually-created / photo-imported / URL-scraped recipes (which never
  // pass through that stepper), this is undefined; callers should fall
  // back to a sensible default (4 is used elsewhere in the app).
  servings?: number;
  // Per-serving nutrition. Populated with real API data when bookmarked
  // from a Spoonacular search result; otherwise absent until something
  // calls lib/macros.ts's estimateMacrosPerServing() to fill the gap.
  macros?: Macros;
  // Cuisine/protein/meal-type/diet labels. Auto-generated from name +
  // ingredients at save time (see generateAutoTags in roulette.tsx), but
  // fully user-editable afterward — once a user adds/removes a tag, the
  // auto-generator stops overwriting this recipe's tags on further edits.
  // Absent on recipes saved before this field existed; treat as [] rather
  // than assuming untagged means "no tags wanted".
  tags?: string[];
}

export interface PlanSlot {
  recipeId: string;
  recipeName: string;
  recipePhoto?: string;
  source: "personal" | "spoonacular";
  addedAt: number;
  // Customizable per-planned-meal serving size. Defaults from the
  // recipe's own PersonalRecipe.servings when the slot is first created
  // (see handlePickRecipe in plan.tsx), but is independently editable
  // afterward from the plan detail view — changing it here does NOT
  // change the recipe's own stored default.
  servings?: number;
}

export interface MealPlan {
  [isoDateKey: string]: PlanSlot | null; // e.g. "2026-07-24": { ... }
}

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

export type SharePermission = "view" | "edit";
