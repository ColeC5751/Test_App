import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef, useState } from "react";
import {
  Animated,
  Easing,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSearchRecipes } from "@workspace/api-client-react";

// ─── Slot machine constants ───────────────────────────────────────────────────
const CARBS = ["Rice", "Pasta", "Potatoes", "Bread"];
const PROTEINS = ["Chicken", "Beef", "Salmon", "Tofu"];
const VEGGIES = ["Broccoli", "Spinach", "Carrots", "Peppers"];

const ITEM_HEIGHT = 80;
const VISIBLE = 3;
const COPY_COUNT = 10;
const START_COPY = 2;
const SPIN_ROUNDS = 5;

function makeDisplay(items: string[]) {
  return Array.from({ length: COPY_COUNT }, () => items).flat();
}

// Position calculations — see comments inline
function initialY(items: string[], idx = 0) {
  // Center item at index `START_COPY * len + idx` in the viewport's middle slot
  const j = START_COPY * items.length + idx;
  return ITEM_HEIGHT * (1 - j);
}

function spinTargetY(items: string[], prevIdx: number, newIdx: number) {
  // Spin SPIN_ROUNDS full rotations past the previous position, land on newIdx
  const j =
    START_COPY * items.length +
    prevIdx +
    SPIN_ROUNDS * items.length +
    newIdx;
  return ITEM_HEIGHT * (1 - j);
}

function resetY(items: string[], newIdx: number) {
  // Reset to equivalent position in the START_COPY region (no visible jump)
  const j = START_COPY * items.length + newIdx;
  return ITEM_HEIGHT * (1 - j);
}

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
        {/* Selection highlight */}
        <View
          style={[styles.selectionBox, { borderColor: colors.primary, pointerEvents: "none" }]}
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

// ─── RecipeCard ──────────────────────────────────────────────────────────────
function RecipeCard({
  recipe,
}: {
  recipe: {
    id: number;
    title: string;
    image: string;
    readyInMinutes: number;
  };
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.recipeCard,
        { backgroundColor: colors.card, borderColor: colors.border },
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
        <View style={styles.timeRow}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {recipe.readyInMinutes} min
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── SpinScreen ──────────────────────────────────────────────────────────────
export default function SpinScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  // Selected slot indices
  const [selCarb, setSelCarb] = useState(0);
  const [selProtein, setSelProtein] = useState(0);
  const [selVeggie, setSelVeggie] = useState(0);

  // Animated position values
  const carbY = useRef(new Animated.Value(initialY(CARBS))).current;
  const proteinY = useRef(new Animated.Value(initialY(PROTEINS))).current;
  const veggieY = useRef(new Animated.Value(initialY(VEGGIES))).current;

  const [spinning, setSpinning] = useState(false);
  const [ingredientsQuery, setIngredientsQuery] = useState("");

  const { data, isLoading, isError } = useSearchRecipes(
    { ingredients: ingredientsQuery },
    { query: { enabled: !!ingredientsQuery } },
  );
  const recipes = data?.recipes ?? [];

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const newCarb = Math.floor(Math.random() * CARBS.length);
    const newProtein = Math.floor(Math.random() * PROTEINS.length);
    const newVeggie = Math.floor(Math.random() * VEGGIES.length);

    const easing = Easing.out(Easing.cubic);

    Animated.parallel([
      Animated.timing(carbY, {
        toValue: spinTargetY(CARBS, selCarb, newCarb),
        duration: 1800,
        easing,
        useNativeDriver: false,
      }),
      Animated.timing(proteinY, {
        toValue: spinTargetY(PROTEINS, selProtein, newProtein),
        duration: 2100,
        easing,
        useNativeDriver: false,
      }),
      Animated.timing(veggieY, {
        toValue: spinTargetY(VEGGIES, selVeggie, newVeggie),
        duration: 1500,
        easing,
        useNativeDriver: false,
      }),
    ]).start(() => {
      // Reset to equivalent position in middle copy region (no visible jump)
      carbY.setValue(resetY(CARBS, newCarb));
      proteinY.setValue(resetY(PROTEINS, newProtein));
      veggieY.setValue(resetY(VEGGIES, newVeggie));

      setSelCarb(newCarb);
      setSelProtein(newProtein);
      setSelVeggie(newVeggie);
      setSpinning(false);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setIngredientsQuery(
        `${CARBS[newCarb]},${PROTEINS[newProtein]},${VEGGIES[newVeggie]}`,
      );
    });
  };

  return (
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

      {/* Slot Machine */}
      <View style={styles.machine}>
        <SlotColumn label="CARBS" items={CARBS} animValue={carbY} />
        <SlotColumn label="PROTEIN" items={PROTEINS} animValue={proteinY} />
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
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
            Finding recipes…
          </Text>
        </View>
      )}

      {/* Error */}
      {isError && (
        <View style={styles.center}>
          <Feather name="alert-circle" size={24} color={colors.destructive} />
          <Text
            style={[styles.statusText, { color: colors.destructive }]}
          >
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
          <Text style={[styles.resultsTitle, { color: colors.foreground }]}>
            Suggested Recipes
          </Text>
          <Text style={[styles.resultsSub, { color: colors.mutedForeground }]}>
            Using {CARBS[selCarb]}, {PROTEINS[selProtein]} and {VEGGIES[selVeggie]}
          </Text>
          {recipes.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 28,
  },
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
    fontSize: 14,
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
  resultsSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 6,
  },
  recipeCard: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
  },
  recipeImg: { width: 90, height: 90 },
  recipeBody: { flex: 1, padding: 12, justifyContent: "space-between" },
  recipeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  timeText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
