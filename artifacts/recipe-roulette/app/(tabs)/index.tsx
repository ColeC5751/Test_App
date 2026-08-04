import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useGrocerySync, useRecipeSync } from "@/lib/sync";
import type { Macros as MacrosShared } from "@/lib/types";
import { MacroBar, MacroPills } from "@/components/MacroDisplay";
import { SavedToast } from "@/components/SavedToast";
import { CookMode } from "@/components/CookMode";
import type { PersonalRecipe } from "@/lib/types";
import { useOnboarding } from "@/lib/onboarding";
import { OnboardingPulseRing } from "@/components/OnboardingBanner";

const DEFAULT_PROTEINS = ["Fish", "Chicken", "Ground Beef", "Pork"];
const DEFAULT_CARBS = ["Rice", "Pasta", "Potatoes", "Bread"];
const DEFAULT_VEGGIES = ["Broccoli", "Spinach", "Carrots", "Peppers"];

const WHEELS_KEY = "@recipe_roulette_wheels";

const FRIDGE_SUGGESTIONS = [
  "Chicken", "Beef", "Salmon", "Pork", "Eggs", "Tofu",
  "Rice", "Pasta", "Potato", "Garlic", "Onion",
  "Broccoli", "Spinach", "Tomato", "Peppers", "Mushrooms",
];

// Module-level session state — survives tab switches without Supabase.
// When Phase 1 wires in, these move into a shared session context.
let sessionMode: "spin" | "fridge" = "spin";
let sessionFridgeTags: string[] = [];
let sessionFridgeResults: Recipe[] = [];
let sessionFridgeError: string = "";

const ITEM_HEIGHT = 80;
const VISIBLE = 3;
const COPY_COUNT = 10;
const START_COPY = 2;
const SPIN_ROUNDS = 5;
const PROTEIN_DUR = 1600;
const CARB_DUR = 2200;
const VEGGIE_DUR = 2800;

function makeDisplay(items: string[]) {
  return Array.from({ length: COPY_COUNT }, () => items).flat();
}
function initialY(items: string[], idx = 0) {
  return ITEM_HEIGHT * (1 - (START_COPY * items.length + idx));
}
function spinTargetY(items: string[], prevIdx: number, newIdx: number) {
  return ITEM_HEIGHT * (1 - (START_COPY * items.length + prevIdx + SPIN_ROUNDS * items.length + newIdx));
}
function resetY(items: string[], newIdx: number) {
  return ITEM_HEIGHT * (1 - (START_COPY * items.length + newIdx));
}

function formatAmt(n: number): string {
  if (n <= 0) return "0";
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
}

type RecipeIngredient = {
  amount: number;
  unit: string;
  name: string;
  original: string;
};

type Macros = MacrosShared;

type Recipe = {
  id: number;
  title: string;
  image: string;
  readyInMinutes: number;
  servings: number;
  ingredients: RecipeIngredient[];
  instructions: string[];
  macros?: Macros;
};

type WheelData = {
  proteins: string[];
  carbs: string[];
  veggies: string[];
};

type FetchResult = { recipes: Recipe[]; errorMessage?: string };

async function fetchRecipes(ingredients: string): Promise<FetchResult> {
  try {
    const res = await fetch(
      `https://test-app-api-server.vercel.app/api/recipes/search?ingredients=${encodeURIComponent(ingredients)}`
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data?.code ?? "";
      const msg =
        code === "quota_exceeded"
          ? "Daily recipe search limit reached — try again tomorrow."
          : code === "network_error"
          ? "No connection — check your internet and try again."
          : code === "api_key_invalid"
          ? "Recipe search is misconfigured. Please contact support."
          : data?.error ?? "Couldn't load recipes. Try again.";
      return { recipes: [], errorMessage: msg };
    }
    return { recipes: data.recipes ?? [] };
  } catch {
    return { recipes: [], errorMessage: "No connection — check your internet and try again." };
  }
}


function SlotColumn({ label, items, animValue }: { label: string; items: string[]; animValue: Animated.Value }) {
  const colors = useColors();
  const display = makeDisplay(items);
  return (
    <View style={styles.colWrap}>
      <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.colViewport, { height: ITEM_HEIGHT * VISIBLE, backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.selectionBox, { borderColor: colors.primary, pointerEvents: "none" }]} />
        <Animated.View style={{ transform: [{ translateY: animValue }] }}>
          {display.map((item, i) => (
            <View key={i} style={[styles.slotItem, { height: ITEM_HEIGHT }]}>
              <Text style={[styles.slotText, { color: colors.foreground }]}>{item}</Text>
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

function WheelSettingsModal({
  visible,
  onClose,
  wheels,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  wheels: WheelData;
  onSave: (wheels: WheelData) => void;
}) {
  const colors = useColors();
  const [proteins, setProteins] = useState<string[]>(wheels.proteins);
  const [carbs, setCarbs] = useState<string[]>(wheels.carbs);
  const [veggies, setVeggies] = useState<string[]>(wheels.veggies);
  const [newProtein, setNewProtein] = useState("");
  const [newCarb, setNewCarb] = useState("");
  const [newVeggie, setNewVeggie] = useState("");

  useEffect(() => {
    setProteins(wheels.proteins);
    setCarbs(wheels.carbs);
    setVeggies(wheels.veggies);
  }, [wheels]);

  const handleSave = () => {
    if (proteins.length === 0 || carbs.length === 0 || veggies.length === 0) return;
    onSave({ proteins, carbs, veggies });
    onClose();
  };

  const inputStyle = [styles.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }];

  const renderCategory = (
    label: string,
    items: string[],
    setItems: (items: string[]) => void,
    newItem: string,
    setNewItem: (val: string) => void,
  ) => (
    <View style={styles.categorySection}>
      <Text style={[styles.categoryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {items.map((item, i) => (
        <View key={i} style={[styles.ingredientRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.ingredientText, { color: colors.foreground }]}>{item}</Text>
          <Pressable
            onPress={() => {
              if (items.length > 1) {
                setItems(items.filter((_, idx) => idx !== i));
                Haptics.selectionAsync();
              }
            }}
            hitSlop={12}
          >
            <Feather name="x" size={16} color={items.length > 1 ? colors.mutedForeground : colors.muted} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          value={newItem}
          onChangeText={setNewItem}
          placeholder={`Add ${label.toLowerCase()}...`}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="words"
        />
        <Pressable
          onPress={() => {
            if (newItem.trim()) {
              setItems([...items, newItem.trim()]);
              setNewItem("");
              Haptics.selectionAsync();
            }
          }}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Customize Wheels</Text>
          <Pressable onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {renderCategory("PROTEIN", proteins, setProteins, newProtein, setNewProtein)}
          {renderCategory("CARBS", carbs, setCarbs, newCarb, setNewCarb)}
          {renderCategory("VEGGIE", veggies, setVeggies, newVeggie, setNewVeggie)}
          <Pressable onPress={handleSave} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// RecipeDetailModal no longer imports grocery mutation logic directly.
// `onAddToGrocery` is passed down from SpinScreen, which is the only place
// that calls useGrocerySync() (a component-level hook can't be called
// inside this sibling component). This keeps the canonical grocery
// mutation path identical to grocery.tsx and plan.tsx: everything funnels
// through useGrocerySync().addIngredients().
//
// Bookmark ("save to My Dinners") state is handled the same way: it's
// lifted to SpinScreen (which owns the single useRecipeSync() instance for
// this screen) and passed down as `isSaved` / `onToggleSave`, instead of
// this component reading/writing AsyncStorage directly. That keeps
// Spoonacular bookmarks on the same Supabase-backed path as the rest of
// My Dinners, so they also survive sign-out/sign-in.
//
// "Add to Grocery List" mirrors that same persisting-state pattern: once
// tapped, it flips to a locked "Added to Grocery List" state (same
// outline/checkmark styling as "Save to My Dinners") so it can't be
// spam-tapped into adding duplicate ingredients. That lock is scoped to
// the current serving size — nudging the servings stepper re-arms the
// button, since a different serving size means different quantities the
// person may legitimately want to add.
function RecipeDetailModal({
  recipe,
  onClose,
  onAddToGrocery,
  isSaved,
  onToggleSave,
  onboardingHighlightSave,
}: {
  recipe: Recipe | null;
  onClose: () => void;
  onAddToGrocery: (ingredientsText: string, opts: { fromRecipe: string; servingMultiplier: number }) => Promise<void>;
  isSaved: boolean;
  onToggleSave: (recipe: Recipe, servings: number) => Promise<boolean>;
  onboardingHighlightSave?: boolean;
}) {
  const colors = useColors();
  const [currentServings, setCurrentServings] = useState<number | null>(null);
  const [addedToGrocery, setAddedToGrocery] = useState(false);
  const [addingToGrocery, setAddingToGrocery] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [showCookMode, setShowCookMode] = useState(false);

  useEffect(() => {
    if (!recipe) {
      setAddedToGrocery(false);
      setAddingToGrocery(false);
      setShowSavedToast(false);
      setShowCookMode(false);
    }
  }, [recipe?.id]);

  const baseServings = recipe?.servings ?? 4;
  const servings = currentServings ?? baseServings;

  // Changing servings changes the quantities that would be added, so the
  // "Added to Grocery List" lock is scoped to the serving size it was set
  // at — adjusting the stepper re-arms the button rather than leaving it
  // permanently stuck on a stale serving size.
  const adjustServings = (delta: number) => {
    setCurrentServings((s) => Math.max(1, Math.min(20, (s ?? baseServings) + delta)));
    setAddedToGrocery(false);
    Haptics.selectionAsync();
  };

  const handleSave = async () => {
    if (!recipe) return;
    const nowSaved = await onToggleSave(recipe, servings);
    if (nowSaved) {
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 1000);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleAddToGrocery = async () => {
    if (!recipe || addedToGrocery || addingToGrocery) return;
    setAddingToGrocery(true);

    const scale = servings / baseServings;
    const ingredientsString = recipe.ingredients
      .map((ing) => {
        const amt = formatAmt(ing.amount * scale);
        const unit = ing.unit ? `${ing.unit} ` : "";
        return `${amt} ${unit}${ing.name}`.trim();
      })
      .join("\n");

    // Canonical path: parses + merges + persists (local, then Supabase)
    // through the same useGrocerySync() state that grocery.tsx displays.
    await onAddToGrocery(ingredientsString, {
      fromRecipe: recipe.title,
      servingMultiplier: scale,
    });

    setAddingToGrocery(false);
    setAddedToGrocery(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleClose = () => { setCurrentServings(null); onClose(); };

  const handleShare = async () => {
    if (!recipe) return;
    const scale = servings / baseServings;
    const ingList = recipe.ingredients.map((ing) => {
      const amt = formatAmt(ing.amount * scale);
      const unit = ing.unit ? `${ing.unit} ` : "";
      return `• ${amt} ${unit}${ing.name}`.trim();
    }).join("\n");
    const stepList = recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const macroLine = recipe.macros
      ? `Calories: ${recipe.macros.calories} kcal | Protein: ${recipe.macros.protein}g | Carbs: ${recipe.macros.carbs}g | Fat: ${recipe.macros.fat}g`
      : "";
    const message = `${recipe.title}\nServings: ${servings}  |  Ready in: ${recipe.readyInMinutes} min\n` +
      (macroLine ? `${macroLine}\n` : "") +
      `\n` + (ingList ? `INGREDIENTS\n${ingList}\n\n` : "") + (stepList ? `INSTRUCTIONS\n${stepList}` : "");
    try { await Share.share({ title: recipe.title, message }); } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!recipe) return null;

  return (
    <Modal visible={!!recipe} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.background }]}>
        <SavedToast visible={showSavedToast} label="Saved to My Dinners!" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          <Image source={{ uri: recipe.image }} style={styles.recipeModalImage} />
          {/* Bookmark/save-to-My-Dinners used to float here in the top
              right of the photo. It's been moved down into the action
              button stack below (next to Add to Grocery List / Start
              Cooking) so every primary recipe action lives in one place
              instead of being split between the photo overlay and the
              body. */}
          <Pressable onPress={handleClose} style={[styles.floatBtn, styles.floatBtnRight, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={handleShare} style={[styles.floatBtn, styles.floatBtnLeft, { backgroundColor: colors.primary }]}>
            <Feather name="share" size={18} color={colors.primaryForeground} />
          </Pressable>
          <View style={styles.modalBody}>
            <Text style={[styles.recipeModalTitle, { color: colors.foreground }]}>{recipe.title}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Feather name="clock" size={13} color={colors.primary} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{recipe.readyInMinutes} min</Text>
              </View>
            </View>

            <View style={[styles.servingsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.servingsLabel, { color: colors.mutedForeground }]}>SERVINGS</Text>
              <View style={styles.stepper}>
                <Pressable onPress={() => adjustServings(-1)} style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="minus" size={16} color={colors.foreground} />
                </Pressable>
                <Text style={[styles.stepperValue, { color: colors.foreground }]}>{servings}</Text>
                <Pressable onPress={() => adjustServings(1)} style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="plus" size={16} color={colors.foreground} />
                </Pressable>
              </View>
            </View>

            {/* Start Cooking is now the highlighted (primary-filled)
                action when the recipe has steps — it's the thing most
                people tap next after landing here. */}
            {recipe.instructions.length > 0 && (
              <Pressable
                onPress={() => setShowCookMode(true)}
                style={({ pressed }) => [
                  styles.groceryBtn,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Feather name="play-circle" size={16} color={colors.primaryForeground} />
                <Text style={[styles.groceryBtnText, { color: colors.primaryForeground }]}>
                  Start Cooking
                </Text>
              </Pressable>
            )}

            {/* Add to Grocery List now mirrors the "Save to My Dinners"
                treatment below: a card-background button with a border
                that turns primary-colored once actioned, and a persisting
                "Added to Grocery List" label + disabled state so it can't
                be spam-tapped into duplicate additions. It re-arms if the
                servings stepper changes (see adjustServings above), since
                that changes what would actually be added. */}
            <Pressable
              onPress={handleAddToGrocery}
              disabled={addedToGrocery || addingToGrocery}
              style={({ pressed }) => [
                styles.groceryBtn,
                { backgroundColor: colors.card, borderWidth: 1.5, borderColor: addedToGrocery ? colors.primary : colors.border },
                pressed && !addedToGrocery && !addingToGrocery && { opacity: 0.9 },
              ]}
            >
              <Feather
                name={addedToGrocery ? "check" : "shopping-cart"}
                size={16}
                color={addedToGrocery ? colors.primary : colors.foreground}
              />
              <Text style={[styles.groceryBtnText, { color: addedToGrocery ? colors.primary : colors.foreground }]}>
                {addingToGrocery ? "Adding…" : addedToGrocery ? "Added to Grocery List" : "Add to Grocery List"}
              </Text>
            </Pressable>

            {/* Save to My Dinners — moved here from the floating top-right
                bookmark icon over the photo, grouped with the other two
                actions instead of sitting apart from them. During the
                "save" onboarding step this is the one action that should
                stand out — everything else on this screen keeps its normal
                (non-highlighted) styling so there's exactly one obvious
                next tap. */}
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.groceryBtn,
                {
                  backgroundColor: colors.card,
                  borderWidth: onboardingHighlightSave && !isSaved ? 2 : 1.5,
                  borderColor: isSaved ? colors.primary : onboardingHighlightSave ? colors.primary : colors.border,
                },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Feather name="bookmark" size={16} color={isSaved ? colors.primary : colors.foreground} />
              <Text style={[styles.groceryBtnText, { color: isSaved ? colors.primary : colors.foreground }]}>
                {isSaved ? "Saved to My Dinners" : "Save to My Dinners"}
              </Text>
            </Pressable>
            {onboardingHighlightSave && !isSaved && (
              <Text style={[styles.onboardingHint, { color: colors.primary }]}>
                👆 Tap here to save this recipe and continue setup
              </Text>
            )}

            {recipe.macros && (
              <MacroBar macros={recipe.macros} colors={colors} />
            )}

            {recipe.ingredients.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
                <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {recipe.ingredients.map((ing, i) => {
                    const scale = servings / baseServings;
                    const line = `${formatAmt(ing.amount * scale)} ${ing.unit ? `${ing.unit} ` : ""}${ing.name}`.trim();
                    return (
                      <View key={i} style={styles.ingRow}>
                        <View style={[styles.ingDot, { backgroundColor: colors.primary }]} />
                        <Text style={[styles.ingText, { color: colors.foreground }]}>{line}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
            {recipe.instructions.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INSTRUCTIONS</Text>
                {recipe.instructions.map((step, i) => (
                  <View key={i} style={[styles.stepRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.stepNum, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.stepNumText, { color: colors.primaryForeground }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.foreground }]}>{step}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <CookMode
        visible={showCookMode}
        recipeName={recipe?.title ?? ""}
        steps={recipe?.instructions ?? []}
        onClose={() => setShowCookMode(false)}
      />
    </Modal>
  );
}

function RecipeCard({ recipe, onPress }: { recipe: Recipe; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.recipeCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.82 }]}>
      <Image source={{ uri: recipe.image }} style={styles.recipeImg} />
      <View style={styles.recipeBody}>
        <Text style={[styles.recipeTitle, { color: colors.foreground }]} numberOfLines={2}>{recipe.title}</Text>
        {recipe.macros && <MacroPills macros={recipe.macros} colors={colors} />}
        <View style={styles.recipeFooter}>
          <View style={styles.timeRow}>
            <Feather name="clock" size={12} color={colors.mutedForeground} />
            <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{recipe.readyInMinutes} min</Text>
          </View>
          <View style={styles.tapHint}>
            <Text style={[styles.tapHintText, { color: colors.primary }]}>View recipe</Text>
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function SpinScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  // Canonical grocery sync — called here at the component level (not inside
  // RecipeDetailModal, a sibling component) and threaded down as a prop.
  // This replaces the broken `import { addIngredientsToGrocery } from
  // "@/app/(tabs)/grocery"`, which referenced an export that no longer
  // exists and was failing the whole Metro bundle.
  //
  // `load` is pulled out too (aliased to loadGrocery) — this screen never
  // called it at all, unlike grocery.tsx (which loads on focus) and
  // plan.tsx (which does the same). Without it, this hook instance's
  // internal row id could sit at null for as long as this tab is open,
  // silently downgrading every "Add to Grocery List" tap here to "saved
  // locally only" and never reaching Supabase — see useFocusEffect and
  // handleAddToGrocery below.
  const { load: loadGrocery, addIngredients } = useGrocerySync();

  // Onboarding: this screen owns steps 1 ("spin") and 2 ("save"). Step 3
  // ("plan_or_grocery") is advanced from grocery.tsx / plan.tsx — see the
  // hook points documented in those files. `advanceOnboarding` is a no-op
  // once onboarding is already past a given step, so it's safe to call
  // unconditionally from success paths without extra guarding beyond the
  // `onboardingStep === "..."` checks already in place below.
  const { step: onboardingStep, advance: advanceOnboarding } = useOnboarding();

  useFocusEffect(
    useCallback(() => {
      loadGrocery();
    }, [loadGrocery])
  );

  // Race-safety belt-and-suspenders, matching plan.tsx's
  // handleAddWeekToGrocery: the useFocusEffect above already loads the
  // grocery row on focus, but if the person opens a recipe and taps "Add
  // to Grocery List" faster than that load() resolves, rowIdRef.current
  // inside useGrocerySync could still be null. Re-awaiting load() here is
  // cheap and safe (guarded by savingRef in sync.ts) and guarantees the
  // row id is in place before addIngredients runs.
  const handleAddToGrocery = useCallback(
    async (raw: string, opts: { fromRecipe: string; servingMultiplier: number }) => {
      await loadGrocery();
      await addIngredients(raw, opts);
    },
    [loadGrocery, addIngredients]
  );

  // Canonical, Supabase-backed personal recipe store — used here so that
  // bookmarking a Spoonacular recipe ("save to My Dinners") persists the
  // same way as everything else in My Dinners, instead of writing directly
  // to the AsyncStorage cache that gets cleared on sign-out.
  const { recipes: personalRecipes, save: savePersonalRecipe, remove: removePersonalRecipe } = useRecipeSync();

  const [wheels, setWheels] = useState<WheelData>({
    proteins: DEFAULT_PROTEINS,
    carbs: DEFAULT_CARBS,
    veggies: DEFAULT_VEGGIES,
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(WHEELS_KEY).then((json) => {
      if (json) setWheels(JSON.parse(json));
    }).catch(() => {});
  }, []);

  const handleSaveWheels = async (newWheels: WheelData) => {
    setWheels(newWheels);
    setSelProtein(0);
    setSelCarb(0);
    setSelVeggie(0);
    proteinY.setValue(initialY(newWheels.proteins));
    carbY.setValue(initialY(newWheels.carbs));
    veggieY.setValue(initialY(newWheels.veggies));
    await AsyncStorage.setItem(WHEELS_KEY, JSON.stringify(newWheels));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const [selProtein, setSelProtein] = useState(0);
  const [selCarb, setSelCarb] = useState(0);
  const [selVeggie, setSelVeggie] = useState(0);

  const proteinY = useRef(new Animated.Value(initialY(wheels.proteins))).current;
  const carbY = useRef(new Animated.Value(initialY(wheels.carbs))).current;
  const veggieY = useRef(new Animated.Value(initialY(wheels.veggies))).current;

  const [spinning, setSpinning] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [currentIngredients, setCurrentIngredients] = useState("");

  // Fridge mode — initialized from module-level session vars so tab
  // switches don't reset them. setters update both component and module state.
  const [mode, _setMode] = useState<"spin" | "fridge">(sessionMode);
  const setMode = (m: "spin" | "fridge") => { sessionMode = m; _setMode(m); };

  const [fridgeInput, setFridgeInput] = useState("");
  const [fridgeTags, _setFridgeTags] = useState<string[]>(sessionFridgeTags);
  const setFridgeTags = (fn: string[] | ((prev: string[]) => string[])) => {
    const next = typeof fn === "function" ? fn(sessionFridgeTags) : fn;
    sessionFridgeTags = next;
    _setFridgeTags(next);
  };
  const [fridgeResults, _setFridgeResults] = useState<Recipe[]>(sessionFridgeResults);
  const setFridgeResults = (r: Recipe[]) => { sessionFridgeResults = r; _setFridgeResults(r); };
  const [fridgeLoading, setFridgeLoading] = useState(false);
  const [fridgeError, _setFridgeError] = useState(sessionFridgeError);
  const setFridgeError = (e: string) => { sessionFridgeError = e; _setFridgeError(e); };

  // A Spoonacular recipe is considered "saved" if My Dinners has an entry
  // whose id follows the `spoonacular_{id}` convention used by
  // handleToggleSaveRecipe below.
  const isRecipeSaved = (recipe: Recipe | null): boolean =>
    !!recipe && personalRecipes.some((r) => r.id === `spoonacular_${recipe.id}`);

  const handleToggleSaveRecipe = async (recipe: Recipe, servings: number): Promise<boolean> => {
    const recipeId = `spoonacular_${recipe.id}`;
    const alreadySaved = personalRecipes.some((r) => r.id === recipeId);
    if (alreadySaved) {
      await removePersonalRecipe(recipeId);
      return false;
    }
    const entry: PersonalRecipe = {
      id: recipeId,
      name: recipe.title,
      ingredients: recipe.ingredients.map((i) => i.original || `${formatAmt(i.amount)} ${i.unit} ${i.name}`.trim()).join(", "),
      steps: recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      photoUrl: recipe.image,
      createdAt: Date.now(),
      // Whatever the servings stepper was showing at the moment of
      // bookmarking becomes this recipe's default — this is what lets the
      // planner (plan.tsx's handlePickRecipe) pick up the same serving
      // size automatically instead of always falling back to a generic 4.
      servings,
      // Real API-provided nutrition, not an estimate — Spoonacular already
      // gives us this, so there's no reason to fall back to
      // estimateMacrosPerServing() for recipes that have it.
      macros: recipe.macros,
    };
    await savePersonalRecipe(entry);

    // ── Onboarding: step 2 → 3 ──────────────────────────────────────────
    // A successful save is exactly the signal this step is gated on.
    // Advancing here (rather than in RecipeDetailModal, which doesn't own
    // the onboarding hook) keeps onboarding state changes centralized in
    // this screen alongside the "spin" → "save" transition above.
    if (onboardingStep === "save") {
      advanceOnboarding("plan_or_grocery");
    }

    return true;
  };

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const newProtein = Math.floor(Math.random() * wheels.proteins.length);
    const newCarb = Math.floor(Math.random() * wheels.carbs.length);
    const newVeggie = Math.floor(Math.random() * wheels.veggies.length);

    const easing = Easing.out(Easing.cubic);

    Animated.parallel([
      Animated.timing(proteinY, { toValue: spinTargetY(wheels.proteins, selProtein, newProtein), duration: PROTEIN_DUR, easing, useNativeDriver: false }),
      Animated.timing(carbY, { toValue: spinTargetY(wheels.carbs, selCarb, newCarb), duration: CARB_DUR, easing, useNativeDriver: false }),
      Animated.timing(veggieY, { toValue: spinTargetY(wheels.veggies, selVeggie, newVeggie), duration: VEGGIE_DUR, easing, useNativeDriver: false }),
    ]).start(async () => {
      proteinY.setValue(resetY(wheels.proteins, newProtein));
      carbY.setValue(resetY(wheels.carbs, newCarb));
      veggieY.setValue(resetY(wheels.veggies, newVeggie));

      setSelProtein(newProtein);
      setSelCarb(newCarb);
      setSelVeggie(newVeggie);
      setSpinning(false);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const ingredients = `${wheels.proteins[newProtein]},${wheels.carbs[newCarb]},${wheels.veggies[newVeggie]}`;
      setCurrentIngredients(ingredients);
      setIsLoading(true);
      setIsError(false);
      setErrorMessage("");
      setRecipes([]);

      try {
        const result = await fetchRecipes(ingredients);
        if (result.errorMessage) {
          setIsError(true);
          setErrorMessage(result.errorMessage);
        } else {
          setRecipes(result.recipes);

          // ── Onboarding: step 1 → 2 ──────────────────────────────────
          // First successful spin advances "spin" → "save". Also
          // auto-opens the top result's detail modal — during onboarding
          // we skip the extra tap of picking a card, since the goal is to
          // get a new user to the "Save to My Dinners" button as directly
          // as possible. Outside onboarding this auto-open never fires.
          if (onboardingStep === "spin" && result.recipes.length > 0) {
            advanceOnboarding("save");
            setSelectedRecipe(result.recipes[0]);
          }
        }
      } catch {
        setIsError(true);
        setErrorMessage("No connection — check your internet and try again.");
      } finally {
        setIsLoading(false);
      }
    });
  };

  const addFridgeTag = () => {
    const val = fridgeInput.trim();
    if (!val || fridgeTags.includes(val.toLowerCase())) return;
    setFridgeTags((t) => [...t, val]);
    setFridgeInput("");
  };

  const removeFridgeTag = (tag: string) => {
    setFridgeTags((t) => t.filter((x) => x !== tag));
    setFridgeResults([]);
    setFridgeError("");
  };

  const searchFridge = async () => {
    if (fridgeTags.length === 0) return;
    setFridgeLoading(true);
    setFridgeError("");
    setFridgeResults([]);
    try {
      const result = await fetchRecipes(fridgeTags.join(","));
      if (result.errorMessage) {
        setFridgeError(result.errorMessage);
      } else {
        setFridgeResults(result.recipes);
      }
    } catch {
      setFridgeError("No connection — check your internet and try again.");
    } finally {
      setFridgeLoading(false);
    }
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.foreground }]}>That's Dinner</Text>
          <Pressable onPress={() => setShowSettings(true)} style={[styles.settingsBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="settings" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Mode toggle — dimmed + disabled during the "spin" onboarding
            step so a brand-new user can't wander into Fridge mode before
            completing their first spin. Once onboarding moves past "spin"
            (or is skipped), this behaves exactly as before. */}
        <View
          pointerEvents={onboardingStep === "spin" ? "none" : "auto"}
          style={[
            styles.modeToggle,
            { backgroundColor: colors.secondary, borderColor: colors.border },
            onboardingStep === "spin" && { opacity: 0.4 },
          ]}
        >
          <Pressable
            onPress={() => { setMode("spin"); }}
            style={[styles.modeToggleBtn, mode === "spin" && { backgroundColor: colors.primary, borderRadius: 8 }]}
          >
            <Feather name="shuffle" size={14} color={mode === "spin" ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.modeToggleText, { color: mode === "spin" ? colors.primaryForeground : colors.mutedForeground }]}>Spin</Text>
          </Pressable>
          <Pressable
            onPress={() => { setMode("fridge"); }}
            style={[styles.modeToggleBtn, mode === "fridge" && { backgroundColor: colors.primary, borderRadius: 8 }]}
          >
            <Feather name="package" size={14} color={mode === "fridge" ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.modeToggleText, { color: mode === "fridge" ? colors.primaryForeground : colors.mutedForeground }]}>What's in my fridge?</Text>
          </Pressable>
        </View>

        {mode === "fridge" ? (
          <>
            {/* Fridge ingredient input */}
            <View style={[styles.fridgeInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={[styles.fridgeInput, { color: colors.foreground }]}
                value={fridgeInput}
                onChangeText={setFridgeInput}
                placeholder="Add an ingredient…"
                placeholderTextColor={colors.mutedForeground}
                onSubmitEditing={addFridgeTag}
                returnKeyType="done"
                autoCapitalize="words"
              />
              <Pressable
                onPress={addFridgeTag}
                disabled={!fridgeInput.trim()}
                style={[styles.fridgeAddBtn, { backgroundColor: fridgeInput.trim() ? colors.primary : colors.muted }]}
              >
                <Feather name="plus" size={18} color={fridgeInput.trim() ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>


            {/* Common ingredient suggestion chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              style={styles.chipsScroll}
            >
              {FRIDGE_SUGGESTIONS.filter((s) => !fridgeTags.map((t) => t.toLowerCase()).includes(s.toLowerCase())).map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => {
                    setFridgeTags((t) => [...t, suggestion]);
                    Haptics.selectionAsync();
                  }}
                  style={[styles.chip, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{suggestion}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Ingredient tags */}
            {fridgeTags.length > 0 && (
              <View style={styles.fridgeTags}>
                {fridgeTags.map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => removeFridgeTag(tag)}
                    style={[styles.fridgeTag, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                  >
                    <Text style={[styles.fridgeTagText, { color: colors.foreground }]}>{tag}</Text>
                    <Feather name="x" size={12} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Search button */}
            <Pressable
              onPress={searchFridge}
              disabled={fridgeTags.length === 0 || fridgeLoading}
              style={({ pressed }) => [
                styles.spinBtn,
                { backgroundColor: fridgeTags.length === 0 ? colors.muted : fridgeLoading ? colors.secondary : colors.primary },
                pressed && fridgeTags.length > 0 && !fridgeLoading && { transform: [{ scale: 0.96 }], opacity: 0.9 },
              ]}
            >
              {fridgeLoading
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Text style={[styles.spinBtnText, { color: fridgeTags.length === 0 ? colors.mutedForeground : colors.primaryForeground }]}>
                    {fridgeTags.length === 0 ? "ADD INGREDIENTS FIRST" : "FIND RECIPES"}
                  </Text>
              }
            </Pressable>

            {/* Fridge results */}
            {fridgeError ? (
              <View style={styles.center}>
                <Feather name="alert-circle" size={24} color={colors.destructive} />
                <Text style={[styles.statusText, { color: colors.destructive }]}>{fridgeError}</Text>
                <Pressable onPress={searchFridge} style={[styles.retryBtn, { borderColor: colors.primary }]}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
                </Pressable>
              </View>
            ) : !fridgeLoading && fridgeResults.length > 0 ? (
              <View style={styles.results}>
                <Text style={[styles.resultsTitle, { color: colors.foreground }]}>Recipes using your ingredients</Text>
                <Text style={[styles.resultsSub, { color: colors.mutedForeground }]}>
                  Using {fridgeTags.join(", ")}
                </Text>
                {fridgeResults.map((r) => (
                  <RecipeCard key={r.id} recipe={r} onPress={() => setSelectedRecipe(r)} />
                ))}
              </View>
            ) : !fridgeLoading && fridgeTags.length > 0 && fridgeResults.length === 0 && !fridgeError ? (
              <View style={styles.center}>
                <Feather name="search" size={24} color={colors.mutedForeground} />
                <Text style={[styles.statusText, { color: colors.mutedForeground }]}>No recipes found — try different ingredients</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.machine}>
              <SlotColumn label="PROTEIN" items={wheels.proteins} animValue={proteinY} />
              <SlotColumn label="CARBS" items={wheels.carbs} animValue={carbY} />
              <SlotColumn label="VEGGIE" items={wheels.veggies} animValue={veggieY} />
            </View>

            <OnboardingPulseRing active={onboardingStep === "spin" && !spinning}>
              <Pressable
                onPress={spin}
                disabled={spinning}
                style={({ pressed }) => [styles.spinBtn, { backgroundColor: spinning ? colors.secondary : colors.primary }, pressed && !spinning && { transform: [{ scale: 0.96 }], opacity: 0.9 }]}
              >
                <Text style={[styles.spinBtnText, { color: spinning ? colors.mutedForeground : colors.primaryForeground }]}>
                  {spinning ? "SPINNING..." : "SPIN"}
                </Text>
              </Pressable>
            </OnboardingPulseRing>

            {isLoading && (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={[styles.statusText, { color: colors.mutedForeground }]}>Finding recipes…</Text>
              </View>
            )}

            {isError && (
              <View style={styles.center}>
                <Feather name="alert-circle" size={24} color={colors.destructive} />
                <Text style={[styles.statusText, { color: colors.destructive }]}>{errorMessage || "Couldn't load recipes. Try again."}</Text>
                <Pressable onPress={spin} style={[styles.retryBtn, { borderColor: colors.primary }]}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try Again</Text>
                </Pressable>
              </View>
            )}

            {!isLoading && !isError && recipes.length > 0 && (
              <View style={styles.results}>
                <Text style={[styles.resultsTitle, { color: colors.foreground }]}>Suggested Recipes</Text>
                <Text style={[styles.resultsSub, { color: colors.mutedForeground }]}>
                  Using {wheels.proteins[selProtein]}, {wheels.carbs[selCarb]} and {wheels.veggies[selVeggie]}
                </Text>
                {recipes.map((r) => (
                  <RecipeCard key={r.id} recipe={r} onPress={() => setSelectedRecipe(r)} />
                ))}
              </View>
            )}

            {!isLoading && !isError && recipes.length === 0 && currentIngredients && (
              <View style={styles.center}>
                <Feather name="search" size={24} color={colors.mutedForeground} />
                <Text style={[styles.statusText, { color: colors.mutedForeground }]}>No recipes found for this combination</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <RecipeDetailModal
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onAddToGrocery={handleAddToGrocery}
        isSaved={isRecipeSaved(selectedRecipe)}
        onToggleSave={handleToggleSaveRecipe}
        onboardingHighlightSave={onboardingStep === "save"}
      />
      <WheelSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        wheels={wheels}
        onSave={handleSaveWheels}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  settingsBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 4 },
  machine: { flexDirection: "row", gap: 8, marginBottom: 20 },
  colWrap: { flex: 1, alignItems: "center" },
  colLabel: { fontSize: 10, letterSpacing: 2, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  colViewport: { width: "100%", overflow: "hidden", borderRadius: 14, borderWidth: 1, position: "relative" },
  slotItem: { justifyContent: "center", alignItems: "center" },
  slotText: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center", paddingHorizontal: 4 },
  selectionBox: { position: "absolute", top: ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT, borderTopWidth: 1.5, borderBottomWidth: 1.5, zIndex: 10 },
  spinBtn: { borderRadius: 50, paddingVertical: 18, alignItems: "center", marginBottom: 32 },
  spinBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 3 },
  onboardingHint: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: -8, marginBottom: 12 },
  center: { alignItems: "center", gap: 10, paddingVertical: 24 },
  statusText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  modeToggle: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 4, gap: 4, marginBottom: 20 },
  modeToggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  modeToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fridgeInputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 12 },
  fridgeInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  fridgeAddBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  fridgeTags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  fridgeTag: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  fridgeTagText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  chipsScroll: { marginBottom: 12 },
  chipsRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  results: { gap: 10 },
  resultsTitle: { fontSize: 19, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  resultsSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  recipeCard: { borderRadius: 12, overflow: "hidden", borderWidth: 1 },
  recipeImg: { width: "100%", height: 140 },
  recipeBody: { padding: 12, gap: 6 },
  recipeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  recipeFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  timeText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tapHint: { flexDirection: "row", alignItems: "center", gap: 2 },
  tapHintText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  categorySection: { marginBottom: 24 },
  categoryLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 10 },
  ingredientRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  ingredientText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  addRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  addBtn: { width: 46, height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  saveBtn: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recipeModalImage: { width: "100%", height: 240 },
  floatBtn: { position: "absolute", top: 16, width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  floatBtnLeft: { left: 16 },
  floatBtnRight: { right: 16 },
  modalBody: { padding: 20, gap: 6 },
  recipeModalTitle: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 28, marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  servingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, marginTop: 8, marginBottom: 4 },
  servingsLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepperBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepperValue: { fontSize: 18, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "center" },
  groceryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginTop: 4, marginBottom: 4 },
  groceryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginTop: 16, marginBottom: 8 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  ingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  ingDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  ingText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
