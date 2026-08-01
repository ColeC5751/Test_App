import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { useColors } from "@/hooks/useColors";
import {
  usePlanSync,
  useGrocerySync,
  useRecipeSync,
} from "@/lib/sync";

import { buildShareUrl } from "@/lib/supabase";
import type { MealPlan, PersonalRecipe, PlanSlot, SharePermission } from "@/lib/types";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday anchor
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(monday: Date): string {
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
  ingredientsCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8, width: "100%" },
  ingredientsLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2 },
  ingredientsText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
});

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
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
// Styled replacement for Alert.alert/window.confirm confirmation dialogs, so
// they match the app's card/rounded-corner visual language instead of the
// platform's native dialog chrome. Renders correctly on both web and native
// (unlike Alert.alert, which is unreliable on React Native Web), and resolves
// a Promise<boolean> via showConfirm() so callers can `await` the user's
// choice exactly like the old confirmAsync() did.

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
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  message: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19, marginBottom: 16 },
  actions: { flexDirection: "row", gap: 10, width: "100%" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

// ─── Slot Picker Modal ────────────────────────────────────────────────────────

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
              <Pressable
                key={recipe.id}
                onPress={() => { onPickRecipe(recipe); Haptics.selectionAsync(); }}
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
                <Text style={[pickerStyles.recipeName, { color: colors.foreground }]} numberOfLines={2}>
                  {recipe.name}
                </Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
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

// ─── Share Modal ──────────────────────────────────────────────────────────────

function PlanShareModal({
  visible,
  onClose,
  shareToken,
  permission,
  onSetPermission,
}: {
  visible: boolean;
  onClose: () => void;
  shareToken: string | null;
  permission: SharePermission;
  onSetPermission: (p: SharePermission) => void;
}) {
  const colors = useColors();
  const shareUrl = shareToken ? buildShareUrl("plan", shareToken) : null;

  const handleShare = async () => {
    if (!shareUrl) return;
    await Share.share({
      message: `Join my meal plan on That's Dinner:\n${shareUrl}`,
      url: shareUrl,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[shareModalStyles.root, { backgroundColor: colors.background }]}>
        <View style={[shareModalStyles.header, { borderBottomColor: colors.border }]}>
          <Text style={[shareModalStyles.title, { color: colors.foreground }]}>Share Meal Plan</Text>
          <Pressable onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={shareModalStyles.body}>
          <Text style={[shareModalStyles.desc, { color: colors.mutedForeground }]}>
            Family members with the link can view or edit your weekly meal plan.
          </Text>
          <View style={[shareModalStyles.permRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View>
              <Text style={[shareModalStyles.permLabel, { color: colors.foreground }]}>Allow editing</Text>
              <Text style={[shareModalStyles.permSub, { color: colors.mutedForeground }]}>
                {permission === "edit" ? "Anyone with link can add/remove meals" : "Anyone with link can view only"}
              </Text>
            </View>
            <Switch
              value={permission === "edit"}
              onValueChange={(v) => onSetPermission(v ? "edit" : "view")}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.primaryForeground}
            />
          </View>
          {shareUrl && (
            <View style={[shareModalStyles.urlBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[shareModalStyles.urlText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {shareUrl}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [shareModalStyles.shareBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
          >
            <Feather name="share" size={16} color={colors.primaryForeground} />
            <Text style={[shareModalStyles.shareBtnText, { color: colors.primaryForeground }]}>Share Link</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const shareModalStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  body: { padding: 24, gap: 16 },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  permRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 16 },
  permLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  permSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  urlBox: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  urlText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 16 },
  shareBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlanScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { plan, status, shareToken, permission, save, load, setSharePermission } = usePlanSync();
  // Canonical grocery sync — called here at the component level so
  // handleAddWeekToGrocery can invoke addIngredients without breaking the
  // rules of hooks.
  const { addIngredients, load: loadGrocery } = useGrocerySync();
  // Canonical, Supabase-backed personal recipe store — replaces this
  // screen's previous direct AsyncStorage(@recipe_roulette_personal)
  // reads in the slot picker, "pick for me", and add-week-to-grocery
  // flows, so this screen sees the same recipes (and the same
  // survives-sign-out guarantee) as the My Dinners tab.
  const { recipes: personalRecipes, load: loadPersonalRecipes } = useRecipeSync();

  const [weekOffset, setWeekOffset] = useState(0);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [addingToGrocery, setAddingToGrocery] = useState(false);
  const [viewingSlot, setViewingSlot] = useState<{ slot: PlanSlot; date: Date } | null>(null);
  const [viewingRecipe, setViewingRecipe] = useState<PersonalRecipe | null>(null);

  // ─── Styled confirm modal control ──────────────────────────────────────
  // Generic promise-resolving replacement for Alert.alert/window.confirm.
  // showConfirm(...) opens ConfirmModal and resolves true/false once the
  // person taps Confirm, Cancel, or dismisses it — same async contract the
  // old confirmAsync() had, just rendered with the app's own styling.
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
      load();
      // Unlike usePlanSync/useRecipeSync, useGrocerySync() does NOT call
      // load() internally — grocery.tsx is expected to trigger it. This
      // screen also mutates the grocery list (via addIngredients), so it
      // needs its own useGrocerySync() instance to have loaded too;
      // otherwise rowIdRef.current stays null forever and every add here
      // silently falls back to "saved locally only", never reaching
      // Supabase. Loading on focus keeps this instance's rowId current
      // even if the user hasn't visited the Grocery tab yet this session.
      loadGrocery();
      // My Dinners recipes are read directly by this screen (slot picker,
      // spin-for-me, add-week-to-grocery) — refresh on focus so they
      // reflect anything saved/deleted on the My Dinners tab since we
      // were last here.
      loadPersonalRecipes();
    }, [load, loadGrocery, loadPersonalRecipes])
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

  const handleSlotPress = (date: Date) => {
    const key = isoDateKey(date);
    const slot = plan[key] as PlanSlot | null | undefined;
    if (slot) {
      const fullRecipe = personalRecipes.find((r) => r.id === slot.recipeId) ?? null;
      setViewingRecipe(fullRecipe);
      setViewingSlot({ slot, date });
    } else {
      setPickerDate(date);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Fixed: previously this fired Alert.alert with no web fallback, and
  // callers closed the picker modal (setPickerDate(null)) synchronously
  // before this even resolved — which on native could race the modal's own
  // dismissal animation and cause the confirmation to be dropped. Now this
  // awaits the styled confirm modal (which resolves a single Promise<boolean>,
  // web-safe) and the removal is awaited by the caller before anything else
  // happens.
  const handleRemoveSlot = async (date: Date): Promise<boolean> => {
    const confirmed = await showConfirm({
      title: "Remove meal?",
      message: `Clear ${formatDayLabel(date).day} from your plan?`,
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
    setViewingSlot(null);
    setViewingRecipe(null);
    setPickerDate(date);
  };

  const handlePickRecipe = async (recipe: PersonalRecipe) => {
    if (!pickerDate) return;
    const key = isoDateKey(pickerDate);
    const slot: PlanSlot = {
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipePhoto: recipe.photoUrl,
      source: "personal",
      addedAt: Date.now(),
    };
    await save({ ...plan, [key]: slot });
    setPickerDate(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSpinRecipe = async () => {
    if (!pickerDate) return;
    if (personalRecipes.length === 0) {
      Alert.alert("No recipes", "Add recipes to My Dinners first.");
      setPickerDate(null);
      return;
    }
    const recipe = personalRecipes[Math.floor(Math.random() * personalRecipes.length)];
    await handlePickRecipe(recipe);
  };

  // ─── Add week to grocery list ────────────────────────────────────────────
  // The ONLY grocery mutation path from this screen: useGrocerySync().addIngredients.
  const handleAddWeekToGrocery = async () => {
    const slots = weekDays
      .map((d) => plan[isoDateKey(d)])
      .filter((s): s is PlanSlot => s != null);

    if (slots.length === 0) {
      Alert.alert("No meals planned", "Add some meals to this week first.");
      return;
    }

    const recipeNames = slots.map((s) => s.recipeName).join(", ");

    // Previously this branched on Platform.OS to pick between
    // window.confirm (web) and Alert.alert (native) — now routed through
    // the same styled showConfirm() used by handleRemoveSlot, so it
    // matches the app's visual style on every platform instead of falling
    // back to native dialog chrome.
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
      // Race-safety belt-and-suspenders: the useFocusEffect above already
      // loads the grocery row on focus, but if the user taps this button
      // faster than that load() resolves (or the tab never regained focus
      // after some navigator quirk), rowIdRef.current could still be null
      // here. Re-awaiting load() is cheap (guarded by savingRef against
      // clobbering, see lib/sync.ts) and guarantees the row id — and thus
      // Supabase persistence — is in place before addIngredients runs.
      await loadGrocery();

      for (const slot of slots) {
        const recipe = personalRecipes.find((r) => r.id === slot.recipeId);
        if (!recipe?.ingredients) continue;

        // Canonical mutation: parses recipe.ingredients, merges with the
        // current grocery list, and persists locally + to Supabase — the
        // exact same path grocery.tsx's manual-add uses.
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

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.heading, { color: colors.foreground }]}>Meal Plan</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>Plan your week ahead</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setShowShareModal(true)}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="share-2" size={16} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={() => Alert.alert("Coming soon", "Calendar month view is coming in a future update.")}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="calendar" size={16} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

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

        <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
          {weekDays.map((date) => {
            const key = isoDateKey(date);
            const slot = plan[key] as PlanSlot | null | undefined;
            const today = isToday(date);
            const { day, num } = formatDayLabel(date);

            return (
              <Pressable
                key={key}
                onPress={() => handleSlotPress(date)}
                style={({ pressed }) => [
                  styles.daySlot,
                  {
                    backgroundColor: colors.card,
                    borderColor: today ? colors.primary : colors.border,
                    borderWidth: today ? 1.5 : 1,
                  },
                  pressed && { opacity: 0.8 },
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
                    <Text style={[styles.slotName, { color: colors.foreground }]} numberOfLines={2}>
                      {slot.recipeName}
                    </Text>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </View>
                ) : (
                  <View style={[styles.slotEmpty, { borderColor: colors.border }]}>
                    <Feather name="plus" size={16} color={colors.mutedForeground} />
                    <Text style={[styles.slotEmptyText, { color: colors.mutedForeground }]}>Add dinner</Text>
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

      <SlotPickerModal
        visible={!!pickerDate}
        dateLabel={pickerDateLabel}
        recipes={personalRecipes}
        onClose={() => setPickerDate(null)}
        onPickRecipe={handlePickRecipe}
        onSpinRecipe={handleSpinRecipe}
        isChanging={!!(pickerDate && plan[isoDateKey(pickerDate)])}
        onDelete={async () => {
          // Fixed: await the confirmation + removal BEFORE closing the
          // picker. Previously the picker closed synchronously first, which
          // could race the alert's own presentation on native and silently
          // drop it, and never worked on web at all (no window.confirm
          // fallback existed for this path).
          if (!pickerDate) return;
          const removed = await handleRemoveSlot(pickerDate);
          if (removed) {
            setPickerDate(null);
          }
        }}
      />

      {/* Recipe detail view from plan slot */}
      <Modal
        visible={!!viewingSlot}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setViewingSlot(null); setViewingRecipe(null); }}
      >
        <SafeAreaView style={[planDetailStyles.root, { backgroundColor: colors.background }]}>
          <View style={[planDetailStyles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => viewingSlot && handleSwapSlot(viewingSlot.date)} style={planDetailStyles.swapBtn}>
              <Feather name="refresh-cw" size={18} color={colors.foreground} />
              <Text style={[planDetailStyles.swapText, { color: colors.foreground }]}>Change</Text>
            </Pressable>
            <Text style={[planDetailStyles.title, { color: colors.foreground }]} numberOfLines={1}>
              {viewingSlot?.slot.recipeName}
            </Text>
            <Pressable onPress={() => setViewingSlot(null)}>
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

            {viewingRecipe?.ingredients ? (
              <View style={[planDetailStyles.ingredientsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[planDetailStyles.ingredientsLabel, { color: colors.mutedForeground }]}>INGREDIENTS</Text>
                <Text style={[planDetailStyles.ingredientsText, { color: colors.foreground }]} numberOfLines={6}>
                  {viewingRecipe.ingredients}
                </Text>
              </View>
            ) : null}

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

      <PlanShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        shareToken={shareToken}
        permission={permission}
        onSetPermission={setSharePermission}
      />

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  navBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekLabelWrap: { alignItems: "center", gap: 4 },
  weekLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  todayLink: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  daySlot: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, marginBottom: 10, position: "relative" },
  todayBadge: { position: "absolute", top: -1, right: 14, borderRadius: 0, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
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
