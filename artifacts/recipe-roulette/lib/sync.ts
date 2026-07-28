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
  const [name, setName] = useState<string | null>(null);

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

  // Keep ref and state synchronized
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

    // 1. Load local data immediately
    try {
      const local = await AsyncStorage.getItem(GROCERY_LOCAL_KEY);

      if (local) {
        const parsed: GroceryItem[] = JSON.parse(local);
        setItems(parsed);
      }
    } catch (error: any) {
      console.error("GROCERY LOCAL LOAD ERROR:", error);

      setErrorMessage(
        `Local storage error: ${
          error?.message ?? "Unable to read local grocery list"
        }`
      );
    }

    // 2. Try to get authenticated user
    setStatus("syncing");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        recordSupabaseError(
          "Get authenticated user",
          authError
        );
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

      // 3. Get previously stored row ID
      const storedRowId = await AsyncStorage.getItem(
        GROCERY_ROW_KEY
      );

      setActiveRowId(storedRowId);

      // 4. Load existing grocery row
      if (storedRowId) {
        setLastOperation(
          `Loading grocery row ${storedRowId}`
        );

        const {
          data,
          error,
        } = await supabase
          .from("grocery_lists")
          .select(
            "id, items, share_token, name, owner_id, permission"
          )
          .eq("id", storedRowId)
          .single();

        if (error) {
          recordSupabaseError(
            "Load existing grocery list",
            error
          );

          // Important:
          // Do NOT create another grocery list here.
          // The stored row may exist but be blocked by RLS.
          return;
        }

        if (data) {
          const remoteItems: GroceryItem[] =
            data.items ?? [];

          setItems(remoteItems);
          setShareToken(data.share_token ?? null);
          setName(data.name ?? null);
          setOwnerId(data.owner_id ?? null);

          const owner =
            data.owner_id === currentUserId;

          setIsOwner(owner);

          await AsyncStorage.setItem(
            GROCERY_LOCAL_KEY,
            JSON.stringify(remoteItems)
          );

          setStatus("synced");
          setLastOperation(
            "Loaded grocery list successfully"
          );

          return;
        }
      }

      // 5. No row ID exists, so create a new grocery list
      setLastOperation(
        "Creating new grocery list"
      );

      const local = await AsyncStorage.getItem(
        GROCERY_LOCAL_KEY
      );

      const localItems: GroceryItem[] = local
        ? JSON.parse(local)
        : [];

      const {
        data: newRow,
        error: insertError,
      } = await supabase
        .from("grocery_lists")
        .insert({
          owner_id: currentUserId,
          items: localItems,
        })
        .select(
          "id, share_token, name, owner_id, permission"
        )
        .single();

      if (insertError) {
        recordSupabaseError(
          "Create new grocery list",
          insertError
        );

        return;
      }

      if (newRow) {
        setActiveRowId(newRow.id);

        setShareToken(
          newRow.share_token ?? null
        );

        setName(
          newRow.name ?? null
        );

        setOwnerId(
          newRow.owner_id ?? null
        );

        setIsOwner(
          newRow.owner_id === currentUserId
        );

        await AsyncStorage.setItem(
          GROCERY_ROW_KEY,
          newRow.id
        );

        setLastOperation(
          `Created grocery list ${newRow.id}`
        );
      }

      setStatus("synced");
    } catch (error: any) {
      console.error(
        "GROCERY LOAD EXCEPTION:",
        error
      );

      setStatus("offline");

      setLastOperation(
        "Unexpected grocery sync error"
      );

      setErrorMessage(
        error?.message ??
          "Unexpected error while syncing grocery list"
      );

      setErrorCode(
        error?.code ?? null
      );

      setErrorDetails(
        error?.details ?? null
      );
    }
  }, [
    clearError,
    recordSupabaseError,
    setActiveRowId,
  ]);

  // ─────────────────────────────────────────────────────────────
  // SAVE GROCERY LIST
  // ─────────────────────────────────────────────────────────────

  const save = useCallback(
    async (updated: GroceryItem[]) => {
      // Update UI immediately
      setItems(updated);

      // Always save locally first
      try {
        await AsyncStorage.setItem(
          GROCERY_LOCAL_KEY,
          JSON.stringify(updated)
        );
      } catch (localError) {
        console.error(
          "GROCERY LOCAL SAVE ERROR:",
          localError
        );
      }

      const activeRowId =
        rowIdRef.current;

      // No Supabase row yet
      if (!activeRowId) {
        setLastOperation(
          "Saved locally — no Supabase row ID available"
        );

        setStatus("offline");

        return;
      }

      setStatus("syncing");

      setLastOperation(
        `Updating grocery row ${activeRowId}`
      );

      try {
        // Get authenticated user
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          recordSupabaseError(
            "Get user before grocery save",
            authError
          );

          return;
        }

        const currentUserId =
          user?.id ?? null;

        setUserId(currentUserId);

        if (!currentUserId) {
          setStatus("offline");

          setErrorMessage(
            "Cannot save to Supabase because no authenticated user was found."
          );

          setLastOperation(
            "Save failed — no authenticated user"
          );

          return;
        }

        // Check that the row exists
        const {
          data: rowCheck,
          error: rowCheckError,
        } = await supabase
          .from("grocery_lists")
          .select(
            "id, owner_id, items"
          )
          .eq("id", activeRowId)
          .single();

        if (rowCheckError) {
          recordSupabaseError(
            "Check grocery row before save",
            rowCheckError
          );

          setErrorMessage(
            `Could not find grocery row: ${rowCheckError.message}`
          );

          setLastOperation(
            `Failed to find grocery row ${activeRowId}`
          );

          return;
        }

        const owner =
          rowCheck.owner_id === currentUserId;

        setOwnerId(
          rowCheck.owner_id ?? null
        );

        setIsOwner(owner);

        // Make sure authenticated user owns the list
        if (!owner) {
          setStatus("error");

          setErrorMessage(
            "You are not the owner of this grocery list."
          );

          setLastOperation(
            "Save blocked — authenticated user is not the row owner"
          );

          return;
        }

        // Update Supabase
        const {
          data: savedRow,
          error: updateError,
        } = await supabase
          .from("grocery_lists")
          .update({
            items: updated,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", activeRowId)
          .eq(
            "owner_id",
            currentUserId
          )
          .select(
            "id, owner_id, items, updated_at"
          )
          .single();

        if (updateError) {
          recordSupabaseError(
            "Update grocery list",
            updateError
          );

          setErrorMessage(
            `Supabase save failed: ${updateError.message}`
          );

          setLastOperation(
            `Supabase update failed for row ${activeRowId}`
          );

          return;
        }

        if (!savedRow) {
          setStatus("error");

          setErrorMessage(
            "Supabase accepted the request but returned no saved grocery row."
          );

          setLastOperation(
            "Save failed — no row returned after update"
          );

          return;
        }

        // Verify returned data
        const savedItems =
          (savedRow.items ?? []) as GroceryItem[];

        if (
          JSON.stringify(savedItems) !==
          JSON.stringify(updated)
        ) {
          setStatus("error");

          setErrorMessage(
            "Supabase returned data that does not match the grocery items that were saved."
          );

          setLastOperation(
            "Save mismatch — Supabase data differs from local data"
          );

          console.error(
            "GROCERY SAVE MISMATCH",
            {
              rowId: activeRowId,
              expected: updated,
              actual: savedItems,
            }
          );

          return;
        }

        // Success
        setStatus("synced");

        clearError();

        setLastOperation(
          `Successfully saved ${updated.length} items to Supabase`
        );
      } catch (error: any) {
        console.error(
          "GROCERY SAVE EXCEPTION:",
          error
        );

        setStatus("offline");

        setErrorMessage(
          error?.message ??
            "Unknown error while saving grocery list"
        );

        setLastOperation(
          "Grocery save failed with an unexpected error"
        );
      }
    },
    [
      clearError,
      recordSupabaseError,
    ]
  );

  // ─────────────────────────────────────────────────────────────
  // RENAME GROCERY LIST
  // ─────────────────────────────────────────────────────────────

  const rename = useCallback(
    async (newName: string) => {
      const trimmed =
        newName.trim();

      setName(
        trimmed || null
      );

      const activeRowId =
        rowIdRef.current;

      if (!activeRowId) {
        return;
      }

      try {
        const {
          error,
        } = await supabase
          .from("grocery_lists")
          .update({
            name:
              trimmed || null,
          })
          .eq(
            "id",
            activeRowId
          );

        if (error) {
          recordSupabaseError(
            "Rename grocery list",
            error
          );

          return;
        }

        setLastOperation(
          "Grocery list renamed"
        );
      } catch (error: any) {
        recordSupabaseError(
          "Rename grocery list",
          error
        );
      }
    },
    [
      recordSupabaseError,
    ]
  );

  // ─────────────────────────────────────────────────────────────
  // RETURN
  // ─────────────────────────────────────────────────────────────

  return {
    items,
    status,
    shareToken,
    name,

    save,
    load,
    rename,

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

// ─── Shared (read-only viewer) Grocery Sync ──────────────────────────────────
// For the /(shared)/grocery/[token] screen only. Does NOT run the "load my
// own list" logic or create a new row — it only fetches by share token and
// subscribes to realtime updates for that specific row. This avoids racing
// against a signed-in visitor's own grocery_lists row (the same bug class
// that hit the plan screen — see useSharedPlanSync below).

export function useSharedGrocerySync(token: string | undefined) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const rowIdRef = useRef<string | null>(null);

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
        setItems(data.items ?? []);
        setPermission((data.permission ?? "view") as SharePermission);
        setName(data.name ?? null);
        setStatus("synced");

        // "Shared with me" — instant join on open, mirrors
        // useSharedPlanSync above. See that hook's comment for the
        // full rationale.
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
    if (!rowIdRef.current) return;
    const id = rowIdRef.current;
    const channel = supabase
      .channel(`shared_grocery_${id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "grocery_lists", filter: `id=eq.${id}` },
        (payload) => {
          const remoteItems: GroceryItem[] = (payload.new as any).items ?? [];
          setItems(remoteItems);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowIdRef.current]);

  const save = useCallback(async (updated: GroceryItem[]) => {
  setItems(updated);

  try {
    await AsyncStorage.setItem(
      GROCERY_LOCAL_KEY,
      JSON.stringify(updated)
    );
  } catch (localError) {
    console.error("Failed to save grocery list locally:", localError);
  }

  if (!rowIdRef.current) {
    console.warn("No grocery row ID available. Saved locally only.");
    return;
  }

  setStatus("syncing");

  try {
    const { error } = await supabase
      .from("grocery_lists")
      .update({
        items: updated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowIdRef.current);

    if (error) {
      console.error("Failed to save grocery list to Supabase:", error);
      setStatus("error");
      return;
    }

    setStatus("synced");
  } catch (error) {
    console.error("Unexpected grocery sync error:", error);
    setStatus("offline");
  }
}, []);
  const rename = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    setName(trimmed || null);
    if (!rowIdRef.current || permission !== "edit") return;
    try {
      await supabase
        .from("grocery_lists")
        .update({ name: trimmed || null })
        .eq("id", rowIdRef.current);
    } catch {}
  }, [permission]);

  return { items, status, permission, notFound, name, save, rename };
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
  const [name, setName] = useState<string | null>(null);
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
          .select("id, slots, share_token, permission, name")
          .eq("id", storedRowId)
          .single();

        if (!error && data) {
          setPlan(data.slots ?? {});
          setShareToken(data.share_token);
          setPermission(data.permission as SharePermission);
          setName(data.name ?? null);
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
        .select("id, share_token, name")
        .single();

      if (newRow) {
        rowIdRef.current = newRow.id;
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
// For the /(shared)/plan/[token] screen only. This is intentionally separate
// from usePlanSync — that hook's own useEffect(() => { load(); }, [load])
// runs unconditionally for the *signed-in visitor's own* plan, and if they
// don't have one yet it INSERTS a new meal_plans row owned by them. That
// raced against loadShared() on the shared screen: both ran on mount, both
// wrote to rowIdRef, and whichever finished last "won" — leaving `plan`
// state and rowIdRef pointing at two different rows, or a realtime
// subscription set up against the wrong id. This is what was causing the
// crash on the shared plan screen. This hook only ever fetches by
// share_token and subscribes to that one row — it never touches the
// visitor's own plan or inserts anything.

export function useSharedPlanSync(token: string | undefined) {
  const [plan, setPlan] = useState<MealPlan>({});
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState<string | null>(null);
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
        setPlan(data.slots ?? {});
        setPermission((data.permission ?? "view") as SharePermission);
        setName(data.name ?? null);
        setStatus("synced");

        // "Shared with me" — instant join on open. If the visitor is
        // signed in, record their membership so this plan becomes
        // reachable from within the app later, not just via this link.
        // Anonymous visitors can still view via the token as before;
        // they just won't get a persistent entry until signed in.
        // Upsert (not insert) so repeat visits don't error on the
        // unique(plan_id, user_id) constraint.
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
    if (!rowIdRef.current) return;
    const id = rowIdRef.current;
    const channel = supabase
      .channel(`shared_plan_${id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "meal_plans", filter: `id=eq.${id}` },
        (payload) => {
          const remoteSlots: MealPlan = (payload.new as any).slots ?? {};
          setPlan(remoteSlots);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rowIdRef.current]);

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
// Lists every plan/list a signed-in user has previously joined (via opening
// a share link — see the join-on-open logic in useSharedPlanSync /
// useSharedGrocerySync above). Used by the "Shared with me" tab/screen.

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
