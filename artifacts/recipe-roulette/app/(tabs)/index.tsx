import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
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
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSearchRecipes } from "@workspace/api-client-react";

// ─── Slot data ────────────────────────────────────────────────────────────────
const PROTEINS = ["Fish", "Chicken", "Ground Beef", "Pork"];
const CARBS = ["Rice", "Pasta", "Potatoes", "Bread"];
const VEGGIES = ["Broccoli", "Spinach", "Carrots", "Peppers"];

// ─── Slot math ────────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Format a floating-point amount cleanly, e.g. 1.0 → "1", 1.5 → "1.5" */
function formatAmt(n: number): string {
  if (n <= 0) return "0";
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────
type RecipeIngredient = {
  amount: number;
  unit: string;
  name: string;
  original: string;
};

type Recipe = {
  id: number;
  title: string;
  image: string;
  readyInMinutes: number;
  servings: number;
  ingredients: RecipeIngredient[];
  instructions: string[];
};

// ─── SlotColumn ──────────────────────────────────────────────────────────────
function SlotColumn({
  label,
  items,
  animValue,
}: {
  label: string;
  items: string[];
  animValue: Animated.Value;
}) {
  const colors = useColors();
  const display = makeDisplay(items);
  return (
    <View style={styles.colWrap}>
      <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <View
        style={[
          styles.colViewport,
          {
            height: ITEM_HEIGHT * VISIBLE,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.selectionBox,
            { borderColor: colors.primary, pointerEvents: "none" },
          ]}
        />
        <Animated.View style={{ transform: [{ translateY: animValue }] }}>
          {display.map((item, i) => (
            <View key={i} style={[styles.slotItem, { height: ITEM_HEIGHT }]}>
              <Text style={[styles.slotText, { color: colors.foreground }]}>
                {item}
              </Text>
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

// ─── RecipeDetailModal ────────────────────────────────────────────────────────
function RecipeDetailModal({
  recipe,
  onClose,
}: {
  recipe: Recipe | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const [currentServings, setCurrentServings] = useState<number | null>(null);

  // Reset servings when recipe changes
  const baseServings = recipe?.servings ?? 4;
  const servings = currentServings ?? baseServings;
  const scale = servings / baseServings;

  const handleClose = () => {
    setCurrentServings(null);
    onClose();
  };

  const handleShare = async () => {
    if (!recipe) return;
    const ingList = recipe.ingredients
      .map((ing) => {
        const amt = formatAmt(ing.amount * scale);
        const unit = ing.unit ? `${ing.unit} ` : "";
        return `• ${amt} ${unit}${ing.name}`.trim();
      })
      .join("\n");
    const stepList = recipe.instructions
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");

    const message =
      `${recipe.title}\n` +
      `Servings: ${servings}  |  Ready in: ${recipe.readyInMinutes} min\n\n` +
      (ingList ? `INGREDIENTS\n${ingList}\n\n` : "") +
      (stepList ? `INSTRUCTIONS\n${stepList}` : "");

    try {
      await Share.share({ title: recipe.title, message });
    } catch {
      // user cancelled or share not supported
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (!recipe) return null;

  return (
    <Modal
      visible={!!recipe}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        style={[styles.modalRoot, { backgroundColor: colors.background }]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 48 }}
        >
          {/* Hero image */}
          <Image source={{ uri: recipe.image }} style={styles.modalImage} />

          {/* Floating buttons over image */}
          <Pressable
            onPress={handleClose}
            style={[
              styles.floatBtn,
              styles.floatBtnRight,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={handleShare}
            style={[
              styles.floatBtn,
              styles.floatBtnLeft,
              { backgroundColor: colors.primary },
            ]}
          >
            <Feather name="share" size={18} color={colors.primaryForeground} />
          </Pressable>

          <View style={styles.modalBody}>
            {/* Title + time */}
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {recipe.title}
            </Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Feather name="clock" size={13} color={colors.primary} />
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  {recipe.readyInMinutes} min
                </Text>
              </View>
            </View>

            {/* Servings stepper */}
            <View
              style={[
                styles.servingsRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.servingsLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                SERVINGS
              </Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => {
                    setCurrentServings((s) => Math.max(1, (s ?? baseServings) - 1));
                    Haptics.selectionAsync();
                  }}
                  style={[
                    styles.stepperBtn,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                  ]}
                >
                  <Feather name="minus" size={16} color={colors.foreground} />
                </Pressable>
                <Text
                  style={[styles.stepperValue, { color: colors.foreground }]}
                >
                  {servings}
                </Text>
                <Pressable
                  onPress={() => {
                    setCurrentServings((s) => Math.min(20, (s ?? baseServings) + 1));
                    Haptics.selectionAsync();
                  }}
                  style={[
                    styles.stepperBtn,
                    { backgroundColor: colors.secondary, borderColor: colors.border },
                  ]}
                >
                  <Feather name="plus" size={16} color={colors.foreground} />
                </Pressable>
              </View>
            </View>

            {/* Ingredients */}
            {recipe.ingredients.length > 0 && (
              <>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  INGREDIENTS
                </Text>
                <View
                  style={[
                    styles.sectionCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {recipe.ingredients.map((ing, i) => {
                    const scaledAmt = ing.amount * scale;
                    const amtStr = formatAmt(scaledAmt);
                    const unitStr = ing.unit ? `${ing.unit} ` : "";
                    const line = `${amtStr} ${unitStr}${ing.name}`.trim();
                    return (
                      <View key={i} style={styles.ingRow}>
                        <View
                          style={[
                            styles.ingDot,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                        <Text
                          style={[
                            styles.ingText,
                            { color: colors.foreground },
                          ]}
                        >
                          {line}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Instructions */}
            {recipe.instructions.length > 0 && (
              <>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  INSTRUCTIONS
                </Text>
                {recipe.instructions.map((step, i) => (
                  <View
                    key={i}
                    style={[
                      styles.stepRow,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.stepNum,
                        { backgroundColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepNumText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        {i + 1}
                      </Text>
                    </View>
                    <Text
                      style={[styles.stepText, { color: colors.foreground }]}
                    >
                      {step}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {recipe.ingredients.length === 0 &&
              recipe.instructions.length === 0 && (
                <Text
                  style={[
                    styles.noDetailText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Detailed recipe info is unavailable for this result.
                </Text>
              )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── RecipeCard ───────────────────────────────────────────────────────────────
function RecipeCard({
  recipe,
  onPress,
}: {
  recipe: Recipe;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.recipeCard,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.82 },
      ]}
    >
      <Image source={{ uri: recipe.image }} style={styles.recipeImg} />
      <View style={styles.recipeBody}>
        <Text
          style={[styles.recipeTitle, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {recipe.title}
        </Text>
        <View style={styles.recipeFooter}>
          <View style={styles.timeRow}>
            <Feather name="clock" size={12} color={colors.mutedForeground} />
            <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
              {recipe.readyInMinutes} min
            </Text>
          </View>
          <View style={styles.tapHint}>
            <Text style={[styles.tapHintText, { color: colors.primary }]}>
              View recipe
            </Text>
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ─── SpinScreen ──────────────────────────────────────────────────────────────
export default function SpinScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [selProtein, setSelProtein] = useState(0);
  const [selCarb, setSelCarb] = useState(0);
  const [selVeggie, setSelVeggie] = useState(0);

  const proteinY = useRef(new Animated.Value(initialY(PROTEINS))).current;
  const carbY = useRef(new Animated.Value(initialY(CARBS))).current;
  const veggieY = useRef(new Animated.Value(initialY(VEGGIES))).current;

  const [spinning, setSpinning] = useState(false);
  const [ingredientsQuery, setIngredientsQuery] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  const { data, isLoading, isError } = useSearchRecipes(
    { ingredients: ingredientsQuery },
    { query: { enabled: !!ingredientsQuery } },
  );
  const recipes = (data?.recipes ?? []) as Recipe[];

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const newProtein = Math.floor(Math.random() * PROTEINS.length);
    const newCarb = Math.floor(Math.random() * CARBS.length);
    const newVeggie = Math.floor(Math.random() * VEGGIES.length);

    const easing = Easing.out(Easing.cubic);

    Animated.parallel([
      Animated.timing(proteinY, {
        toValue: spinTargetY(PROTEINS, selProtein, newProtein),
        duration: PROTEIN_DUR,
        easing,
        useNativeDriver: false,
      }),
      Animated.timing(carbY, {
        toValue: spinTargetY(CARBS, selCarb, newCarb),
        duration: CARB_DUR,
        easing,
        useNativeDriver: false,
      }),
      Animated.timing(veggieY, {
        toValue: spinTargetY(VEGGIES, selVeggie, newVeggie),
        duration: VEGGIE_DUR,
        easing,
        useNativeDriver: false,
      }),
    ]).start(() => {
      proteinY.setValue(resetY(PROTEINS, newProtein));
      carbY.setValue(resetY(CARBS, newCarb));
      veggieY.setValue(resetY(VEGGIES, newVeggie));

      setSelProtein(newProtein);
      setSelCarb(newCarb);
      setSelVeggie(newVeggie);
      setSpinning(false);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setIngredientsQuery(
        `${PROTEINS[newProtein]},${CARBS[newCarb]},${VEGGIES[newVeggie]}`,
      );
    });
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{
          paddingTop: topPad + 32,
          paddingHorizontal: 20,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.heading, { color: colors.foreground }]}>
          Ingredient Spin
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Spin to find tonight's dinner
        </Text>

        <View style={styles.machine}>
          <SlotColumn label="PROTEIN" items={PROTEINS} animValue={proteinY} />
          <SlotColumn label="CARBS" items={CARBS} animValue={carbY} />
          <SlotColumn label="VEGGIE" items={VEGGIES} animValue={veggieY} />
        </View>

        <Pressable
          onPress={spin}
          disabled={spinning}
          style={({ pressed }) => [
            styles.spinBtn,
            { backgroundColor: spinning ? colors.secondary : colors.primary },
            pressed && !spinning && { transform: [{ scale: 0.96 }], opacity: 0.9 },
          ]}
        >
          <Text
            style={[
              styles.spinBtnText,
              { color: spinning ? colors.mutedForeground : colors.primaryForeground },
            ]}
          >
            {spinning ? "SPINNING..." : "SPIN"}
          </Text>
        </Pressable>

        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              Finding recipes…
            </Text>
          </View>
        )}

        {isError && (
          <View style={styles.center}>
            <Feather name="alert-circle" size={24} color={colors.destructive} />
            <Text style={[styles.statusText, { color: colors.destructive }]}>
              Couldn't load recipes. Check your connection.
            </Text>
            <Pressable
              onPress={spin}
              style={[styles.retryBtn, { borderColor: colors.primary }]}
            >
              <Text style={[styles.retryText, { color: colors.primary }]}>
                Spin Again
              </Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !isError && recipes.length > 0 && (
          <View style={styles.results}>
            <Text style={[styles.resultsTitle, { color: colors.foreground }]}>
              Suggested Recipes
            </Text>
            <Text style={[styles.resultsSub, { color: colors.mutedForeground }]}>
              Using {PROTEINS[selProtein]}, {CARBS[selCarb]} and {VEGGIES[selVeggie]}
            </Text>
            {recipes.map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                onPress={() => setSelectedRecipe(r)}
              />
            ))}
          </View>
        )}

        {!isLoading && !isError && recipes.length === 0 && ingredientsQuery && (
          <View style={styles.center}>
            <Feather name="search" size={24} color={colors.mutedForeground} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              No recipes found for this combination
            </Text>
          </View>
        )}
      </ScrollView>

      <RecipeDetailModal
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
      />
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 28 },
  machine: { flexDirection: "row", gap: 8, marginBottom: 20 },
  colWrap: { flex: 1, alignItems: "center" },
  colLabel: {
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  colViewport: {
    width: "100%",
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    position: "relative",
  },
  slotItem: { justifyContent: "center", alignItems: "center" },
  slotText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  selectionBox: {
    position: "absolute",
    top: ITEM_HEIGHT,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    zIndex: 10,
  },
  spinBtn: {
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 32,
  },
  spinBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 3 },
  center: { alignItems: "center", gap: 10, paddingVertical: 24 },
  statusText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  results: { gap: 10 },
  resultsTitle: { fontSize: 19, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  resultsSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  recipeCard: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
  },
  recipeImg: { width: 90, height: 90 },
  recipeBody: { flex: 1, padding: 12, justifyContent: "space-between" },
  recipeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  recipeFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  timeText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tapHint: { flexDirection: "row", alignItems: "center", gap: 2 },
  tapHintText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  // ── Modal ──
  modalRoot: { flex: 1 },
  modalImage: { width: "100%", height: 240 },
  floatBtn: {
    position: "absolute",
    top: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  floatBtnLeft: { left: 16 },
  floatBtnRight: { right: 16 },
  modalBody: { padding: 20, gap: 6 },
  modalTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
    marginBottom: 4,
  },
  metaRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  // Servings stepper
  servingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  servingsLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    minWidth: 28,
    textAlign: "center",
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  ingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  ingDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  ingText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noDetailText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 24,
  },
});
