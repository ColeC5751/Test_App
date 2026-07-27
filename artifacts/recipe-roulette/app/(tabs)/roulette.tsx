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
import { CookMode } from "@/components/CookMode";

const STORAGE_KEY = "@recipe_roulette_personal";
const API_BASE = "https://test-app-api-server.vercel.app";

// Module-level session state — survives tab switches without Supabase.
// When Phase 1 lands, useRecipeSync will replace direct AsyncStorage calls
// and sessionTonightsPick can move into a shared session context.
let sessionTonightsPick: PersonalRecipe | null = null;

// ─── Roulette wheel constants ────────────────────────────────────────────────
// The actual recipe card list IS the spinner. The full list is rendered
// inside an Animated.View inside a fixed-height viewport. Spinning
// translates the list upward, decelerating to land on the winning card.
// Cards remain tappable throughout — same card, same interaction.
const CARD_HEIGHT = 84;        // card height + margin, used for offset math
const WHEEL_VISIBLE = 4;       // number of cards visible in the viewport
const SPIN_COPIES = 3;         // how many times the list repeats inside the wheel
const SPIN_START_COPY = 1;     // which copy we start centered on
const SPIN_ROUNDS = 4;         // full loops before landing
const SPIN_DURATION = 2400;    // ms

function wheelInitialY(count: number, idx = 0) {
  return CARD_HEIGHT * (1 - (SPIN_START_COPY * count + idx));
}
function wheelSpinTargetY(count: number, prevIdx: number, newIdx: number) {
  return CARD_HEIGHT * (1 - (SPIN_START_COPY * count + prevIdx + SPIN_ROUNDS * count + newIdx));
}
function wheelResetY(count: number, newIdx: number) {
  return CARD_HEIGHT * (1 - (SPIN_START_COPY * count + newIdx));
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
      if (result.assets[0]?.base64) {
        setFormPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      } else if (result.assets[0]?.uri) {
        setFormPhoto(result.assets[0].uri);
      }
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

              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>PHOTO (optional)</Text>

              {/* Photo preview */}
              {formPhoto ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: formPhoto }} style={styles.photoPreview} />
                  <Pressable
                    onPress={() => setFormPhoto("")}
                    style={[styles.photoRemoveBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                    hitSlop={8}
                  >
                    <Feather name="x" size={14} color={colors.foreground} />
                  </Pressable>
                </View>
              ) : null}

              {/* Camera + Library buttons */}
              <View style={styles.photoPickerRow}>
                <Pressable
                  onPress={async () => {
                    const perm = await ImagePicker.requestCameraPermissionsAsync();
                    if (!perm.granted) { Alert.alert("Permission needed", "Please allow camera access."); return; }
                    const result = await ImagePicker.launchCameraAsync({ quality: 0.75, allowsEditing: true, aspect: [4, 3], base64: true });
                    if (!result.canceled) {
                      const asset = result.assets[0];
                      if (asset?.base64) {
                        setFormPhoto(`data:image/jpeg;base64,${asset.base64}`);
                      } else if (asset?.uri) {
                        setFormPhoto(asset.uri);
                      } else {
                        Alert.alert("Photo error", "Could not load the photo. Please try again.");
                      }
                    }
                  }}
                  style={[styles.photoPickerBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <Feather name="camera" size={16} color={colors.foreground} />
                  <Text style={[styles.photoPickerBtnText, { color: colors.foreground }]}>Camera</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) { Alert.alert("Permission needed", "Please allow photo library access."); return; }
                    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.75, allowsEditing: true, aspect: [4, 3], base64: true });
                    if (!result.canceled) {
                      const asset = result.assets[0];
                      if (asset?.base64) {
                        setFormPhoto(`data:image/jpeg;base64,${asset.base64}`);
                      } else if (asset?.uri) {
                        setFormPhoto(asset.uri);
                      } else {
                        Alert.alert("Photo error", "Could not load the photo. Please try again.");
                      }
                    }
                  }}
                  style={[styles.photoPickerBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <Feather name="image" size={16} color={colors.foreground} />
                  <Text style={[styles.photoPickerBtnText, { color: colors.foreground }]}>Library</Text>
                </Pressable>
              </View>

              {/* URL fallback — collapsed to a small link when no photo selected, full input otherwise */}
              {!formPhoto && (
                <TextInput
                  style={[inputStyle, { marginTop: 8 }]}
                  value={formPhoto}
                  onChangeText={setFormPhoto}
                  placeholder="Or paste a photo URL…"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="url"
                  autoCapitalize="none"
                />
              )}

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

// Parses a freeform steps string into an array of individual steps.
// Handles numbered steps ("1. Preheat...", "Step 1:"), newline-separated,
// and comma-separated as a last resort.
function parseSteps(text: string): string[] {
  if (!text.trim()) return [];
  // Split on numbered step patterns: "1.", "Step 1:", "1)" etc.
  const numbered = text.split(/(?:^|\n)\s*(?:step\s*)?\d+[.):]\s*/i).map(s => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  // Fall back to newline splitting
  const byLine = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (byLine.length > 1) return byLine;
  // Single block — return as one step
  return [text.trim()];
}

// Scales numeric values in a freeform ingredient string by a multiplier.
// e.g. "2 tbsp butter, 1 cup milk" × 2 → "4 tbsp butter, 2 cup milk"
// Handles integers, decimals, and simple fractions (1/2, 3/4 etc.)
function scaleIngredientText(text: string, multiplier: number): string {
  if (multiplier === 1) return text;
  return text.replace(
    /(\d+\/\d+|\d+\.?\d*)/g,
    (match) => {
      let val: number;
      if (match.includes("/")) {
        const [num, den] = match.split("/").map(Number);
        val = num / den;
      } else {
        val = parseFloat(match);
      }
      const scaled = val * multiplier;
      const rounded = Math.round(scaled * 100) / 100;
      return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
    }
  );
}

function RecipeDetailModal({ recipe, onClose, onDelete, onEdit }: { recipe: PersonalRecipe | null; onClose: () => void; onDelete: (id: string) => void; onEdit: (recipe: PersonalRecipe) => void }) {
  const colors = useColors();
  const [addedToGrocery, setAddedToGrocery] = useState(false);
  const [servings, setServings] = useState(1);
  const [showCookMode, setShowCookMode] = useState(false);
  const [showStepsPreview, setShowStepsPreview] = useState(false);
  const baseServings = 1;

  React.useEffect(() => {
    setAddedToGrocery(false);
    setServings(1);
    setShowCookMode(false);
    setShowStepsPreview(false);
  }, [recipe?.id]);

  if (!recipe) return null;

  const sourceBadge = recipe.source === "photo" ? "📷 Photo import" : recipe.source === "url" ? "🔗 Link import" : "✍️ Manual";
  const multiplier = servings / baseServings;
  const scaledIngredients = scaleIngredientText(recipe.ingredients, multiplier);

  const handleAddToGrocery = async () => {
    await addIngredientsToGrocery(scaledIngredients);
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

          {/* Servings stepper */}
          <View style={[styles.servingsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.servingsLabel, { color: colors.mutedForeground }]}>SERVINGS</Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => { setServings((s) => Math.max(1, s - 1)); Haptics.selectionAsync(); }}
                style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              >
                <Feather name="minus" size={16} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.stepperValue, { color: colors.foreground }]}>{servings}×</Text>
              <Pressable
                onPress={() => { setServings((s) => Math.min(20, s + 1)); Haptics.selectionAsync(); }}
                style={[styles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              >
                <Feather name="plus" size={16} color={colors.foreground} />
              </Pressable>
            </View>
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
            <Text style={[styles.groceryBtnText, { color: addedToGrocery ? colors.foreground : colors.primaryForeground }]}>
              {addedToGrocery ? "Added to Grocery List" : "Add to Grocery List"}
            </Text>
          </Pressable>

          {recipe.steps.trim().length > 0 && (
            <Pressable
              onPress={() => setShowCookMode(true)}
              style={({ pressed }) => [
                styles.groceryBtn,
                { backgroundColor: colors.secondary, borderWidth: 1.5, borderColor: colors.primary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Feather name="play-circle" size={16} color={colors.primary} />
              <Text style={[styles.groceryBtnText, { color: colors.primary }]}>Start Cooking</Text>
            </Pressable>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
          <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{scaledIngredients}</Text>
          </View>
          <View style={styles.stepsHeader}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STEPS</Text>
            <Pressable onPress={() => setShowStepsPreview((p) => !p)}>
              <Text style={[styles.stepsPreviewToggle, { color: colors.primary }]}>
                {showStepsPreview ? "hide preview" : "preview cook mode"}
              </Text>
            </Pressable>
          </View>
          {showStepsPreview ? (
            <View style={[styles.stepsPreviewCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[styles.stepsPreviewLabel, { color: colors.mutedForeground }]}>
                {parseSteps(recipe.steps).length} step{parseSteps(recipe.steps).length !== 1 ? "s" : ""} detected
              </Text>
              {parseSteps(recipe.steps).map((step, i) => (
                <View key={i} style={styles.stepsPreviewRow}>
                  <View style={[styles.stepsPreviewNum, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.stepsPreviewNumText, { color: colors.primaryForeground }]}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepsPreviewStep, { color: colors.foreground }]}>{step}</Text>
                </View>
              ))}
              {parseSteps(recipe.steps).length <= 1 && (
                <Text style={[styles.stepsPreviewHint, { color: colors.mutedForeground }]}>
                  Tip: number your steps (1. 2. 3.) for a better cook mode experience
                </Text>
              )}
            </View>
          ) : (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.bodyText, { color: colors.foreground }]}>{recipe.steps}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
      <CookMode
        visible={showCookMode}
        recipeName={recipe?.name ?? ""}
        steps={parseSteps(recipe?.steps ?? "")}
        onClose={() => setShowCookMode(false)}
      />
    </Modal>
  );
}

// ─── Recipe Wheel Viewport ────────────────────────────────────────────────────
// The full recipe card list, repeated SPIN_COPIES times, rendered inside
// a fixed-height clipping viewport. The Animated.Value translates the
// entire list upward as it spins. Cards are full-width with photo + name,
// identical to the list below — and remain tappable during/after spinning.

function RecipeWheelViewport({
  recipes,
  animValue,
  onCardPress,
  landedIdx,
}: {
  recipes: PersonalRecipe[];
  animValue: Animated.Value;
  onCardPress: (recipe: PersonalRecipe) => void;
  landedIdx: number;
}) {
  const colors = useColors();
  // Repeat the list so multi-round spins never run out of cards
  const display = Array.from({ length: SPIN_COPIES }, () => recipes).flat();

  return (
    <View
      style={[
        styles.wheelViewport,
        { height: CARD_HEIGHT * WHEEL_VISIBLE, borderColor: colors.border },
      ]}
    >
      {/* Top + bottom fade overlays to give depth */}
      <View style={[styles.wheelFadeTop, { backgroundColor: colors.background }]} pointerEvents="none" />
      <View style={[styles.wheelFadeBottom, { backgroundColor: colors.background }]} pointerEvents="none" />
      {/* Selection highlight on the center card */}
      <View
        style={[
          styles.wheelSelection,
          {
            top: CARD_HEIGHT * Math.floor(WHEEL_VISIBLE / 2),
            height: CARD_HEIGHT,
            borderColor: colors.primary,
          },
        ]}
        pointerEvents="none"
      />
      <Animated.View style={{ transform: [{ translateY: animValue }] }}>
        {display.map((recipe, i) => {
          const sourceIdx = i % recipes.length;
          const isLanded = sourceIdx === landedIdx;
          return (
            <Pressable
              key={i}
              onPress={() => onCardPress(recipe)}
              style={({ pressed }) => [
                styles.wheelCard,
                { height: CARD_HEIGHT, backgroundColor: colors.card, borderColor: isLanded ? colors.primary : colors.border },
                pressed && { opacity: 0.85 },
              ]}
            >
              {recipe.photoUrl ? (
                <Image source={{ uri: recipe.photoUrl }} style={styles.wheelCardThumb} />
              ) : (
                <View style={[styles.wheelCardThumbPlaceholder, { backgroundColor: colors.muted }]}>
                  <Feather name="coffee" size={18} color={colors.mutedForeground} />
                </View>
              )}
              <View style={styles.wheelCardText}>
                <Text style={[styles.wheelCardName, { color: colors.foreground }]} numberOfLines={2}>
                  {recipe.name}
                </Text>
                <Text style={[styles.wheelCardSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {recipe.ingredients}
                </Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </Pressable>
          );
        })}
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
  const [tonightsPick, setTonightsPick] = useState<PersonalRecipe | null>(sessionTonightsPick);
  const [selectedRecipe, setSelectedRecipe] = useState<PersonalRecipe | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<PersonalRecipe | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);

  const slotY = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    React.useCallback(() => {
      const loadRecipes = async () => {
        try {
          const json = await AsyncStorage.getItem(STORAGE_KEY);
          const list: PersonalRecipe[] = json ? JSON.parse(json) : [];
          setRecipes(list);
          if (list.length > 0) {
            slotY.setValue(wheelInitialY(list.length, 0));
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
    if (tonightsPick?.id === recipe.id) {
      setTonightsPick(recipe);
      sessionTonightsPick = recipe;
    }
    setEditingRecipe(null);
  };

  const deleteRecipe = async (id: string) => {
    await persist(recipes.filter((r) => r.id !== id));
    if (tonightsPick?.id === id) { setTonightsPick(null); sessionTonightsPick = null; }
    setSelIdx(0);
    slotY.setValue(wheelInitialY(Math.max(recipes.length - 1, 1)));
  };

  const spinRecipe = () => {
    if (recipes.length === 0 || spinning) return;
    setSpinning(true);
    setTonightsPick(null);
    sessionTonightsPick = null;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const count = recipes.length;
    const newIdx = Math.floor(Math.random() * count);

    Animated.timing(slotY, {
      toValue: wheelSpinTargetY(count, selIdx, newIdx),
      duration: SPIN_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      slotY.setValue(wheelResetY(count, newIdx));
      setSelIdx(newIdx);
      setSpinning(false);
      setTonightsPick(recipes[newIdx]);
      sessionTonightsPick = recipes[newIdx];
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

        {/* Tonight's Dinner — stays pinned for the rest of the session once a spin lands */}
        {tonightsPick && !spinning && (
          <Pressable
            onPress={() => setSelectedRecipe(tonightsPick)}
            style={[styles.tonightsBanner, { backgroundColor: colors.card, borderColor: colors.primary }]}
          >
            <View style={[styles.tonightsBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.tonightsBadgeText, { color: colors.primaryForeground }]}>TONIGHT'S DINNER</Text>
            </View>
            <View style={styles.tonightsRow}>
              {tonightsPick.photoUrl ? (
                <Image source={{ uri: tonightsPick.photoUrl }} style={styles.tonightsThumb} />
              ) : (
                <View style={[styles.thumbPlaceholder, { backgroundColor: colors.muted }]}>
                  <Feather name="coffee" size={20} color={colors.mutedForeground} />
                </View>
              )}
              <Text style={[styles.tonightsName, { color: colors.foreground }]} numberOfLines={2}>{tonightsPick.name}</Text>
              <Feather name="chevron-right" size={18} color={colors.primary} />
            </View>
          </Pressable>
        )}

        {/* Recipe wheel — the actual full card list IS the spinner */}
        {recipes.length >= 2 ? (
          <RecipeWheelViewport
            recipes={recipes}
            animValue={slotY}
            onCardPress={(r) => setSelectedRecipe(r)}
            landedIdx={selIdx}
          />
        ) : recipes.length === 1 ? (
          <View style={[styles.singleRecipeHint, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="info" size={16} color={colors.mutedForeground} />
            <Text style={[styles.singleRecipeHintText, { color: colors.mutedForeground }]}>
              Add at least 2 recipes to spin
            </Text>
          </View>
        ) : null}

        {/* Spin Button */}
        <Pressable
          onPress={spinRecipe}
          disabled={recipes.length < 2 || spinning}
          style={({ pressed }) => [
            styles.spinBtn,
            { backgroundColor: recipes.length < 2 ? colors.muted : spinning ? colors.secondary : colors.primary },
            pressed && recipes.length >= 2 && !spinning && { transform: [{ scale: 0.96 }], opacity: 0.9 },
          ]}
        >
          {spinning
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.spinBtnText, { color: recipes.length < 2 ? colors.mutedForeground : colors.primaryForeground }]}>
                {recipes.length === 0 ? "ADD RECIPES TO SPIN" : "SPIN MY DINNERS"}
              </Text>
          }
        </Pressable>

        <View style={styles.listHeader}>
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
          recipes.map((recipe, idx) => {
            const isPick = !spinning && tonightsPick?.id === recipe.id;
            return (
              <Pressable
                key={recipe.id}
                onPress={() => setSelectedRecipe(recipe)}
                style={({ pressed }) => [
                  styles.recipeCard,
                  { backgroundColor: isPick ? colors.secondary : colors.card, borderColor: isPick ? colors.primary : colors.border },
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
            );
          })
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
  wheelViewport:            { width: "100%", overflow: "hidden", borderRadius: 16, borderWidth: 1, position: "relative", marginBottom: 14 },
  wheelFadeTop:             { position: "absolute", top: 0, left: 0, right: 0, height: CARD_HEIGHT, opacity: 0.55, zIndex: 5 },
  wheelFadeBottom:          { position: "absolute", bottom: 0, left: 0, right: 0, height: CARD_HEIGHT, opacity: 0.55, zIndex: 5 },
  wheelSelection:           { position: "absolute", left: 0, right: 0, borderTopWidth: 1.5, borderBottomWidth: 1.5, zIndex: 10 },
  wheelCard:                { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 12, borderBottomWidth: 1 },
  wheelCardThumb:           { width: 56, height: 56, borderRadius: 10, flexShrink: 0 },
  wheelCardThumbPlaceholder:{ width: 56, height: 56, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  wheelCardText:            { flex: 1, gap: 3 },
  wheelCardName:            { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  wheelCardSub:             { fontSize: 11, fontFamily: "Inter_400Regular" },
  tonightsBanner:     { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 16, gap: 10 },
  tonightsBadge:      { alignSelf: "flex-start", borderRadius: 50, paddingHorizontal: 10, paddingVertical: 4 },
  tonightsBadgeText:  { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  tonightsRow:        { flexDirection: "row", alignItems: "center", gap: 12 },
  tonightsThumb:      { width: 48, height: 48, borderRadius: 8 },
  tonightsName:       { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", lineHeight: 22 },
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
  photoPreviewWrap:   { position: "relative", marginBottom: 10 },
  photoPreview:       { width: "100%", height: 180, borderRadius: 10 },
  photoRemoveBtn:     { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  photoPickerRow:     { flexDirection: "row", gap: 10, marginBottom: 4 },
  photoPickerBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingVertical: 12 },
  photoPickerBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
  servingsRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12 },
  servingsLabel:      { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5 },
  stepper:            { flexDirection: "row", alignItems: "center", gap: 16 },
  stepperBtn:         { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepperValue:       { fontSize: 18, fontFamily: "Inter_700Bold", minWidth: 32, textAlign: "center" },
  groceryBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  groceryBtnText:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel:       { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 8, marginTop: 4 },
  sectionCard:        { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  bodyText:           { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  singleRecipeHint:   { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  singleRecipeHintText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  stepsHeader:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 4 },
  stepsPreviewToggle: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  stepsPreviewCard:   { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16, gap: 12 },
  stepsPreviewLabel:  { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 4 },
  stepsPreviewRow:    { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepsPreviewNum:    { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  stepsPreviewNumText:{ fontSize: 11, fontFamily: "Inter_700Bold" },
  stepsPreviewStep:   { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  stepsPreviewHint:   { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 4 },
});
