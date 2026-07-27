// app/(shared)/grocery/[token].tsx
// Shared grocery list view — opened when someone taps a shared grocery link.
// Loads the list by share token from Supabase, respects view/edit permission.

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

  // Uses the dedicated shared-viewer hook — NOT useGrocerySync. That hook's
  // own useEffect(() => { load(); }, [load]) runs unconditionally for the
  // *signed-in visitor's own* grocery list and can insert a new row for
  // them, which races against loading this shared list (the same bug that
  // hit the shared plan screen). See useSharedGrocerySync in lib/sync.ts.
  const { items, status, permission, notFound, name, save, rename } = useSharedGrocerySync(token);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const canEdit = permission === "edit";
  const loading = status === "syncing" && !notFound;

  const toggleItem = async (id: string) => {
    if (!canEdit) return;
    await Haptics.selectionAsync();
    await save(items.map((it) => it.id === id ? { ...it, checked: !it.checked, checkedAt: Date.now() } : it));
  };

  const commitEdit = async (id: string) => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed > 0 && canEdit) {
      await save(items.map((it) => it.id === id ? { ...it, amount: Math.round(parsed * 100) / 100 } : it));
    }
    setEditingId(null);
    setEditValue("");
  };

  const handleCopy = async () => {
    const unchecked = items.filter((it) => !it.checked);
    if (unchecked.length === 0) { Alert.alert("Nothing to copy", "All items are checked off."); return; }
    const text = unchecked.map((it) => `• ${formatItem(it)}`).join("\n");
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
            {canEdit ? "You can check off items" : "View only"} · {unchecked.length} remaining
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
        </View>
      </View>

      {/* Unchecked items */}
      {unchecked.length === 0 && checked.length === 0 && (
        <View style={styles.empty}>
          <Feather name="shopping-cart" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>This list is empty</Text>
        </View>
      )}

      {unchecked.map((item) => (
        <SharedRow
          key={item.id}
          item={item}
          colors={colors}
          canEdit={canEdit}
          isEditing={editingId === item.id}
          editValue={editValue}
          onToggle={() => toggleItem(item.id)}
          onEditStart={() => { if (canEdit) { setEditingId(item.id); setEditValue(item.amount % 1 === 0 ? String(item.amount) : item.amount.toFixed(1)); }}}
          onEditChange={setEditValue}
          onEditCommit={() => commitEdit(item.id)}
        />
      ))}

      {checked.length > 0 && (
        <>
          <Text style={[styles.divider, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>IN CART</Text>
          {checked.map((item) => (
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
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SharedRow({
  item, colors, canEdit, isEditing, editValue,
  onToggle, onEditStart, onEditChange, onEditCommit,
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

      {item.amount !== 1 || item.unit ? (
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
  empty: { alignItems: "center", paddingVertical: 64, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  divider: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, paddingBottom: 12, marginBottom: 4, marginTop: 12, borderBottomWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  rowChecked: { opacity: 0.45 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  amountBadge: { fontSize: 12, fontFamily: "Inter_600SemiBold", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  amountInput: { fontSize: 13, fontFamily: "Inter_600SemiBold", borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3, width: 64 },
  rowTextWrap: { flex: 1, gap: 2 },
  rowText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  rowSource: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
