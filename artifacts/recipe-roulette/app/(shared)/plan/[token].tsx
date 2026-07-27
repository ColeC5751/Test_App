// app/(shared)/plan/[token].tsx
// Shared meal plan view — opened when someone taps a shared plan link.
// Loads the plan by share token, respects view/edit permission.
//
// Editing here mirrors app/(tabs)/plan.tsx as closely as possible: same
// SlotPickerModal (My Dinners + Spin for me), same PlanSlot shape, same
// AsyncStorage-backed personal recipe list. Recipes are per-device, not
// per-account, so an editor picks from their own saved recipes — same
// as if this were their own plan.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useSharedPlanSync } from "@/lib/sync";
import type { PlanSlot } from "@/lib/types";

// ─── Personal recipe type (matches roulette.tsx / plan.tsx) ───────────────────

interface PersonalRecipe {
  id: string;
  name: string;
  ingredients: string;
  steps: string;
  photoUrl?: string;
  createdAt: number;
  source?: "manual" | "photo" | "url";
}

const STORAGE_KEY = "@recipe_roulette_personal";

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

// ─── Slot Picker Modal (ported from plan.tsx) ─────────────────────────────────

function SlotPickerModal({
  visible,
  dateLabel,
  onClose,
  onPickRecipe,
  onSpinRecipe,
}: {
  visible: boolean;
  dateLabel: string;
  onClose: () => void;
  onPickRecipe: (recipe: PersonalRecipe) => void;
  onSpinRecipe: () => void;
}) {
  const colors = useColors();
  const [recipes, setRecipes] = useState<PersonalRecipe[]>([]);
  const [tab, setTab] = useState<"pick" | "spin">("pick");

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(STORAGE_KEY).then((json) => {
      setRecipes(json ? JSON.parse(json) : []);
    }).catch(() => {});
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[pickerStyles.root, { backgroundColor: colors.background }]}>
        <View style={[pickerStyles.header, { borderBottomColor: colors.border }]}>
          <Text style={[pickerStyles.title, { color: colors.foreground }]}>{dateLabel}</Text>
          <Pressable onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
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
              Spin for me
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SharedPlanScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { plan, status, permission, notFound, name, save, rename } = useSharedPlanSync(token);
  const [weekOffset, setWeekOffset] = useState(0);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const canEdit = permission === "edit";
  const loading = status === "syncing" && !notFound;

  const monday = getMondayOfWeek(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(monday);
  const weekLabel = `Week of ${formatWeekLabel(monday)}`;

  const handleSlotPress = (date: Date) => {
    if (!canEdit) return;
    setPickerDate(date);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSlotLongPress = (date: Date) => {
    if (!canEdit) return;
    const key = isoDateKey(date);
    if (!plan[key]) return;
    Alert.alert("Remove meal?", `Clear ${formatDayLabel(date).day} from the plan?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          await save({ ...plan, [key]: null });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
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
    } as PlanSlot;
    await save({ ...plan, [key]: slot });
    setPickerDate(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSpinRecipe = async () => {
    if (!pickerDate) return;
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      const recipes: PersonalRecipe[] = json ? JSON.parse(json) : [];
      if (recipes.length === 0) {
        Alert.alert("No recipes", "Add recipes to My Dinners first.");
        setPickerDate(null);
        return;
      }
      const recipe = recipes[Math.floor(Math.random() * recipes.length)];
      await handlePickRecipe(recipe);
    } catch {}
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
              {canEdit ? "Tap a day to add or change a meal" : "View only"}
            </Text>
          </View>
          {!canEdit && (
            <View style={[styles.viewBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="eye" size={12} color={colors.mutedForeground} />
              <Text style={[styles.viewBadgeText, { color: colors.mutedForeground }]}>View only</Text>
            </View>
          )}
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            style={[styles.closeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={8}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Week navigation */}
        <View style={styles.weekNav}>
          <Pressable
            onPress={() => { setWeekOffset((o) => o - 1); Haptics.selectionAsync(); }}
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
            onPress={() => { setWeekOffset((o) => o + 1); Haptics.selectionAsync(); }}
            style={[styles.navBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="chevron-right" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {/* Day slots */}
        {weekDays.map((date) => {
          const key = isoDateKey(date);
          const slot = plan[key] as PlanSlot | null | undefined;
          const today = isToday(date);
          const { day, num } = formatDayLabel(date);

          return (
            <Pressable
              key={key}
              onPress={() => handleSlotPress(date)}
              onLongPress={() => handleSlotLongPress(date)}
              delayLongPress={400}
              disabled={!canEdit}
              style={[
                styles.daySlot,
                { backgroundColor: colors.card, borderColor: today ? colors.primary : colors.border, borderWidth: today ? 1.5 : 1 },
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
                  {canEdit && <Feather name="chevron-right" size={14} color={colors.mutedForeground} />}
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
      </ScrollView>

      <SlotPickerModal
        visible={!!pickerDate}
        dateLabel={pickerDateLabel}
        onClose={() => setPickerDate(null)}
        onPickRecipe={handlePickRecipe}
        onSpinRecipe={handleSpinRecipe}
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
  viewBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4 },
  viewBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 4, marginLeft: 8 },
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
});
