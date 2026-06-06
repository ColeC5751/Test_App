import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const STORAGE_KEY = "@recipe_roulette_personal";

interface PersonalRecipe {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

export default function RouletteScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [recipes, setRecipes] = useState<PersonalRecipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [picked, setPicked] = useState<PersonalRecipe | null>(null);

  const [formName, setFormName] = useState("");
  const [formIngredients, setFormIngredients] = useState("");
  const [formSteps, setFormSteps] = useState("");
  const [formPhoto, setFormPhoto] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const json = await AsyncStorage.getItem(STORAGE_KEY);
        if (json) setRecipes(JSON.parse(json));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const persist = async (updated: PersonalRecipe[]) => {
    setRecipes(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const addRecipe = async () => {
    if (!formName.trim() || !formIngredients.trim() || !formSteps.trim())
      return;
    const recipe: PersonalRecipe = {
      id: generateId(),
      name: formName.trim(),
      ingredients: formIngredients.trim(),
      steps: formSteps.trim(),
      photoUrl: formPhoto.trim() || undefined,
      createdAt: Date.now(),
    };
    await persist([...recipes, recipe]);
    setFormName("");
    setFormIngredients("");
    setFormSteps("");
    setFormPhoto("");
    setShowForm(false);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const deleteRecipe = async (id: string) => {
    await persist(recipes.filter((r) => r.id !== id));
    if (picked?.id === id) setPicked(null);
  };

  const spinRecipe = () => {
    if (recipes.length === 0 || spinning) return;
    setSpinning(true);
    setPicked(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => {
      const idx = Math.floor(Math.random() * recipes.length);
      setPicked(recipes[idx]);
      setSpinning(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 1200);
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.secondary,
      borderColor: colors.border,
      color: colors.foreground,
    },
  ];

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: topPad + 32,
        paddingHorizontal: 20,
        paddingBottom: 120,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.heading, { color: colors.foreground }]}>
        Recipe Roulette
      </Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Spin for a random recipe from your collection
      </Text>

      {/* Spin Button */}
      <Pressable
        onPress={spinRecipe}
        disabled={recipes.length === 0 || spinning}
        style={({ pressed }) => [
          styles.spinBtn,
          {
            backgroundColor:
              recipes.length === 0
                ? colors.muted
                : spinning
                  ? colors.secondary
                  : colors.primary,
          },
          pressed && recipes.length > 0 && { transform: [{ scale: 0.96 }], opacity: 0.9 },
        ]}
      >
        {spinning ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text
            style={[
              styles.spinBtnText,
              {
                color:
                  recipes.length === 0
                    ? colors.mutedForeground
                    : colors.primaryForeground,
              },
            ]}
          >
            {recipes.length === 0 ? "ADD RECIPES TO SPIN" : "SPIN"}
          </Text>
        )}
      </Pressable>

      {/* Picked Recipe */}
      {picked && (
        <View
          style={[
            styles.pickedCard,
            { backgroundColor: colors.card, borderColor: colors.primary },
          ]}
        >
          <View style={styles.pickedHeader}>
            <View
              style={[styles.badge, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: colors.primaryForeground },
                ]}
              >
                Tonight's Pick
              </Text>
            </View>
            <Pressable onPress={() => setPicked(null)}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {picked.photoUrl ? (
            <Image
              source={{ uri: picked.photoUrl }}
              style={styles.pickedImage}
            />
          ) : null}
          <Text style={[styles.pickedName, { color: colors.foreground }]}>
            {picked.name}
          </Text>
          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            INGREDIENTS
          </Text>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>
            {picked.ingredients}
          </Text>
          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            STEPS
          </Text>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>
            {picked.steps}
          </Text>
        </View>
      )}

      {/* Recipe List Header */}
      <View style={styles.listHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.listTitle, { color: colors.foreground }]}>
            My Recipes
          </Text>
          {recipes.length > 0 ? (
            <Text style={[styles.listTitle, { color: colors.mutedForeground }]}>
              {recipes.length}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setShowForm(!showForm)}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
        >
          <Feather
            name={showForm ? "minus" : "plus"}
            size={18}
            color={colors.primaryForeground}
          />
        </Pressable>
      </View>

      {/* Add Form */}
      {showForm && (
        <View
          style={[
            styles.form,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[styles.formLabel, { color: colors.mutedForeground }]}
          >
            RECIPE NAME
          </Text>
          <TextInput
            style={inputStyle}
            value={formName}
            onChangeText={setFormName}
            placeholder="e.g. Garlic Butter Salmon"
            placeholderTextColor={colors.mutedForeground}
          />
          <Text
            style={[styles.formLabel, { color: colors.mutedForeground }]}
          >
            INGREDIENTS
          </Text>
          <TextInput
            style={[inputStyle, styles.multiInput]}
            value={formIngredients}
            onChangeText={setFormIngredients}
            placeholder="Salmon, garlic, butter, lemon..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
          />
          <Text
            style={[styles.formLabel, { color: colors.mutedForeground }]}
          >
            STEPS
          </Text>
          <TextInput
            style={[inputStyle, styles.multiInput]}
            value={formSteps}
            onChangeText={setFormSteps}
            placeholder="1. Preheat pan... 2. Season salmon..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
          />
          <Text
            style={[styles.formLabel, { color: colors.mutedForeground }]}
          >
            PHOTO URL (optional)
          </Text>
          <TextInput
            style={inputStyle}
            value={formPhoto}
            onChangeText={setFormPhoto}
            placeholder="https://..."
            placeholderTextColor={colors.mutedForeground}
            keyboardType="url"
            autoCapitalize="none"
          />
          <Pressable
            onPress={addRecipe}
            disabled={!formName.trim() || !formIngredients.trim() || !formSteps.trim()}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                backgroundColor:
                  !formName.trim() ||
                  !formIngredients.trim() ||
                  !formSteps.trim()
                    ? colors.muted
                    : colors.primary,
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text
              style={[
                styles.saveBtnText,
                {
                  color:
                    !formName.trim() ||
                    !formIngredients.trim() ||
                    !formSteps.trim()
                      ? colors.mutedForeground
                      : colors.primaryForeground,
                },
              ]}
            >
              Save Recipe
            </Text>
          </Pressable>
        </View>
      )}

      {/* Recipe Cards */}
      {!loaded ? (
        <ActivityIndicator
          color={colors.primary}
          style={{ marginTop: 24 }}
        />
      ) : recipes.length === 0 && !showForm ? (
        <View style={styles.empty}>
          <Feather name="book-open" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No recipes yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Tap the + button to add your first recipe
          </Text>
        </View>
      ) : (
        recipes.map((recipe) => (
          <View
            key={recipe.id}
            style={[
              styles.recipeCard,
              {
                backgroundColor:
                  picked?.id === recipe.id ? colors.secondary : colors.card,
                borderColor:
                  picked?.id === recipe.id ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={styles.recipeRow}>
              {recipe.photoUrl ? (
                <Image
                  source={{ uri: recipe.photoUrl }}
                  style={styles.thumb}
                />
              ) : (
                <View
                  style={[
                    styles.thumbPlaceholder,
                    { backgroundColor: colors.muted },
                  ]}
                >
                  <Feather
                    name="coffee"
                    size={20}
                    color={colors.mutedForeground}
                  />
                </View>
              )}
              <View style={styles.recipeText}>
                <Text
                  style={[styles.recipeName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {recipe.name}
                </Text>
                <Text
                  style={[
                    styles.recipeIngredientPreview,
                    { color: colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {recipe.ingredients}
                </Text>
              </View>
              <Pressable
                onPress={() => deleteRecipe(recipe.id)}
                hitSlop={12}
              >
                <Feather
                  name="trash-2"
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
          </View>
        ))
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
    marginBottom: 24,
  },
  spinBtn: {
    borderRadius: 50,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    minHeight: 58,
  },
  spinBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: 3,
  },
  pickedCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 28,
    gap: 8,
  },
  pickedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  badge: {
    borderRadius: 50,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  pickedImage: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickedName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
    marginTop: 4,
  },
  bodyText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  listTitle: { fontSize: 19, fontFamily: "Inter_600SemiBold" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  form: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 6,
  },
  formLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 2,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  multiInput: {
    textAlignVertical: "top",
    minHeight: 80,
  },
  saveBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  recipeCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  recipeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  thumb: { width: 52, height: 52, borderRadius: 8 },
  thumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  recipeText: { flex: 1, gap: 3 },
  recipeName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recipeIngredientPreview: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
