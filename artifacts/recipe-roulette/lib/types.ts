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

export interface PersonalRecipe {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
  updatedAt?: number;
  source?: "manual" | "photo" | "url";
}

export interface PlanSlot {
  recipeId: string;
  recipeName: string;
  recipePhoto?: string;
  source: "personal" | "spoonacular";
  addedAt: number;
}

export interface MealPlan {
  [isoDateKey: string]: PlanSlot | null; // e.g. "2026-07-24": { ... }
}

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

export type SharePermission = "view" | "edit";
