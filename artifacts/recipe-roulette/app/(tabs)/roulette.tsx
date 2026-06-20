import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { addIngredientsToGrocery } from "@/app/(tabs)/grocery";
import { SavedToast } from "@/components/SavedToast";

const STORAGE_KEY = "@recipe_roulette_personal";
const API_BASE = "https://test-app-api-server.vercel.app";

// ─── Slot machine constants (single column) ──────────────────────────────────
const ITEM_HEIGHT = 64;
const VISIBLE = 3;
const COPY_COUNT = 10;
const START_COPY = 2;
const SPIN_ROUNDS = 4;
const SPIN_DURATION = 1800;

function initialY(count: number, idx = 0) {
  return ITEM_HEIGHT * (1 - (START_COPY * count + idx));
}
function spinTargetY(count: number, prevIdx: number, newIdx: number) {
  return ITEM_HEIGHT * (1 - (START_COPY * count + prevIdx + SPIN_ROUNDS * count + newIdx));
}
function resetY(count: number, newIdx: number) {
  return ITEM_HEIGHT * (1 - (START_COPY * count + newIdx));
}

interface PersonalRecipe {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
  source?: "manual" | "photo" | "url";
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 9);
}

// ─── Import Modal ─────────────────────────────────────────────────────────

function ImportModal({
  visible,
  onClose,
  onSave,
  editingRecipe,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (recipe: PersonalRecipe) => void;
  editingRecipe?: PersonalRecipe | null;
}) {
  const colors = useColors();
  const isEditMode = !!editingRecipe;
  const [mode, setMode] = useState<"manual" | "photo" | "url">("manual");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStatus, setExtractingStatus] = useState("");
  const [extractError, setExtractError] = useState("");

  // Form fields
  const [formName, setFormName] = useState("");
  const [formIngredients, setFormIngredients] = useState("");
  const [formSteps, setFormSteps] = useState("");
  const [formPhoto, setFormPhoto] = useState("");
  const [urlInput, setUrlInput] = useState("");

  React.useEffect(() => {
    if (visible && editingRecipe) {
      setFormName(editingRecipe.name);
      setFormIngredients(editingRecipe.ingredients);
      setFormSteps(editingRecipe.steps);
      setFormPhoto(editingRecipe.photoUrl ?? "");
      setMode("manual");
    } else if (visible && !editingRecipe) {
      setFormName(""); setFormIngredients(""); setFormSteps(""); setFormPhoto("");
    }
  }, [visible, editingRecipe?.id]);

  const reset = () => {
    setFormName(""); setFormIngredients(""); setFormSteps("");
    setFormPhoto(""); setUrlInput(""); setExtractError("");
    setIsExtracting(false); setMode("manual");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSave = () => {
    if (!formName.trim() || !formIngredients.trim() || !formSteps.trim()) return;
    onSave({
      id: editingRecipe ? editingRecipe.id : generateId(),
      name: formName.trim(),
      ingredients: formIngredients.trim(),
      steps: formSteps.trim(),
      photoUrl: formPhoto.trim() || undefined,
      createdAt: editingRecipe ? editingRecipe.createdAt : Date.now(),
      source: editingRecipe ? editingRecipe.source : mode,
    });
    reset();
    onClose();
  };

  const handlePhotoImport = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]?.base64) return;

    setIsExtracting(true);
    setExtractError("");
    try {
      const res = await fetch(`${API_BASE}/api/recipes/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: result.assets[0].base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      setFormName(data.name ?? "");
      setFormIngredients(Array.isArray(data.ingredients) ? data.ingredients.join(", ") : data.ingredients ?? "");
      setFormSteps(Array.isArray(data.steps) ? data.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n") : data.steps ?? "");
      setFormPhoto(result.assets[0].uri ?? "");
    } catch (err: any) {
      setExtractError(err.message ?? "Could not extract recipe. Try again or enter manually.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) return;
    setIsExtracting(true);
    setExtractError("");
    try {
      const domain = new URL(urlInput.trim()).hostname.replace("www.", "");
      setExtractingStatus(`Fetching recipe from ${domain}…`);
    } catch {
      setExtractingStatus("Fetching recipe…");
    }
    try {
      const res = await fetch(`${API_BASE}/api/recipes/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      setFormName(data.name ?? "");
      setFormIngredients(Array.isArray(data.ingredients) ? data.ingredients.join(", ") : data.ingredients ?? "");
      setFormSteps(Array.isArray(data.steps) ? data.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n") : data.steps ?? "");
      setFormPhoto(data.image ?? "");
    } catch (err: any) {
      setExtractError(err.message ?? "Could not scrape recipe. Check the URL and try again.");
    } finally {
      setIsExtracting(false);
      setExtractingStatus("");
    }
  };

  const inputStyle = [styles.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }];
  const canSave = formName.trim() && formIngredients.trim() && formSteps.trim();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>{isEditMode ? "Edit Recipe" : "Add Recipe"}</Text>
          <Pressable onPress={handleClose}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
        </View>

        {/* Mode selector — hidden when editing an existing recipe */}
        {!isEditMode && (
          <View style={[styles.modeRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            {(["manual", "photo", "url"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => { setMode(m); setExtractError(""); }}
                style={[styles.modeBtn, mode === m && { backgroundColor: colors.primary, borderRadius: 8 }]}
              >
                <Feather
                  name={m === "manual" ? "edit-3" : m === "photo" ? "camera" : "link"}
                  size={14}
                  color={mode === m ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text style={[styles.modeBtnText, { color: mode === m ? colors.primaryForeground : colors.mutedForeground }]}>
                  {m === "manual" ? "Manual" : m === "photo" ? "Photo" : "URL"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">

          {/* Photo mode */}
          {mode === "photo" && (
            <View style={{ marginBottom: 20 }}>
              <Pressable
                onPress={handlePhotoImport}
                disabled={isExtracting}
                style={[styles.importActionBtn, { backgroundColor: colors.primary, opacity: isExtracting ? 0.6 : 1 }]}
              >
                {isExtracting
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <><Feather name="camera" size={16} color={colors.primaryForeground} /><Text style={[styles.importActionBtnText, { color: colors.primaryForeground }]}>Choose Photo</Text></>
                }
              </Pressable>
              {isExtracting && <Text style={[styles.extractingText, { color: colors.mutedForeground }]}>Extracting recipe from photo…</Text>}
            </View>
          )}

          {/* URL mode */}
          {mode === "url" && (
            <View style={{ marginBottom: 20 }}>
              <TextInput
                style={[inputStyle, { marginBottom: 10 }]}
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="https://www.example.com/recipe..."
                placeholderTextColor={colors.mutedForeground}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleUrlImport}
                disabled={isExtracting || !urlInput.trim()}
                style={[styles.importActionBtn, { backgroundColor: colors.primary, opacity: isExtracting || !urlInput.trim() ? 0.6 : 1 }]}
              >
                {isExtracting
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <><Feather name="download" size={16} color={colors.primaryForeground} /><Text style={[styles.importActionBtnText, { color: colors.primaryForeground }]}>Import Recipe</Text></>
                }
              </Pressable>
              {isExtracting && extractingStatus ? <Text style={[styles.extractingText, { color: colors.mutedForeground }]}>{extractingStatus}</Text> : null}
            </View>
          )}

          {/* Error */}
          {extractError ? (
            <View style={[styles.errorBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{extractError}</Text>
            </View>
          ) : null}

          {/* Form fields — shown for manual, or after successful extract */}
          {(mode === "manual" || formName || formIngredients || formSteps) && (
            <>
              {(mode === "photo" || mode === "url") && (formName || formIngredients) && (
                <View style={[styles.extractedBanner, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="check-circle" size={14} color={colors.primary} />
                  <Text style={[styles.extractedText, { color: colors.mutedForeground }]}>Recipe extracted — review and edit below</Text>
                </View>
              )}

              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>RECIPE NAME</Text>
              <TextInput style={inputStyle} value={formName} onChangeText={setFormName} placeholder="e.g. Garlic Butter Salmon" placeholderTextColor={colors.mutedForeground} />

              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
              <TextInput style={[inputStyle, styles.multiInput]} value={formIngredients} onChangeText={setFormIngredients} placeholder="Salmon, garlic, butter, lemon..." placeholderTextColor={colors.mutedForeground} multiline numberOfLines={4} textAlignVertical="top" />

              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>STEPS</Text>
              <TextInput style={[inputStyle, styles.multiInput]} value={formSteps} onChangeText={setFormSteps} placeholder="1. Preheat pan... 2. Season salmon..." placeholderTextColor={colors.mutedForeground} multiline numberOfLines={5} textAlignVertical="top" />

              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>PHOTO URL (optional)</Text>
              <TextInput style={inputStyle} value={formPhoto} onChangeText={setFormPhoto} placeholder="https://..." placeholderTextColor={colors.mutedForeground} keyboardType="url" autoCapitalize="none" />

              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary : colors.muted }]}
              >
                <Text style={[styles.saveBtnText, { color: canSave ? colors.primaryForeground : colors.mutedForeground }]}>{isEditMode ? "Save Changes" : "Save Recipe"}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Recipe Detail Modal ─────────────────────────────────────────────────────

function RecipeDetailModal({ recipe, onClose, onDelete, onEdit }: { recipe: PersonalRecipe | null; onClose: () => void; onDelete: (id: string) => void; onEdit: (recipe: PersonalRecipe) => void }) {
  const colors = useColors();
  const [addedToGrocery, setAddedToGrocery] = useState(false);

  React.useEffect(() => {
    setAddedToGrocery(false);
  }, [recipe?.id]);

  if (!recipe) return null;

  const sourceBadge = recipe.source === "photo" ? "📷 Photo import" : recipe.source === "url" ? "🔗 Link import" : "✍️ Manual";

  const handleAddToGrocery = async () => {
    await addIngredientsToGrocery(recipe.ingredients);
    setAddedToGrocery(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setAddedToGrocery(false), 2000);
  };

  return (
    <Modal visible={!!recipe} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]} numberOfLines={1}>{recipe.name}</Text>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <Pressable onPress={() => onEdit(recipe)}>
              <Feather name="edit-3" size={18} color={colors.foreground} />
            </Pressable>
            <Pressable onPress={() => { onDelete(recipe.id); onClose(); }}>
              <Feather name="trash-2" size={18} color={colors.destructive} />
            </Pressable>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          {recipe.photoUrl ? (
            <Image source={{ uri: recipe.photoUrl }} style={styles.detailImage} />
          ) : null}
          <View style={[styles.sourceBadge, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.sourceBadgeText, { color: colors.mutedForeground }]}>{sourceBadge}</Text>
          </View>

          <Pressable
            onPress={handleAddToGrocery}
            style={({ pressed }) => [
              styles.groceryBtn,
              { backgroundColor: addedToGrocery ? colors.secondary : colors.primary },
              pressed && { opacity: 0.9 },
            ]}
          >
            <Feather
              name={addedToGrocery ? "check" : "shopping-cart"}
              size={16}
              color={addedToGrocery ? colors.foreground : colors.primaryForeground}
            />
            <Text
              style={[
                styles.groceryBtnText,
                { color: addedToGrocery ? colors.foreground : colors.primaryForeground },
              ]}
            >
              {addedToGrocery ? "Added to Grocery List" : "Add to Grocery List"}
            </Text>
          </Pressable>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{recipe.ingredients}</Text>
          </View>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STEPS</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{recipe.steps}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Recipe Slot Column ───────────────────────────────────────────────────────

function RecipeSlotColumn({
  recipes,
  animValue,
}: {
  recipes: PersonalRecipe[];
  animValue: Animated.Value;
}) {
  const colors = useColors();
  const names = recipes.map((r) => r.name);
  const display = Array.from({ length: COPY_COUNT }, () => names).flat();

  return (
    <View
      style={[
        styles.slotViewport,
        { height: ITEM_HEIGHT * VISIBLE, backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.slotSelectionBox, { borderColor: colors.primary, pointerEvents: "none" }]} />
      <Animated.View style={{ transform: [{ translateY: animValue }] }}>
        {display.map((name, i) => (
          <View key={i} style={[styles.slotItem, { height: ITEM_HEIGHT }]}>
            <Text style={[styles.slotItemText, { color: colors.foreground }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RouletteScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [recipes, setRecipes] = useState<PersonalRecipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const [selectedRecipe, setSelectedRecipe] = useState<PersonalRecipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<PersonalRecipe | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);

  const slotY = useRef(new Animated.Value(0)).current;
  const prevRecipeCount = useRef(0);

  useFocusEffect(
    React.useCallback(() => {
      const loadRecipes = async () => {
        try {
          const json = await AsyncStorage.getItem(STORAGE_KEY);
          const list: PersonalRecipe[] = json ? JSON.parse(json) : [];
          setRecipes(list);
          // Reset slot position if the recipe count changed (e.g. add/delete)
          // so the column doesn't show stale offsets for a different-length list.
          if (list.length !== prevRecipeCount.current) {
            setSelIdx(0);
            slotY.setValue(initialY(Math.max(list.length, 1)));
            prevRecipeCount.current = list.length;
          }
        } catch {}
        setLoaded(true);
      };
      loadRecipes();
    }, [])
  );

  const persist = async (updated: PersonalRecipe[]) => {
    setRecipes(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    if (updated.length !== prevRecipeCount.current) {
      setSelIdx(0);
      slotY.setValue(initialY(Math.max(updated.length, 1)));
      prevRecipeCount.current = updated.length;
    }
  };

  const handleSave = async (recipe: PersonalRecipe) => {
    const existingIdx = recipes.findIndex((r) => r.id === recipe.id);
    const isUpdate = existingIdx !== -1;
    const updatedList = isUpdate
      ? recipes.map((r) => (r.id === recipe.id ? recipe : r))
      : [...recipes, recipe];
    await persist(updatedList);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (!isUpdate) {
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 1000);
    }
    if (selectedRecipe?.id === recipe.id) setSelectedRecipe(recipe);
    setEditingRecipe(null);
  };

  const deleteRecipe = async (id: string) => {
    await persist(recipes.filter((r) => r.id !== id));
  };

  const spinRecipe = () => {
    if (recipes.length === 0 || spinning) return;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const count = recipes.length;
    const newIdx = Math.floor(Math.random() * count);
    const easing = Easing.out(Easing.cubic);

    Animated.timing(slotY, {
      toValue: spinTargetY(count, selIdx, newIdx),
      duration: SPIN_DURATION,
      easing,
      useNativeDriver: false,
    }).start(() => {
      slotY.setValue(resetY(count, newIdx));
      setSelIdx(newIdx);
      setSpinning(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Open the detail modal directly when it lands
      setSelectedRecipe(recipes[newIdx]);
    });
  };

  const sourceIcon = (source?: string) =>
    source === "photo" ? "camera" : source === "url" ? "link" : "edit-3";

  return (
    <>
      <SavedToast visible={showSavedToast} label="Recipe Saved!" />
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.heading, { color: colors.foreground }]}>My Dinners</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>Spin for a random recipe from your collection</Text>
          </View>
          <Pressable onPress={() => setShowImport(true)} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>

        {/* Slot Machine Spinner */}
        {recipes.length > 0 ? (
          <>
            <RecipeSlotColumn recipes={recipes} animValue={slotY} />
            <Pressable
              onPress={spinRecipe}
              disabled={spinning}
              style={({ pressed }) => [
                styles.spinBtn,
                { backgroundColor: spinning ? colors.secondary : colors.primary },
                pressed && !spinning && { transform: [{ scale: 0.96 }], opacity: 0.9 },
              ]}
            >
              {spinning
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={[styles.spinBtnText, { color: colors.primaryForeground }]}>SPIN MY DINNERS</Text>
              }
            </Pressable>
          </>
        ) : (
          <Pressable
            disabled
            style={[styles.spinBtn, { backgroundColor: colors.muted }]}
          >
            <Text style={[styles.spinBtnText, { color: colors.mutedForeground }]}>ADD RECIPES TO SPIN</Text>
          </Pressable>
        )}

        {/* Recipe List */}
        <View style={[styles.listHeader, { marginTop: 28 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[styles.listTitle, { color: colors.foreground }]}>My Recipes</Text>
            {recipes.length > 0 && <Text style={[styles.listCount, { color: colors.mutedForeground }]}>{recipes.length}</Text>}
          </View>
        </View>

        {!loaded ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : recipes.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="book-open" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recipes yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Tap the + button to add your first recipe</Text>
          </View>
        ) : (
          recipes.map((recipe, idx) => (
            <Pressable
              key={recipe.id}
              onPress={() => setSelectedRecipe(recipe)}
              style={({ pressed }) => [
                styles.recipeCard,
                { backgroundColor: !spinning && idx === selIdx ? colors.secondary : colors.card, borderColor: !spinning && idx === selIdx ? colors.primary : colors.border },
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={styles.recipeRow}>
                {recipe.photoUrl ? (
                  <Image source={{ uri: recipe.photoUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumbPlaceholder, { backgroundColor: colors.muted }]}>
                    <Feather name="coffee" size={20} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={styles.recipeText}>
                  <Text style={[styles.recipeName, { color: colors.foreground }]} numberOfLines={1}>{recipe.name}</Text>
                  <Text style={[styles.recipeIngredientPreview, { color: colors.mutedForeground }]} numberOfLines={1}>{recipe.ingredients}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Feather name={sourceIcon(recipe.source)} size={14} color={colors.mutedForeground} />
                  <Pressable onPress={() => deleteRecipe(recipe.id)} hitSlop={12}>
                    <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <ImportModal
        visible={showImport || !!editingRecipe}
        onClose={() => { setShowImport(false); setEditingRecipe(null); }}
        onSave={handleSave}
        editingRecipe={editingRecipe}
      />
      <RecipeDetailModal
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onDelete={deleteRecipe}
        onEdit={(recipe) => { setEditingRecipe(recipe); setSelectedRecipe(null); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root:               { flex: 1 },
  headerRow:          { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  heading:            { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub:                { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn:             { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginTop: 4 },
  spinBtn:            { borderRadius: 50, paddingVertical: 18, alignItems: "center", justifyContent: "center", marginBottom: 28, minHeight: 58 },
  spinBtnText:        { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 3 },
  slotViewport:       { width: "100%", overflow: "hidden", borderRadius: 14, borderWidth: 1, position: "relative", marginBottom: 16 },
  slotSelectionBox:   { position: "absolute", top: ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT, borderTopWidth: 1.5, borderBottomWidth: 1.5, zIndex: 10 },
  slotItem:           { justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  slotItemText:       { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  tapHint:            { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  listHeader:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  listTitle:          { fontSize: 19, fontFamily: "Inter_600SemiBold" },
  listCount:          { fontSize: 19, fontFamily: "Inter_600SemiBold" },
  empty:              { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTitle:         { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText:          { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  recipeCard:         { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  recipeRow:          { flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  thumb:              { width: 52, height: 52, borderRadius: 8 },
  thumbPlaceholder:   { width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  recipeText:         { flex: 1, gap: 3 },
  recipeName:         { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recipeIngredientPreview: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modalRoot:          { flex: 1 },
  modalHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1 },
  modalTitle:         { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1, marginRight: 12 },
  modeRow:            { flexDirection: "row", margin: 16, borderRadius: 10, borderWidth: 1, padding: 4, gap: 4 },
  modeBtn:            { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  modeBtnText:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  importActionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14 },
  importActionBtnText:{ fontSize: 15, fontFamily: "Inter_600SemiBold" },
  extractingText:     { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
  errorBox:           { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 16 },
  errorText:          { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  extractedBanner:    { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 16 },
  extractedText:      { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  formLabel:          { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginTop: 14, marginBottom: 4 },
  input:              { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  multiInput:         { textAlignVertical: "top", minHeight: 90 },
  saveBtn:            { borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  saveBtnText:        { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  detailImage:        { width: "100%", height: 200, borderRadius: 12, marginBottom: 16 },
  sourceBadge:        { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 },
  sourceBadgeText:    { fontSize: 11, fontFamily: "Inter_400Regular" },
  groceryBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  groceryBtnText:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel:       { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 8, marginTop: 4 },
  sectionCard:        { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  bodyText:           { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
});
