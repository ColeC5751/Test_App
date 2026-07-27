// app/(shared)/grocery/[token].tsx
// Shared grocery list view — opened when someone taps a shared grocery link.
// Loads the list by share token from Supabase, respects view/edit permission.
//
// Mirrors app/(tabs)/grocery.tsx as closely as possible: same aisle grouping,
// same manual-add parsing (via combineIngredients + getAisle, imported from
// the owner's screen rather than duplicated), same delete-item support.

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSharedGrocerySync } from "@/lib/sync";
import { combineIngredients, getAisle, groupByAisle } from "@/app/(tabs)/grocery";
import type { GroceryItem } from "@/lib/types";

function formatItem(item: GroceryItem): string {
  const amt = item.amount === 1 && !item.unit
    ? ""
    : `${item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}${item.unit ? " " + item.unit : ""} `;
  return `${amt}${item.name}`;
}

export default function SharedGroceryScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { items, status, permission, notFound, name, save, rename } = useSharedGrocerySync(token);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const canEdit = permission === "edit";
  const loading = status === "syncing" && !notFound;

  const toggleItem = async (id: string) => {
    if (!canEdit) return;
    await Haptics.selectionAsync();
    await save(items.map((it) => it.id === id ? { ...it, checked: !it.checked, checkedAt: Date.now() } : it));
  };

  const startEdit = (item: GroceryItem) => {
    if (!canEdit) return;
    setEditingId(item.id);
    setEditValue(item.amount % 1 === 0 ? String(item.amount) : item.amount.toFixed(1));
  };

  const commitEdit = async (id: string) => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed > 0 && canEdit) {
      await save(items.map((it) => it.id === id ? { ...it, amount: Math.round(parsed * 100) / 100 } : it));
    }
    setEditingId(null);
    setEditValue("");
  };

  const handleManualAdd = async () => {
    if (!canEdit) return;
    const text = manualInput.trim();
    if (!text) return;
    const lines = text.split(/,|\n/).map((l) => l.trim()).filter(Boolean);
    const incoming: GroceryItem[] = lines.map((line, i) => {
      const match = line.match(/^([\d./]+)\s*([a-zA-Z]+(?:\s+[a-zA-Z]+)?)?\s+(.+)$/);
      if (match) {
        const itemName = match[3]?.trim() || line;
        return { id: `g_${Date.now()}_${i}`, name: itemName, amount: parseFloat(match[1]) || 1, unit: match[2]?.trim() || "", checked: false, aisle: getAisle(itemName) };
      }
      return { id: `g_${Date.now()}_${i}`, name: line, amount: 1, unit: "", checked: false, aisle: getAisle(line) };
    });
    const combined = combineIngredients(items, incoming);
    await save(combined);
    setManualInput("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    await save(items.filter((it) => it.id !== id));
  };

  const handleCopy = async () => {
    const unchecked = items.filter((it) => !it.checked);
    if (unchecked.length === 0) { Alert.alert("Nothing to copy", "All items are checked off."); return; }
    const grouped = groupByAisle(unchecked);
    const text = grouped
      .map(({ aisle, icon, items: aisleItems }) =>
        `${icon} ${aisle}\n` + aisleItems.map((it) => `  • ${formatItem(it)}`).join("\n")
      ).join("\n\n");
    await Share.share({ message: `Shopping List:\n\n${text}` });
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading shared list…</Text>
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          This link is invalid or has expired.
        </Text>
        <Pressable onPress={() => router.replace("/")} style={[styles.homeBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.homeBtnText, { color: colors.primaryForeground }]}>Go to app</Text>
        </Pressable>
      </View>
    );
  }

  const unchecked = items.filter((it) => !it.checked);
  const checked = items.filter((it) => it.checked);
  const uncheckedGroups = groupByAisle(unchecked);
  const checkedGroups = groupByAisle(checked);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
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
              placeholder="Name this list"
              placeholderTextColor={colors.mutedForeground}
            />
          ) : (
            <Pressable
              onPress={() => { if (canEdit) { setTitleInput(name ?? ""); setEditingTitle(true); } }}
              disabled={!canEdit}
            >
              <Text style={[styles.heading, { color: colors.foreground }]}>
                {name || "Shared List"}
              </Text>
            </Pressable>
          )}
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {canEdit ? "You can check off and add items" : "View only"} · {unchecked.length} remaining
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleCopy}
            style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="copy" size={16} color={colors.foreground} />
          </Pressable>
          {!canEdit && (
            <View style={[styles.viewBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="eye" size={12} color={colors.mutedForeground} />
              <Text style={[styles.viewBadgeText, { color: colors.mutedForeground }]}>View only</Text>
            </View>
          )}
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={8}
          >
            <Feather name="x" size={16} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      {/* Manual add input — editors only */}
      {canEdit && (
        <View style={[styles.manualAddRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.manualAddInput, { color: colors.foreground }]}
            value={manualInput}
            onChangeText={setManualInput}
            placeholder="Add an item (e.g. 2 lbs ground beef)"
            placeholderTextColor={colors.mutedForeground}
            onSubmitEditing={handleManualAdd}
            returnKeyType="done"
          />
          <Pressable
            onPress={handleManualAdd}
            disabled={!manualInput.trim()}
            style={[styles.manualAddBtn, { backgroundColor: manualInput.trim() ? colors.primary : colors.muted }]}
          >
            <Feather name="plus" size={18} color={manualInput.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {/* Empty state */}
      {unchecked.length === 0 && checked.length === 0 && (
        <View style={styles.empty}>
          <Feather name="shopping-cart" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>This list is empty</Text>
        </View>
      )}

      {/* Unchecked items, grouped by aisle */}
      {uncheckedGroups.map(({ aisle, icon, items: aisleItems }) => (
        <View key={aisle} style={styles.aisleSection}>
          <View style={styles.aisleHeader}>
            <Text style={styles.aisleIcon}>{icon}</Text>
            <Text style={[styles.aisleLabel, { color: colors.mutedForeground }]}>{aisle.toUpperCase()}</Text>
            <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
          </View>
          {aisleItems.map((item) => (
            <SharedRow
              key={item.id}
              item={item}
              colors={colors}
              canEdit={canEdit}
              isEditing={editingId === item.id}
              editValue={editValue}
              onToggle={() => toggleItem(item.id)}
              onEditStart={() => startEdit(item)}
              onEditChange={setEditValue}
              onEditCommit={() => commitEdit(item.id)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </View>
      ))}

      {/* In cart */}
      {checked.length > 0 && (
        <View style={styles.aisleSection}>
          <View style={styles.aisleHeader}>
            <Text style={styles.aisleIcon}>✅</Text>
            <Text style={[styles.aisleLabel, { color: colors.mutedForeground }]}>IN CART</Text>
            <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
          </View>
          {checkedGroups.map(({ items: aisleItems }) =>
            aisleItems.map((item) => (
              <SharedRow
                key={item.id}
                item={item}
                colors={colors}
                canEdit={canEdit}
                isEditing={false}
                editValue=""
                onToggle={() => toggleItem(item.id)}
                onEditStart={() => {}}
                onEditChange={() => {}}
                onEditCommit={() => {}}
                onDelete={() => handleDelete(item.id)}
              />
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function SharedRow({
  item, colors, canEdit, isEditing, editValue,
  onToggle, onEditStart, onEditChange, onEditCommit, onDelete,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  canEdit: boolean;
  isEditing: boolean;
  editValue: string;
  onToggle: () => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }, item.checked && styles.rowChecked]}>
      <Pressable onPress={onToggle} hitSlop={8} disabled={!canEdit}>
        <View style={[styles.checkbox, {
          borderColor: item.checked ? colors.primary : colors.border,
          backgroundColor: item.checked ? colors.primary : "transparent",
          opacity: canEdit ? 1 : 0.5,
        }]}>
          {item.checked && <Feather name="check" size={12} color={colors.primaryForeground} />}
        </View>
      </Pressable>

      {(item.amount > 0 && item.unit !== "") || item.amount !== 1 ? (
        isEditing ? (
          <TextInput
            style={[styles.amountInput, { color: colors.foreground, borderColor: colors.primary, backgroundColor: colors.secondary }]}
            value={editValue}
            onChangeText={onEditChange}
            onBlur={onEditCommit}
            onSubmitEditing={onEditCommit}
            keyboardType="numeric"
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <Pressable onPress={onEditStart} hitSlop={8} disabled={!canEdit}>
            <Text style={[styles.amountBadge, { backgroundColor: colors.secondary, color: colors.mutedForeground }]}>
              {item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}{item.unit ? ` ${item.unit}` : ""}
            </Text>
          </Pressable>
        )
      ) : null}

      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowText, { color: colors.foreground }, item.checked && { textDecorationLine: "line-through", color: colors.mutedForeground }]} numberOfLines={2}>
          {item.name}
        </Text>
        {item.addedFromRecipe && (
          <Text style={[styles.rowSource, { color: colors.mutedForeground }]} numberOfLines={1}>
            from {item.addedFromRecipe}
          </Text>
        )}
      </View>

      {canEdit && (
        <Pressable onPress={onDelete} hitSlop={12}>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  homeBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  homeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  headingInput: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4, borderBottomWidth: 1.5, paddingBottom: 2 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  viewBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  viewBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  manualAddRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 20 },
  manualAddInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 12 },
  manualAddBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 64, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  aisleSection: { marginBottom: 20 },
  aisleHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  aisleIcon: { fontSize: 16 },
  aisleLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2 },
  aisleLine: { flex: 1, height: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  rowChecked: { opacity: 0.45 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  amountBadge: { fontSize: 12, fontFamily: "Inter_600SemiBold", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  amountInput: { fontSize: 13, fontFamily: "Inter_600SemiBold", borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3, width: 64 },
  rowTextWrap: { flex: 1, gap: 2 },
  rowText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  rowSource: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
