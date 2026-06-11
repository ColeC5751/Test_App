import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
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

import { useColors } from "@/hooks/useColors";

const DEFAULT_PROTEINS = ["Fish", "Chicken", "Ground Beef", "Pork"];
const DEFAULT_CARBS = ["Rice", "Pasta", "Potatoes", "Bread"];
const DEFAULT_VEGGIES = ["Broccoli", "Spinach", "Carrots", "Peppers"];

const STORAGE_KEY = "@recipe_roulette_personal";
const WHEELS_KEY = "@recipe_roulette_wheels";

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

type Macros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

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

type PersonalRecipe = {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
};

type WheelData = {
  proteins: string[];
  carbs: string[];
  veggies: string[];
};

async function fetchRecipes(ingredients: string): Promise<Recipe[]> {
  const res = await fetch(
    `https://test-app-api-server.vercel.app/api/recipes/search?ingredients=${encodeURIComponent(ingredients)}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.recipes ?? [];
}

function MacroBar({ macros, servings, baseServings, colors }: { macros: Macros; servings: number; baseServings: number; colors: ReturnType<typeof useColors> }) {
  const scale = servings / baseServings;
  const items: { label: string; value: number; unit: string; color: string }[] = [
    { label: "Calories", value: Math.round(macros.calories * scale), unit: "kcal", color: colors.primary },
    { label: "Protein", value: Math.round(macros.protein * scale), unit: "g", color: "#7C8C5E" },
    { label: "Carbs", value: Math.round(macros.carbs * scale), unit: "g", color: "#C8A86B" },
    { label: "Fat", value: Math.round(macros.fat * scale), unit: "g", color: "#B87333" },
    { label: "Fiber", value: Math.round(macros.fiber * scale), unit: "g", color: "#6B8E6B" },
  ];
  return (
    <View style={[macroStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[macroStyles.heading, { color: colors.mutedForeground }]}>NUTRITION PER SERVING</Text>
      <View style={macroStyles.row}>
        {items.map((item) => (
          <View key={item.label} style={macroStyles.cell}>
            <Text style={[macroStyles.value, { color: colors.foreground }]}>{item.value}</Text>
            <Text style={[macroStyles.unit, { color: item.color }]}>{item.unit}</Text>
            <Text style={[macroStyles.label, { color: colors.mutedForeground }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MacroPills({ macros, colors }: { macros: Macros; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={macroStyles.pillRow}>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{macros.calories}</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>kcal</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{macros.protein}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>protein</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{macros.carbs}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>carbs</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{macros.fat}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>fat</Text>
      </View>
    </View>
  );
}

const macroStyles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 8, marginBottom: 4 },
  heading: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  cell: { alignItems: "center", flex: 1 },
  value: { fontSize: 17, fontFamily: "Inter_700Bold" },
  unit: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  label: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  pillLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
});

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

function RecipeDetailModal({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const colors = useColors();
  const [currentServings, setCurrentServings] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!recipe) { setSaved(false); return; }
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => {
        if (!json) { setSaved(false); return; }
        const list: PersonalRecipe[] = JSON.parse(json);
        setSaved(list.some((r) => r.id === `spoonacular_${recipe.id}`));
      })
      .catch(() => setSaved(false));
  }, [recipe?.id]);

  const handleSave = async () => {
    if (!recipe) return;
    const recipeId = `spoonacular_${recipe.id}`;
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      const list: PersonalRecipe[] = json ? JSON.parse(json) : [];
      if (saved) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list.filter((r) => r.id !== recipeId)));
        setSaved(false);
      } else {
        const entry: PersonalRecipe = {
          id: recipeId,
          name: recipe.title,
          ingredients: recipe.ingredients.map((i) => i.original || `${formatAmt(i.amount)} ${i.unit} ${i.name}`.trim()).join(", "),
          steps: recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
          photoUrl: recipe.image,
          createdAt: Date.now(),
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...list, entry]));
        setSaved(true);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
  };

  const baseServings = recipe?.servings ?? 4;
  const servings = currentServings ?? baseServings;

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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          <Image source={{ uri: recipe.image }} style={styles.recipeModalImage} />
          <Pressable onPress={handleClose} style={[styles.floatBtn, styles.floatBtnRight, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={handleSave} style={[styles.floatBtn, styles.floatBtnRight2, { backgroundColor: saved ? colors.primary : colors.card, borderColor: saved ? colors.primary : colors.border }]}>
            <Feather name="bookmark" size={18} color={saved ? colors.primaryForeground : colors.foreground} />
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
                <Pressable onPress={() => { setCurrentServings((s) => Math.max(1, (s ?? baseServings) - 1)); Haptics.selectionAsync(); }} style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="minus" size={16} color={colors.foreground} />
                </Pressable>
                <Text style={[styles.stepperValue, { color: colors.foreground }]}>{servings}</Text>
                <Pressable onPress={() => { setCurrentServings((s) => Math.min(20, (s ?? baseServings) + 1)); Haptics.selectionAsync(); }} style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="plus" size={16} color={colors.foreground} />
                </Pressable>
              </View>
            </View>

            {recipe.macros && (
              <MacroBar macros={recipe.macros} servings={servings} baseServings={baseServings} colors={colors} />
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
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [currentIngredients, setCurrentIngredients] = useState("");

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
      setRecipes([]);

      try {
        const results = await fetchRecipes(ingredients);
        setRecipes(results);
      } catch {
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    });
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.heading, { color: colors.foreground }]}>That's Dinner</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>Spin to find tonight's dinner</Text>
          </View>
          <Pressable onPress={() => setShowSettings(true)} style={[styles.settingsBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="settings" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        <View style={styles.machine}>
          <SlotColumn label="PROTEIN" items={wheels.proteins} animValue={proteinY} />
          <SlotColumn label="CARBS" items={wheels.carbs} animValue={carbY} />
          <SlotColumn label="VEGGIE" items={wheels.veggies} animValue={veggieY} />
        </View>

        <Pressable
          onPress={spin}
          disabled={spinning}
          style={({ pressed }) => [styles.spinBtn, { backgroundColor: spinning ? colors.secondary : colors.primary }, pressed && !spinning && { transform: [{ scale: 0.96 }], opacity: 0.9 }]}
        >
          <Text style={[styles.spinBtnText, { color: spinning ? colors.mutedForeground : colors.primaryForeground }]}>
            {spinning ? "SPINNING..." : "SPIN"}
          </Text>
        </Pressable>

        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>Finding recipes…</Text>
          </View>
        )}

        {isError && (
          <View style={styles.center}>
            <Feather name="alert-circle" size={24} color={colors.destructive} />
            <Text style={[styles.statusText, { color: colors.destructive }]}>Couldn't load recipes. Check your connection.</Text>
            <Pressable onPress={spin} style={[styles.retryBtn, { borderColor: colors.primary }]}>
              <Text style={[styles.retryText, { color: colors.primary }]}>Spin Again</Text>
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
      </ScrollView>

      <RecipeDetailModal recipe={selectedRecipe} onClose={() => setSelectedRecipe(null)} />
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
  center: { alignItems: "center", gap: 10, paddingVertical: 24 },
  statusText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  floatBtnRight2: { right: 62 },
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
