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

// Staggered stop durations: Protein lands first, then Carbs, then Veggies
const SPIN_ROUNDS = 5;
const PROTEIN_DUR = 1600;
const CARB_DUR = 2200;
const VEGGIE_DUR = 2800;

function makeDisplay(items: string[]) {
  return Array.from({ length: COPY_COUNT }, () => items).flat();
}

function initialY(items: string[], idx = 0) {
  const j = START_COPY * items.length + idx;
  return ITEM_HEIGHT * (1 - j);
}

function spinTargetY(items: string[], prevIdx: number, newIdx: number) {
  const j =
    START_COPY * items.length +
    prevIdx +
    SPIN_ROUNDS * items.length +
    newIdx;
  return ITEM_HEIGHT * (1 - j);
}

function resetY(items: string[], newIdx: number) {
  const j = START_COPY * items.length + newIdx;
  return ITEM_HEIGHT * (1 - j);
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Recipe = {
  id: number;
  title: string;
  image: string;
  readyInMinutes: number;
  ingredients: string[];
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
  if (!recipe) return null;

  return (
    <Modal
      visible={!!recipe}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.modalRoot, { backgroundColor: colors.background }]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 48 }}
        >
          {/* Header image */}
          <Image source={{ uri: recipe.image }} style={styles.modalImage} />

          {/* Close button */}
          <Pressable
            onPress={onClose}
            style={[
              styles.closeBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>

          <View style={styles.modalBody}>
            {/* Title + time */}
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {recipe.title}
            </Text>
            <View style={styles.timeRow}>
              <Feather name="clock" size={14} color={colors.primary} />
              <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
                {recipe.readyInMinutes} min
              </Text>
            </View>

            {/* Ingredients */}
            {recipe.ingredients.length > 0 && (
              <>
                <Text
                  style={[styles.sectionLabel, { color: colors.mutedForeground }]}
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
                  {recipe.ingredients.map((ing, i) => (
                    <View key={i} style={styles.ingRow}>
                      <View
                        style={[
                          styles.ingDot,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                      <Text
                        style={[styles.ingText, { color: colors.foreground }]}
                      >
                        {ing}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Instructions */}
            {recipe.instructions.length > 0 && (
              <>
                <Text
                  style={[styles.sectionLabel, { color: colors.mutedForeground }]}
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
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
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

    // All three start together but stop at staggered times:
    // Protein lands first → Carbs second → Veggies last
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
          Spin the reels to discover your next meal
        </Text>

        {/* Slot Machine — order: Protein, Carbs, Veggies */}
        <View style={styles.machine}>
          <SlotColumn label="PROTEIN" items={PROTEINS} animValue={proteinY} />
          <SlotColumn label="CARBS" items={CARBS} animValue={carbY} />
          <SlotColumn label="VEGGIE" items={VEGGIES} animValue={veggieY} />
        </View>

        {/* Spin Button */}
        <Pressable
          onPress={spin}
          disabled={spinning}
          style={({ pressed }) => [
            styles.spinBtn,
            {
              backgroundColor: spinning ? colors.secondary : colors.primary,
            },
            pressed && !spinning && {
              transform: [{ scale: 0.96 }],
              opacity: 0.9,
            },
          ]}
        >
          <Text
            style={[
              styles.spinBtnText,
              {
                color: spinning
                  ? colors.mutedForeground
                  : colors.primaryForeground,
              },
            ]}
          >
            {spinning ? "SPINNING..." : "SPIN"}
          </Text>
        </Pressable>

        {/* Loading */}
        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text
              style={[styles.statusText, { color: colors.mutedForeground }]}
            >
              Finding recipes…
            </Text>
          </View>
        )}

        {/* Error */}
        {isError && (
          <View style={styles.center}>
            <Feather
              name="alert-circle"
              size={24}
              color={colors.destructive}
            />
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

        {/* Recipe Results */}
        {!isLoading && !isError && recipes.length > 0 && (
          <View style={styles.results}>
            <Text
              style={[styles.resultsTitle, { color: colors.foreground }]}
            >
              Suggested Recipes
            </Text>
            <Text
              style={[styles.resultsSub, { color: colors.mutedForeground }]}
            >
              Using {PROTEINS[selProtein]}, {CARBS[selCarb]} and{" "}
              {VEGGIES[selVeggie]}
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

        {!isLoading &&
          !isError &&
          recipes.length === 0 &&
          ingredientsQuery && (
            <View style={styles.center}>
              <Feather
                name="search"
                size={24}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.statusText, { color: colors.mutedForeground }]}
              >
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
  spinBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: 3,
  },
  center: { alignItems: "center", gap: 10, paddingVertical: 24 },
  statusText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  results: { gap: 10 },
  resultsTitle: {
    fontSize: 19,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  resultsSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  recipeCard: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
  },
  recipeImg: { width: 90, height: 90 },
  recipeBody: {
    flex: 1,
    padding: 12,
    justifyContent: "space-between",
  },
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
  // Modal
  modalRoot: { flex: 1 },
  modalImage: { width: "100%", height: 240 },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: { padding: 20, gap: 8 },
  modalTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  ingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  ingDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
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
  noDetailText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 24 },
});
