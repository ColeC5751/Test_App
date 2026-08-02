// app/(shared)/plan/[token].tsx
// Shared meal plan view — opened when someone taps a shared plan link.
// Loads the plan by share token, respects view/edit permission.
//
// Editing here mirrors app/(tabs)/plan.tsx as closely as possible: same
// SlotPickerModal (My Dinners + Pick for me), same recipe detail view with
// scalable servings/macros/ingredients/steps, same styled ConfirmModal, and
// same PlanSlot shape. An editor picks from THEIR OWN signed-in account's
// recipes — same source of truth as if this were their own plan, and
// consistent across their devices.
//
// Deliberately NOT ported from plan.tsx: the share/permission modal (only
// the plan owner controls who can access the link) and the "calendar view"
// placeholder button (not yet functional there either). Everything else —
// viewing a meal's full detail, scaling servings, adding the week's
// ingredients to your own grocery list — makes sense for a shared member
// too, so it's here, gated by `canEdit` only where it actually mutates the
// shared plan.

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useSharedPlanSync, useRecipeSync, useGrocerySync } from "@/lib/sync";
import { useRecipeMacros, scaleIngredientText } from "@/lib/macros";
import { MacroBar, MacroPills } from "@/components/MacroDisplay";
import type { PersonalRecipe, PlanSlot } from "@/lib/types";

// ─── Date helpers (duplicated from plan.tsx for isolation) ────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(monday: Date): string {
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDayLabel(date: Date): { day: string; num: string } {
  return {
    day: date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    num: String(date.getDate()),
  };
}

function isoDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ─── Confirm Modal (ported from plan.tsx) ─────────────────────────────────────
// Styled replacement for Alert.alert/window.confirm so confirmations match
// the app's card/rounded-corner visual language, and actually work on web
// (Alert.alert is unreliable on React Native Web). Resolves a
// Promise<boolean> via showConfirm() below.

function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  variant,
  icon,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant: "destructive" | "default";
  icon: keyof typeof Feather.glyphMap;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const confirmColor = variant === "destructive" ? colors.destructive : colors.primary;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={confirmStyles.overlay}>
        <View style={[confirmStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[confirmStyles.iconWrap, { backgroundColor: colors.secondary }]}>
            <Feather name={icon} size={20} color={confirmColor} />
          </View>

          <Text style={[confirmStyles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[confirmStyles.message, { color: colors.mutedForeground }]}>{message}</Text>

          <View style={confirmStyles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[confirmStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: confirmColor },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[confirmStyles.btnText, { color: "#fff" }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const confirmStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 340, borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center", gap: 6 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  message: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19, marginBottom: 16 },
  actions: { flexDirection: "row", gap: 10, width: "100%" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

// ─── Picker Recipe Row (ported from plan.tsx) ─────────────────────────────────
// Its own component (not inlined in a .map() callback) specifically so
// useRecipeMacros can be called for it — hooks can't be called inside a
// loop/callback, only at a component's top level.

function PickerRecipeRow({
  recipe,
  colors,
  onPress,
}: {
  recipe: PersonalRecipe;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const { macros } = useRecipeMacros(recipe);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        pickerStyles.recipeRow,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      {recipe.photoUrl ? (
        <Image source={{ uri: recipe.photoUrl }} style={pickerStyles.thumb} />
      ) : (
        <View style={[pickerStyles.thumbPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="coffee" size={18} color={colors.mutedForeground} />
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[pickerStyles.recipeName, { color: colors.foreground }]} numberOfLines={2}>
          {recipe.name}
        </Text>
        {macros && <MacroPills macros={macros} colors={colors} />}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

// ─── Slot Picker Modal (ported from plan.tsx) ─────────────────────────────────

function SlotPickerModal({
  visible,
  dateLabel,
  recipes,
  onClose,
  onPickRecipe,
  onSpinRecipe,
  onDelete,
  isChanging,
}: {
  visible: boolean;
  dateLabel: string;
  recipes: PersonalRecipe[];
  onClose: () => void;
  onPickRecipe: (recipe: PersonalRecipe) => void;
  onSpinRecipe: () => void;
  onDelete?: () => void;
  isChanging?: boolean;
}) {
  const colors = useColors();
  const [tab, setTab] = useState<"pick" | "spin">("pick");

  useEffect(() => {
    if (!visible) return;
    setTab("pick");
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[pickerStyles.root, { backgroundColor: colors.background }]}>
        <View style={[pickerStyles.header, { borderBottomColor: colors.border }]}>
          <View style={pickerStyles.headerLeft}>
            <Text style={[pickerStyles.title, { color: colors.foreground }]}>{dateLabel}</Text>
            {isChanging && onDelete && (
              <Text style={[pickerStyles.changingLabel, { color: colors.mutedForeground }]}>
                Changing existing meal
              </Text>
            )}
          </View>
          <View style={pickerStyles.headerRight}>
            {isChanging && onDelete && (
              <Pressable onPress={onDelete} hitSlop={12} style={pickerStyles.deleteBtn}>
                <Feather name="trash-2" size={18} color={colors.destructive} />
              </Pressable>
            )}
            <Pressable onPress={onClose}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <View style={[pickerStyles.tabs, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Pressable
            onPress={() => setTab("pick")}
            style={[pickerStyles.tabBtn, tab === "pick" && { backgroundColor: colors.primary, borderRadius: 8 }]}
          >
            <Feather name="book-open" size={14} color={tab === "pick" ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[pickerStyles.tabText, { color: tab === "pick" ? colors.primaryForeground : colors.mutedForeground }]}>
              My Dinners
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setTab("spin"); onSpinRecipe(); }}
            style={[pickerStyles.tabBtn, tab === "spin" && { backgroundColor: colors.primary, borderRadius: 8 }]}
          >
            <Feather name="shuffle" size={14} color={tab === "spin" ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[pickerStyles.tabText, { color: tab === "spin" ? colors.primaryForeground : colors.mutedForeground }]}>
              Pick for me
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={pickerStyles.list} showsVerticalScrollIndicator={false}>
          {recipes.length === 0 ? (
            <View style={pickerStyles.empty}>
              <Feather name="book-open" size={32} color={colors.mutedForeground} />
              <Text style={[pickerStyles.emptyText, { color: colors.mutedForeground }]}>
                No recipes in My Dinners yet
              </Text>
            </View>
          ) : (
            recipes.map((recipe) => (
              <PickerRecipeRow
                key={recipe.id}
                recipe={recipe}
                colors={colors}
                onPress={() => { onPickRecipe(recipe); Haptics.selectionAsync(); }}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1 },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  deleteBtn: { padding: 4 },
  changingLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tabs: { flexDirection: "row", margin: 16, borderRadius: 10, borderWidth: 1, padding: 4, gap: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  recipeRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  recipeName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
});

// ─── Plan detail (recipe view) styles (ported from plan.tsx) ─────────────────

const planDetailStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1 },
  swapBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  swapText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  title: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center", marginHorizontal: 8 },
  body: { padding: 20, gap: 16 },
  photo: { width: "100%", height: 200, borderRadius: 14 },
  photoPlaceholder: { width: "100%", height: 200, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  recipeName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  servingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  macrosLoadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  macrosLoadingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  servingsLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5 },
  servingsStatic: { fontSize: 18, fontFamily: "Inter_700Bold" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepperBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepperValue: { fontSize: 18, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "center" },
  ingredientsCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8, width: "100%" },
  ingredientsLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2 },
  ingredientsText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SharedPlanScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { plan, status, permission, notFound, name, save, rename } = useSharedPlanSync(token);
  // Same account-based recipe list as plan.tsx — an editor always picks
  // from their OWN signed-in account's recipes.
  const { recipes, load: loadRecipes } = useRecipeSync();
  // Adding a week's ingredients to a grocery list writes to the current
  // person's OWN grocery list, never the plan owner's — so this is safe to
  // offer regardless of edit permission on the shared plan itself.
  const { addIngredients, load: loadGrocery } = useGrocerySync();

  const [weekOffset, setWeekOffset] = useState(0);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [addingToGrocery, setAddingToGrocery] = useState(false);
  const [viewingSlot, setViewingSlot] = useState<{ slot: PlanSlot; date: Date } | null>(null);
  const [viewingRecipe, setViewingRecipe] = useState<PersonalRecipe | null>(null);
  // useRecipeMacros handles a null viewingRecipe gracefully, so this is
  // safe to call unconditionally on every render (rules of hooks).
  const { macros: viewingMacros, loading: viewingMacrosLoading } = useRecipeMacros(viewingRecipe);
  const [slotServings, setSlotServings] = useState<number | null>(null);

  const canEdit = permission === "edit";
  const loading = status === "syncing" && !notFound;

  // ─── Styled confirm modal control (ported from plan.tsx) ────────────────
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: "destructive" | "default";
    icon: keyof typeof Feather.glyphMap;
  }>({
    visible: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    variant: "default",
    icon: "help-circle",
  });

  const showConfirm = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel: string;
      variant?: "destructive" | "default";
      icon?: keyof typeof Feather.glyphMap;
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        confirmResolveRef.current = resolve;
        setConfirmModal({
          visible: true,
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel,
          variant: opts.variant ?? "default",
          icon: opts.icon ?? "help-circle",
        });
      });
    },
    []
  );

  const resolveConfirm = useCallback((result: boolean) => {
    setConfirmModal((prev) => ({ ...prev, visible: false }));
    confirmResolveRef.current?.(result);
    confirmResolveRef.current = null;
  }, []);

  const slideAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      // Refresh on focus so this screen reflects anything saved/deleted on
      // the My Dinners or Grocery tabs since we were last here — same
      // reasoning as plan.tsx.
      loadGrocery();
      loadRecipes();
    }, [loadGrocery, loadRecipes])
  );

  const monday = getMondayOfWeek(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(monday);
  const weekLabel = `Week of ${formatWeekLabel(monday)}`;

  const filledSlots = weekDays.filter((d) => plan[isoDateKey(d)] != null);

  const navigateWeek = (dir: -1 | 1) => {
    Haptics.selectionAsync();
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: dir * -30, duration: 100, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(slideAnim, { toValue: dir * 30, duration: 0, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
    setWeekOffset((o) => o + dir);
  };

  // Tapping a filled slot always opens the detail view — even for
  // view-only members, since seeing the photo/macros/ingredients/steps
  // isn't an edit. Tapping an empty slot only opens the picker if this
  // person can edit the plan.
  const handleSlotPress = (date: Date) => {
    const key = isoDateKey(date);
    const slot = plan[key] as PlanSlot | null | undefined;
    if (slot) {
      const fullRecipe = recipes.find((r) => r.id === slot.recipeId) ?? null;
      setViewingRecipe(fullRecipe);
      setViewingSlot({ slot, date });
      setSlotServings(slot.servings ?? fullRecipe?.servings ?? 4);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (canEdit) {
      setPickerDate(date);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // Fired by the +/- stepper in the detail view. Editors persist
  // immediately, same as plan.tsx. View-only members can still move the
  // stepper to see ingredients scaled for a different serving count — it
  // just updates local state instead of writing to the shared plan.
  const commitSlotServings = async (newServings: number) => {
    if (!viewingSlot) return;
    const clamped = Math.max(1, Math.min(20, newServings));
    setSlotServings(clamped);
    const updatedSlot: PlanSlot = { ...viewingSlot.slot, servings: clamped };
    setViewingSlot({ slot: updatedSlot, date: viewingSlot.date });
    if (!canEdit) return;
    const key = isoDateKey(viewingSlot.date);
    await save({ ...plan, [key]: updatedSlot });
  };

  const handleRemoveSlot = async (date: Date): Promise<boolean> => {
    if (!canEdit) return false;
    const confirmed = await showConfirm({
      title: "Remove meal?",
      message: `Clear ${formatDayLabel(date).day} from the plan?`,
      confirmLabel: "Remove",
      variant: "destructive",
      icon: "trash-2",
    });
    if (!confirmed) return false;

    const updated = { ...plan, [isoDateKey(date)]: null };
    await save(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return true;
  };

  const handleSwapSlot = (date: Date) => {
    if (!canEdit) return;
    setViewingSlot(null);
    setViewingRecipe(null);
    setSlotServings(null);
    setPickerDate(date);
  };

  const handlePickRecipe = async (recipe: PersonalRecipe) => {
    if (!pickerDate || !canEdit) return;
    const key = isoDateKey(pickerDate);
    const slot: PlanSlot = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipePhoto: recipe.photoUrl,
      source: "personal",
      addedAt: Date.now(),
      servings: recipe.servings ?? 4,
    } as PlanSlot;
    await save({ ...plan, [key]: slot });
    setPickerDate(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSpinRecipe = async () => {
    if (!pickerDate || !canEdit) return;
    if (recipes.length === 0) {
      Alert.alert("No recipes", "Add recipes to My Dinners first.");
      setPickerDate(null);
      return;
    }
    const recipe = recipes[Math.floor(Math.random() * recipes.length)];
    await handlePickRecipe(recipe);
  };

  // ─── Add week to grocery list (ported from plan.tsx) ─────────────────────
  // Available regardless of edit permission — it only touches this
  // person's own grocery list, never the shared plan.
  const handleAddWeekToGrocery = async () => {
    const slots = weekDays
      .map((d) => plan[isoDateKey(d)])
      .filter((s): s is PlanSlot => s != null);

    if (slots.length === 0) {
      Alert.alert("No meals planned", "Add some meals to this week first.");
      return;
    }

    const recipeNames = slots.map((s) => s.recipeName).join(", ");

    const confirmed = await showConfirm({
      title: "Add to grocery list?",
      message: `This will add ingredients from: ${recipeNames}`,
      confirmLabel: "Add",
      variant: "default",
      icon: "shopping-cart",
    });

    if (!confirmed) {
      return;
    }

    setAddingToGrocery(true);

    try {
      await loadGrocery();

      for (const slot of slots) {
        const recipe = recipes.find((r) => r.id === slot.recipeId);
        if (!recipe?.ingredients) continue;

        await addIngredients(recipe.ingredients, {
          fromRecipe: slot.recipeName,
          servingMultiplier: 1,
        });
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Alert.alert(
        "Added to grocery list",
        "The ingredients from this week's meals were added."
      );
    } catch (error) {
      console.error("ADD WEEK TO GROCERY ERROR:", error);

      Alert.alert(
        "Error",
        "Could not add ingredients to the grocery list. Please try again."
      );
    } finally {
      setAddingToGrocery(false);
    }
  };

  const pickerDateLabel = pickerDate
    ? `${formatDayLabel(pickerDate).day}, ${pickerDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
    : "";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading shared plan…</Text>
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          This plan link is invalid or has expired.
        </Text>
        <Pressable onPress={() => router.replace("/")} style={[styles.homeBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.homeBtnText, { color: colors.primaryForeground }]}>Go to app</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            {editingTitle ? (
              <TextInput
                style={[styles.headingInput, { color: colors.foreground, borderColor: colors.primary }]}
                value={titleInput}
                onChangeText={setTitleInput}
                autoFocus
                onBlur={() => { rename(titleInput); setEditingTitle(false); }}
                onSubmitEditing={() => { rename(titleInput); setEditingTitle(false); }}
                placeholder="Name this plan"
                placeholderTextColor={colors.mutedForeground}
              />
            ) : (
              <Pressable
                onPress={() => { if (canEdit) { setTitleInput(name ?? ""); setEditingTitle(true); } }}
                disabled={!canEdit}
              >
                <Text style={[styles.heading, { color: colors.foreground }]}>
                  {name || "Shared Plan"}
                </Text>
              </Pressable>
            )}
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {canEdit ? "Tap a day to add or change a meal" : "Tap a day to view the meal"}
            </Text>
          </View>
          {!canEdit && (
            <View style={[styles.viewBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="eye" size={12} color={colors.mutedForeground} />
              <Text style={[styles.viewBadgeText, { color: colors.mutedForeground }]}>View only</Text>
            </View>
          )}
          <View style={styles.headerActions}>
            {/* Calendar month view is a placeholder in plan.tsx too (not
                built yet) — kept here and, per request, available to
                everyone including view-only members, since it's just a
                different way of looking at the same plan, not an edit. */}
            <Pressable
              onPress={() => Alert.alert("Coming soon", "Calendar month view is coming in a future update.")}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="calendar" size={16} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={() => router.replace("/(tabs)")}
              style={[styles.closeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              hitSlop={8}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        {/* Week navigation */}
        <View style={styles.weekNav}>
          <Pressable
            onPress={() => navigateWeek(-1)}
            style={[styles.navBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="chevron-left" size={18} color={colors.foreground} />
          </Pressable>
          <View style={styles.weekLabelWrap}>
            <Text style={[styles.weekLabel, { color: colors.foreground }]}>{weekLabel}</Text>
            {weekOffset !== 0 && (
              <Pressable onPress={() => setWeekOffset(0)}>
                <Text style={[styles.todayLink, { color: colors.primary }]}>Back to this week</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => navigateWeek(1)}
            style={[styles.navBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="chevron-right" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Day slots */}
        <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
          {weekDays.map((date) => {
            const key = isoDateKey(date);
            const slot = plan[key] as PlanSlot | null | undefined;
            const today = isToday(date);
            const { day, num } = formatDayLabel(date);
            const interactive = !!slot || canEdit;

            return (
              <Pressable
                key={key}
                onPress={() => handleSlotPress(date)}
                disabled={!interactive}
                style={({ pressed }) => [
                  styles.daySlot,
                  { backgroundColor: colors.card, borderColor: today ? colors.primary : colors.border, borderWidth: today ? 1.5 : 1 },
                  pressed && interactive && { opacity: 0.8 },
                ]}
              >
                {today && (
                  <View style={[styles.todayBadge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.todayBadgeText, { color: colors.primaryForeground }]}>TODAY</Text>
                  </View>
                )}
                <View style={styles.dateCol}>
                  <Text style={[styles.dayText, { color: today ? colors.primary : colors.mutedForeground }]}>{day}</Text>
                  <Text style={[styles.dayNum, { color: today ? colors.primary : colors.foreground }]}>{num}</Text>
                </View>
                {slot ? (
                  <View style={[styles.slotFilled, { backgroundColor: colors.background, borderRadius: 10 }]}>
                    {slot.recipePhoto ? (
                      <Image source={{ uri: slot.recipePhoto }} style={styles.slotThumb} />
                    ) : (
                      <View style={[styles.slotThumbPlaceholder, { backgroundColor: colors.muted }]}>
                        <Feather name="coffee" size={16} color={colors.mutedForeground} />
                      </View>
                    )}
                    <Text style={[styles.slotName, { color: colors.foreground }]} numberOfLines={2}>{slot.recipeName}</Text>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </View>
                ) : (
                  <View style={[styles.slotEmpty, { borderColor: colors.border }]}>
                    {canEdit && <Feather name="plus" size={16} color={colors.mutedForeground} />}
                    <Text style={[styles.slotEmptyText, { color: colors.mutedForeground }]}>
                      {canEdit ? "Add dinner" : "Empty"}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </Animated.View>

        {filledSlots.length > 0 && (
          <>
            <Pressable
              onPress={handleAddWeekToGrocery}
              disabled={addingToGrocery}
              style={({ pressed }) => [
                styles.groceryBtn,
                { backgroundColor: colors.primary, opacity: addingToGrocery ? 0.7 : pressed ? 0.9 : 1 },
              ]}
            >
              <Feather name="shopping-cart" size={18} color={colors.primaryForeground} />
              <Text style={[styles.groceryBtnText, { color: colors.primaryForeground }]}>
                {addingToGrocery ? "Adding…" : "Add week to grocery list"}
              </Text>
            </Pressable>
            <Text style={[styles.groceryMeta, { color: colors.mutedForeground }]}>
              {filledSlots.length} recipe{filledSlots.length !== 1 ? "s" : ""} planned this week
            </Text>
          </>
        )}
      </ScrollView>

      {canEdit && (
        <SlotPickerModal
          visible={!!pickerDate}
          dateLabel={pickerDateLabel}
          recipes={recipes}
          onClose={() => setPickerDate(null)}
          onPickRecipe={handlePickRecipe}
          onSpinRecipe={handleSpinRecipe}
          isChanging={!!(pickerDate && plan[isoDateKey(pickerDate)])}
          onDelete={async () => {
            if (!pickerDate) return;
            const removed = await handleRemoveSlot(pickerDate);
            if (removed) {
              setPickerDate(null);
            }
          }}
        />
      )}

      {/* Recipe detail view from plan slot */}
      <Modal
        visible={!!viewingSlot}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setViewingSlot(null); setViewingRecipe(null); setSlotServings(null); }}
      >
        <SafeAreaView style={[planDetailStyles.root, { backgroundColor: colors.background }]}>
          <View style={[planDetailStyles.header, { borderBottomColor: colors.border }]}>
            {canEdit ? (
              <Pressable onPress={() => viewingSlot && handleSwapSlot(viewingSlot.date)} style={planDetailStyles.swapBtn}>
                <Feather name="refresh-cw" size={18} color={colors.foreground} />
                <Text style={[planDetailStyles.swapText, { color: colors.foreground }]}>Change</Text>
              </Pressable>
            ) : (
              <View style={{ width: 60 }} />
            )}
            <Text style={[planDetailStyles.title, { color: colors.foreground }]} numberOfLines={1}>
              {viewingSlot?.slot.recipeName}
            </Text>
            <Pressable onPress={() => { setViewingSlot(null); setViewingRecipe(null); setSlotServings(null); }}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={planDetailStyles.body} showsVerticalScrollIndicator={false}>
            {viewingSlot?.slot.recipePhoto ? (
              <Image source={{ uri: viewingSlot.slot.recipePhoto }} style={planDetailStyles.photo} />
            ) : (
              <View style={[planDetailStyles.photoPlaceholder, { backgroundColor: colors.muted }]}>
                <Feather name="coffee" size={48} color={colors.mutedForeground} />
              </View>
            )}

            <Text style={[planDetailStyles.recipeName, { color: colors.foreground }]}>
              {viewingSlot?.slot.recipeName}
            </Text>

            {viewingRecipe && (() => {
              const recipeBaseServings = viewingRecipe.servings ?? 4;
              const effectiveServings = slotServings ?? recipeBaseServings;
              const scale = effectiveServings / recipeBaseServings;
              return (
                <>
                  <View style={[planDetailStyles.servingsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[planDetailStyles.servingsLabel, { color: colors.mutedForeground }]}>SERVINGS</Text>
                    <View style={planDetailStyles.stepper}>
                      <Pressable
                        onPress={() => { commitSlotServings(effectiveServings - 1); Haptics.selectionAsync(); }}
                        style={[planDetailStyles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                      >
                        <Feather name="minus" size={16} color={colors.foreground} />
                      </Pressable>
                      <Text style={[planDetailStyles.stepperValue, { color: colors.foreground }]}>{effectiveServings}</Text>
                      <Pressable
                        onPress={() => { commitSlotServings(effectiveServings + 1); Haptics.selectionAsync(); }}
                        style={[planDetailStyles.stepperBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                      >
                        <Feather name="plus" size={16} color={colors.foreground} />
                      </Pressable>
                    </View>
                  </View>
                  {!canEdit && (
                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: -8 }}>
                      Adjusting servings here only changes what you see — it won't change the shared plan.
                    </Text>
                  )}

                  {viewingMacrosLoading ? (
                    <View style={planDetailStyles.macrosLoadingRow}>
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                      <Text style={[planDetailStyles.macrosLoadingText, { color: colors.mutedForeground }]}>Calculating nutrition…</Text>
                    </View>
                  ) : viewingMacros ? (
                    <MacroBar macros={viewingMacros} colors={colors} />
                  ) : null}

                  {viewingRecipe.ingredients ? (
                    <View style={[planDetailStyles.ingredientsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[planDetailStyles.ingredientsLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
                      <Text style={[planDetailStyles.ingredientsText, { color: colors.foreground }]} numberOfLines={6}>
                        {scaleIngredientText(viewingRecipe.ingredients, scale)}
                      </Text>
                    </View>
                  ) : null}
                </>
              );
            })()}

            {viewingRecipe?.steps ? (
              <View style={[planDetailStyles.ingredientsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[planDetailStyles.ingredientsLabel, { color: colors.mutedForeground }]}>STEPS</Text>
                <Text style={[planDetailStyles.ingredientsText, { color: colors.foreground }]} numberOfLines={6}>
                  {viewingRecipe.steps}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <ConfirmModal
        visible={confirmModal.visible}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel={confirmModal.confirmLabel}
        variant={confirmModal.variant}
        icon={confirmModal.icon}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  homeBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  homeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  headingInput: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4, borderBottomWidth: 1.5, paddingBottom: 2 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  viewBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, marginRight: 8 },
  headerActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  navBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekLabelWrap: { alignItems: "center", gap: 4 },
  weekLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  todayLink: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  daySlot: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, marginBottom: 10, position: "relative" },
  todayBadge: { position: "absolute", top: -1, right: 14, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  todayBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  dateCol: { alignItems: "center", minWidth: 38 },
  dayText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  dayNum: { fontSize: 20, fontFamily: "Inter_700Bold", lineHeight: 24 },
  slotFilled: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 8 },
  slotThumb: { width: 40, height: 40, borderRadius: 8, flexShrink: 0 },
  slotThumbPlaceholder: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  slotName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  slotEmpty: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  slotEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  groceryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 18, marginTop: 20 },
  groceryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  groceryMeta: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
});
