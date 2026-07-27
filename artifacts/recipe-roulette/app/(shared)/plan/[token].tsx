// app/(shared)/plan/[token].tsx
// Shared meal plan view — opened when someone taps a shared plan link.
// Loads the plan by share token, respects view/edit permission.

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSharedPlanSync } from "@/lib/sync";
import type { PlanSlot } from "@/lib/types";

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

export default function SharedPlanScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  // Uses the dedicated shared-viewer hook — NOT usePlanSync. usePlanSync's
  // internal load() effect runs unconditionally for the *signed-in
  // visitor's own* plan and can insert a new row for them, which raced
  // against loading this shared plan and caused a crash. See the comment
  // above useSharedPlanSync in lib/sync.ts for the full explanation.
  const { plan, status, permission, notFound, save } = useSharedPlanSync(token);
  const [weekOffset, setWeekOffset] = useState(0);

  // Add/edit-meal modal state. This is the piece that was missing before:
  // there was previously no way for an editor to ADD a meal to a slot —
  // only a long-press to clear an existing one. Tapping any slot (empty
  // or filled) now opens this modal.
  const [editingDate, setEditingDate] = useState<Date | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  const canEdit = permission === "edit";
  const loading = status === "syncing" && !notFound;

  const monday = getMondayOfWeek(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(monday);
  const weekLabel = `Week of ${formatWeekLabel(monday)}`;

  const openSlotEditor = (date: Date) => {
    if (!canEdit) return;
    const key = isoDateKey(date);
    const existing = plan[key] as PlanSlot | null | undefined;
    setNameInput(existing?.recipeName ?? "");
    setEditingDate(date);
  };

  const closeSlotEditor = () => {
    setEditingDate(null);
    setNameInput("");
  };

  const commitSlotEditor = async () => {
    if (!editingDate) return;
    const trimmed = nameInput.trim();
    const key = isoDateKey(editingDate);

    setSaving(true);
    try {
      if (trimmed) {
        const newSlot: PlanSlot = {
          recipeName: trimmed,
          recipePhoto: null,
        };
        await save({ ...plan, [key]: newSlot });
      } else {
        // Empty name — treat as clearing the slot
        await save({ ...plan, [key]: null });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSaving(false);
      closeSlotEditor();
    }
  };

  const handleClearSlot = async (date: Date) => {
    if (!canEdit) return;
    const key = isoDateKey(date);
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
          <View>
            <Text style={[styles.heading, { color: colors.foreground }]}>Shared Plan</Text>
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
              onPress={() => openSlotEditor(date)}
              onLongPress={() => canEdit && slot && handleClearSlot(date)}
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
                  {canEdit && <Feather name="edit-2" size={14} color={colors.mutedForeground} />}
                </View>
              ) : (
                <View style={[styles.slotEmpty, { borderColor: colors.border }]}>
                  <Text style={[styles.slotEmptyText, { color: colors.mutedForeground }]}>
                    {canEdit ? "Tap to add a meal" : "Empty"}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Add/edit-meal modal */}
      <Modal
        visible={editingDate !== null}
        animationType="slide"
        transparent
        onRequestClose={closeSlotEditor}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {editingDate ? formatDayLabel(editingDate).day : ""}{" "}
              {editingDate ? formatWeekLabel(editingDate).split(",")[0] : ""}
            </Text>
            <TextInput
              style={[styles.modalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="What's for dinner?"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              onSubmitEditing={commitSlotEditor}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Pressable onPress={closeSlotEditor} style={[styles.modalBtn, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitSlotEditor}
                disabled={saving}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.primaryForeground} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  viewBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4 },
  viewBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
  slotEmpty: { flex: 1, borderWidth: 1, borderStyle: "dashed", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  slotEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, padding: 24, gap: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  modalBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
