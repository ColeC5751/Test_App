import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
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

const GROCERY_LOCAL_KEY = "@recipe_roulette_grocery";
const GROCERY_ROW_KEY = "@recipe_roulette_grocery_row_id";

export function useGrocerySync() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [status, setStatus] = useState<SyncStatus>("synced");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const rowIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    // 1. Load local immediately
    try {
      const local = await AsyncStorage.getItem(GROCERY_LOCAL_KEY);
      if (local) setItems(JSON.parse(local));
    } catch {}

    // 2. Sync from Supabase in background
    setStatus("syncing");
    try {
      const userId = await getUserId();
      if (!userId) { setStatus("offline"); return; }

      const storedRowId = await AsyncStorage.getItem(GROCERY_ROW_KEY);
      rowIdRef.current = storedRowId;

      if (storedRowId) {
        const { data, error } = await supabase
          .from("grocery_lists")
          .select("id, items, share_token")
          .eq("id", storedRowId)
          .single();

        if (!error && data) {
          const remoteItems: GroceryItem[] = data.items ?? [];
          setItems(remoteItems);
          setShareToken(data.share_token);
          await AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(remoteItems));
          setStatus("synced");
          return;
        }
      }

      // No existing row — create one
      const local = await AsyncStorage.getItem(GROCERY_LOCAL_KEY);
      const localItems: GroceryItem[] = local ? JSON.parse(local) : [];
      const { data: newRow, error: insertError } = await supabase
        .from("grocery_lists")
        .insert({ owner_id: userId, items: localItems })
        .select("id, share_token")
        .single();

      if (!insertError && newRow) {
        rowIdRef.current = newRow.id;
        setShareToken(newRow.share_token);
        await AsyncStorage.setItem(GROCERY_ROW_KEY, newRow.id);
      }
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, []);

  const save = useCallback(async (updated: GroceryItem[]) => {
    setItems(updated);
    await AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(updated));
    if (!rowIdRef.current) return;
    setStatus("syncing");
    try {
      await supabase
        .from("grocery_lists")
        .update({ items: updated, updated_at: new Date().toISOString() })
        .eq("id", rowIdRef.current);
      setStatus("synced");
    } catch {
      setStatus("offline");
    }
  }, []);

  // Real-time subscription
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!rowIdRef.current) return;
    const channel = supabase
      .channel(`grocery_${rowIdRef.current}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "grocery_lists", filter: `id=eq.${rowIdRef.current}` },
        (payload) => {
          const remoteItems: GroceryItem[] = (payload.new as any).items ?? [];
          setItems(remoteItems);
          AsyncStorage.setItem(GROCERY_LOCAL_KEY, JSON.stringify(remoteItems));
          setStatus("synced");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowIdRef.current]);

  const loadShared = useCallback(async (token: string) => {
    setStatus("syncing");
    try {
      const { data, error } = await supabase
        .from("grocery_lists")
        .select("id, items, share_token, permission")
        .eq("share_token", token)
        .single();

      if (!error && data) {
        rowIdRef.current = data.id;
        setItems(data.items ?? []);
        setShareToken(data.share_token);
        setStatus("synced");
        return { permission: (data.permission ?? "view") as SharePermission };
      }
    } catch {}
    setStatus("error");
    return null;
  }, []);

  return { items, status, shareToken, save, load, loadShared };
}

// ─── Recipe Sync ──────────────────────────────────────────────────────────────

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
      const storedRowId = await AsyncStorage.getItem(rowKey);

      if (storedRowId) {
        await supabase
          .from("recipes")
          .update({ data: recipe, updated_at: new Date().toISOString() })
          .eq("id", storedRowId);
      } else {
        const { data: newRow } = await supabase
          .from("recipes")
          .insert({ user_id: userId, data: recipe })
          .select("id")
          .single();
        if (newRow) await AsyncStorage.setItem(rowKey, newRow.id);
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
      const rowKey = RECIPE_ROW_PREFIX + id;
      const storedRowId = await AsyncStorage.getItem(rowKey);
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

      const storedRowId = await AsyncStorage.getItem(PLAN_ROW_KEY);
      rowIdRef.current = storedRowId;

      if (storedRowId) {
        const { data, error } = await supabase
          .from("meal_plans")
          .select("id, slots, share_token, permission")
          .eq("id", storedRowId)
          .single();

        if (!error && data) {
          setPlan(data.slots ?? {});
          setShareToken(data.share_token);
          setPermission(data.permission as SharePermission);
          await AsyncStorage.setItem(PLAN_LOCAL_KEY, JSON.stringify(data.slots ?? {}));
          setStatus("synced");
          return;
        }
      }

      const local = await AsyncStorage.getItem(PLAN_LOCAL_KEY);
      const localPlan: MealPlan = local ? JSON.parse(local) : {};
      const { data: newRow } = await supabase
        .from("meal_plans")
        .insert({ owner_id: userId, slots: localPlan, permission: "view" })
        .select("id, share_token")
        .single();

      if (newRow) {
        rowIdRef.current = newRow.id;
        setShareToken(newRow.share_token);
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
    if (!rowIdRef.current) return;
    const channel = supabase
      .channel(`plan_${rowIdRef.current}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "meal_plans", filter: `id=eq.${rowIdRef.current}` },
        (payload) => {
          const remoteSlots: MealPlan = (payload.new as any).slots ?? {};
          setPlan(remoteSlots);
          AsyncStorage.setItem(PLAN_LOCAL_KEY, JSON.stringify(remoteSlots));
          setStatus("synced");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowIdRef.current]);

  useEffect(() => { load(); }, [load]);

  return { plan, status, shareToken, permission, save, load, loadShared, setSharePermission };
}
