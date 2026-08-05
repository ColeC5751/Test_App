import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useGrocerySync, AISLE_MAP, AISLE_ORDER } from "@/lib/sync";
import { buildShareUrl } from "@/lib/supabase";
import type { GroceryItem, SyncStatus } from "@/lib/types";
import { useOnboarding } from "@/lib/onboarding";

// ─── Display helpers ───────────────────────────────────────────────────────────
// Parsing, aisle categorization, and merging live in lib/sync.ts — this file
// only formats items for display and groups them by aisle.

function formatItem(item: GroceryItem): string {
  const amt = item.amount === 1 && !item.unit
    ? ""
    : `${item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}${item.unit ? " " + item.unit : ""} `;
  return `${amt}${item.name}`;
}

function groupByAisle(items: GroceryItem[]): { aisle: string; icon: string; items: GroceryItem[] }[] {
  const map = new Map<string, GroceryItem[]>();
  for (const item of items) {
    if (!map.has(item.aisle)) map.set(item.aisle, []);
    map.get(item.aisle)!.push(item);
  }
  return AISLE_ORDER
    .filter((a) => map.has(a))
    .map((a) => ({
      aisle: a,
      icon: AISLE_MAP.find((m) => m.aisle === a)?.icon ?? "🛒",
      items: (map.get(a)!).slice().sort((x, y) => {
        if (y.amount !== x.amount) return y.amount - x.amount;
        return x.name.localeCompare(y.name);
      }),
    }));
}

// ─── Sync status dot ──────────────────────────────────────────────────────────
// Exported so the shared list screen can reuse it instead of duplicating it.

export function SyncDot({ status }: { status: SyncStatus }) {
  const color =
    status === "synced" ? "#7C8C5E" :
    status === "syncing" ? "#C8A86B" :
    status === "offline" ? "#9A9A88" : "#ef4444";
  return (
    <View style={[syncDotStyles.dot, { backgroundColor: color }]} />
  );
}

const syncDotStyles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});

// ─── Confirm Modal ────────────────────────────────────────────────────────────
// Styled replacement for Alert.alert/window.confirm. Alert.alert with a
// multi-button config is unreliable on React Native Web — it can silently
// fail to present, which is why the header trash icon previously appeared
// completely broken (no dialog, no haptics, no deletion). This renders as a
// real React Native <Modal>, so it works identically on web and native, and
// it matches the app's card/rounded-corner visual language instead of the
// platform's native dialog chrome.
//
// Exported so the shared list screen can reuse the same styled confirmation
// instead of duplicating it.

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  icon,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  icon: keyof typeof Feather.glyphMap;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={confirmStyles.overlay}>
        <View style={[confirmStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[confirmStyles.iconWrap, { backgroundColor: colors.secondary }]}>
            <Feather name={icon} size={20} color={colors.destructive} />
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
                { backgroundColor: colors.destructive },
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

// ─── Share Modal ──────────────────────────────────────────────────────────────

function ShareModal({
  visible,
  onClose,
  shareToken,
  permission,
  onSetPermission,
}: {
  visible: boolean;
  onClose: () => void;
  shareToken: string | null;
  permission: "view" | "edit";
  onSetPermission: (p: "view" | "edit") => void;
}) {
  const colors = useColors();
  const shareUrl = shareToken ? buildShareUrl("grocery", shareToken) : null;

  const handleShare = async () => {
    if (!shareUrl) return;
    // Only pass `message` — Share.share() on iOS appends `url` to the end
    // of `message` rather than treating them as alternatives, so passing
    // both produced the link twice in the share sheet text.
    await Share.share({
      message: `Join my grocery list on That's Dinner:\n${shareUrl}`,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[shareStyles.root, { backgroundColor: colors.background }]}>
        <View style={[shareStyles.header, { borderBottomColor: colors.border }]}>
          <Text style={[shareStyles.title, { color: colors.foreground }]}>Share Grocery List</Text>
          <Pressable onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={shareStyles.body}>
          <Text style={[shareStyles.desc, { color: colors.mutedForeground }]}>
            Anyone with the link can access your grocery list. Set their permission level below.
          </Text>

          <View style={[shareStyles.permRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View>
              <Text style={[shareStyles.permLabel, { color: colors.foreground }]}>Allow editing</Text>
              <Text style={[shareStyles.permSub, { color: colors.mutedForeground }]}>
                {permission === "edit" ? "Anyone with link can check off items" : "Anyone with link can view only"}
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
            <View style={[shareStyles.urlBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[shareStyles.urlText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {shareUrl}
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [shareStyles.shareBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
          >
            <Feather name="share" size={16} color={colors.primaryForeground} />
            <Text style={[shareStyles.shareBtnText, { color: colors.primaryForeground }]}>Share Link</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const shareStyles = StyleSheet.create({
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GroceryScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const {
    items,
    status,
    shareToken,
    // Now sourced from useGrocerySync (backed by the grocery_lists.permission
    // column) instead of a local component useState that never reached
    // Supabase and reset to "view" on every remount.
    permission,
    setSharePermission,
    // List display name + rename, mirroring the shared-viewer hook so both
    // screens can edit the same grocery_lists.name column.
    name,
    rename,
    save,
    load,
    addIngredients,
    deleteItem: deleteItemSync,
    toggleItem: toggleItemSync,
    updateItemAmount,

    // Diagnostics — kept in the hook's return, just unused here.
    // Uncomment along with the JSX block below to reinstate the panel.
    // errorMessage,
    // errorCode,
    // errorDetails,
    // userId,
    // ownerId,
    // rowId,
    // lastOperation,
  } = useGrocerySync();

  const { step: onboardingStep, advance: advanceOnboarding } = useOnboarding();
  
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [manualInputFocused, setManualInputFocused] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // Title editing — same pattern as the shared list screen. Tapping the
  // heading swaps it for a TextInput; blurring or submitting commits the
  // rename via the hook, which persists it to grocery_lists.name.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  const commitTitle = async () => {
    setEditingTitle(false);
    const trimmed = titleInput.trim();
    if (trimmed && trimmed !== name) {
      await rename(trimmed);
    }
  };

  // Styled confirmation for "Clear list". Previously this used
  // Alert.alert(...) directly inside handleClear, which silently fails to
  // present on React Native Web — meaning the whole chain (including the
  // save([]) call) never fired, with no haptic or error feedback. Now the
  // trash icon just opens this modal; the actual clear + save happens in
  // confirmClear below once the person taps "Clear".
  const [showClearModal, setShowClearModal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load().then(() => setLoaded(true));
    }, [load])
  );

  // Race-safe: these call into useGrocerySync()'s canonical mutation
  // methods, which compute the next list off itemsRef rather than this
  // component's `items` closure, so rapid consecutive taps never clobber
  // each other. deleteItemSync now also reports whether the removal
  // actually persisted, so we can tell the person if it didn't rather than
  // letting the item silently reappear later.
  const deleteItem = useCallback(async (id: string) => {
    const ok = await deleteItemSync(id);
    if (ok) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't delete item",
        "This item wasn't removed from your synced list. Check your connection and try again."
      );
    }
  }, [deleteItemSync]);

  const toggleItem = async (id: string) => {
    await Haptics.selectionAsync();
    const ok = await toggleItemSync(id);
    if (!ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't update item",
        "This change wasn't saved to your synced list. Check your connection and try again."
      );
    }
  };

  const startEdit = (item: GroceryItem) => {
    setEditingId(item.id);
    setEditValue(item.amount % 1 === 0 ? String(item.amount) : item.amount.toFixed(1));
  };

  const commitEdit = async (id: string) => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed > 0) {
      const ok = await updateItemAmount(id, Math.round(parsed * 100) / 100);
      if (!ok) {
        Alert.alert(
          "Couldn't update amount",
          "This change wasn't saved to your synced list. Check your connection and try again."
        );
      }
    }
    setEditingId(null);
    setEditValue("");
  };

  const handleManualAdd = async () => {
    const text = manualInput.trim();
    if (!text) return;
    // isManualEntry: true tells toGroceryItems to skip the
    // recognized-ingredient gate, which otherwise silently dropped
    // one-word entries (e.g. "napkins") that aren't in the local food
    // table. Manual entries are always kept as typed.
    await addIngredients(text, { isManualEntry: true });
    setManualInput("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Onboarding: adding anything to the grocery list satisfies step 3.
if (onboardingStep === "plan_or_grocery") {
advanceOnboarding("complete");
}
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Opens the styled ConfirmModal instead of calling Alert.alert directly.
  const handleClear = () => setShowClearModal(true);

  // Fires once the person taps "Clear" in ConfirmModal. Checks save()'s
  // return value and surfaces a failure alert instead of assuming success,
  // matching the pattern already used by deleteItem/toggleItem/commitEdit.
  // Haptics are skipped on web since expo-haptics isn't supported there.
  const confirmClear = async () => {
    setShowClearModal(false);
    const ok = await save([]);
    if (ok) {
      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't clear list",
        "This change wasn't saved to your synced list. Check your connection and try again."
      );
    }
  };

  const unchecked = items.filter((it) => !it.checked);
  const checked = items.filter((it) => it.checked);
  const uncheckedGroups = groupByAisle(unchecked);
  const checkedGroups = groupByAisle(checked);

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {editingTitle ? (
              <TextInput
                style={[styles.headingInput, { color: colors.foreground, borderColor: colors.primary }]}
                value={titleInput}
                onChangeText={setTitleInput}
                autoFocus
                onBlur={commitTitle}
                onSubmitEditing={commitTitle}
                placeholder="Grocery List"
                placeholderTextColor={colors.mutedForeground}
              />
            ) : (
              <Pressable onPress={() => { setTitleInput(name ?? ""); setEditingTitle(true); }}>
                <Text style={[styles.heading, { color: colors.foreground }]}>{name || "Grocery List"}</Text>
              </Pressable>
            )}
            <View style={styles.subRow}>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                {items.length === 0
                  ? "Add ingredients from any recipe"
                  : `${unchecked.length} of ${items.length} remaining`}
              </Text>
              <SyncDot status={status} />
            </View>
            {items.length > 0 && (
              <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.primary,
                      width: `${Math.round((checked.length / items.length) * 100)}%`,
                    },
                  ]}
                />
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            {items.length > 0 && (
              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
              >
                <Feather name="copy" size={16} color={colors.foreground} />
              </Pressable>
            )}
            <Pressable
              onPress={() => setShowShareModal(true)}
              style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
            >
              <Feather name="share-2" size={16} color={colors.foreground} />
            </Pressable>
            {items.length > 0 && (
              <Pressable
                onPress={handleClear}
                style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
              >
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Manual add input */}
        <View
          style={[
            styles.manualAddRow,
            { backgroundColor: colors.card, borderColor: manualInputFocused ? colors.primary : colors.border },
          ]}
        >
          <Feather name="shopping-bag" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.manualAddInput, { color: colors.foreground }]}
            value={manualInput}
            onChangeText={setManualInput}
            placeholder="Add an item (e.g. 2 lbs ground beef)"
            placeholderTextColor={colors.mutedForeground}
            onSubmitEditing={handleManualAdd}
            onFocus={() => setManualInputFocused(true)}
            onBlur={() => setManualInputFocused(false)}
            returnKeyType="done"
          />
          <Pressable
            onPress={handleManualAdd}
            disabled={!manualInput.trim()}
            style={({ pressed }) => [
              styles.manualAddBtn,
              { backgroundColor: manualInput.trim() ? colors.primary : colors.muted },
              pressed && manualInput.trim() && { opacity: 0.85 },
            ]}
          >
            <Feather name="plus" size={18} color={manualInput.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Empty state */}
        {loaded && items.length === 0 && (
          <View style={styles.empty}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.secondary }]}>
              <Feather name="shopping-cart" size={26} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your list is empty</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Add an item above, or tap "Add to Grocery List" inside any recipe
            </Text>
          </View>
        )}

        {/* Unchecked items grouped by aisle */}
        {uncheckedGroups.map(({ aisle, icon, items: aisleItems }) => (
          <View key={aisle} style={styles.aisleSection}>
            <View style={styles.aisleHeader}>
              <View style={[styles.aisleIconWrap, { backgroundColor: colors.secondary }]}>
                <Text style={styles.aisleIcon}>{icon}</Text>
              </View>
              <Text style={[styles.aisleLabel, { color: colors.foreground }]}>{aisle.toUpperCase()}</Text>
              <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.aisleCount, { color: colors.mutedForeground }]}>{aisleItems.length}</Text>
            </View>
            {aisleItems.map((item) => (
              <GroceryRow
                key={item.id}
                item={item}
                colors={colors}
                isEditing={editingId === item.id}
                editValue={editValue}
                onToggle={() => toggleItem(item.id)}
                onEditStart={() => startEdit(item)}
                onEditChange={setEditValue}
                onEditCommit={() => commitEdit(item.id)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </View>
        ))}

        {/* In cart section */}
        {checked.length > 0 && (
          <View style={styles.aisleSection}>
            <View style={styles.aisleHeader}>
              <View style={[styles.aisleIconWrap, { backgroundColor: colors.secondary }]}>
                <Text style={styles.aisleIcon}>✅</Text>
              </View>
              <Text style={[styles.aisleLabel, { color: colors.foreground }]}>IN CART</Text>
              <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.aisleCount, { color: colors.mutedForeground }]}>{checked.length}</Text>
            </View>
            {checkedGroups.map(({ items: aisleItems }) =>
              aisleItems.map((item) => (
                <GroceryRow
                  key={item.id}
                  item={item}
                  colors={colors}
                  isEditing={false}
                  editValue=""
                  onToggle={() => toggleItem(item.id)}
                  onEditStart={() => {}}
                  onEditChange={() => {}}
                  onEditCommit={() => {}}
                  onDelete={() => deleteItem(item.id)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>

      <ShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        shareToken={shareToken}
        permission={permission}
        onSetPermission={setSharePermission}
      />

      <ConfirmModal
        visible={showClearModal}
        title="Clear list?"
        message="This will remove all items."
        confirmLabel="Clear"
        icon="trash-2"
        onConfirm={confirmClear}
        onCancel={() => setShowClearModal(false)}
      />
    </>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function GroceryRow({
  item,
  colors,
  isEditing,
  editValue,
  onToggle,
  onEditStart,
  onEditChange,
  onEditCommit,
  onDelete,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  isEditing: boolean;
  editValue: string;
  onToggle: () => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onDelete: () => void;
}) {
  // Always show a quantity indicator — including a plain "1" for items
  // with no unit — rather than leaving the amount column empty. Hiding it
  // for amount===1/no-unit items used to leave a visibly blank gap next
  // to the checkbox on those rows, which read as broken rather than
  // intentional once every row's name column was aligned to the same
  // width (see amountCol below).
  const showAmount = true;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        item.checked && [styles.rowChecked, { backgroundColor: colors.secondary, borderColor: "transparent" }],
      ]}
    >
      <Pressable onPress={onToggle} hitSlop={8}>
        <View style={[styles.checkbox, { borderColor: item.checked ? colors.primary : colors.border, backgroundColor: item.checked ? colors.primary : "transparent" }]}>
          {item.checked && <Feather name="check" size={12} color={colors.primaryForeground} />}
        </View>
      </Pressable>

      {/* Fixed-width column regardless of whether this item has a quantity
          to show. Previously the badge/input was only rendered — and only
          took up space — when the item had an amount, so a "1, no unit"
          item's name started flush against the checkbox while every
          neighboring row's name started further right, after its badge.
          Reserving this column always keeps every row's name starting at
          the same x position. */}
      <View style={styles.amountCol}>
        {showAmount ? (
          isEditing ? (
            <TextInput
              style={[styles.amountInput, { color: colors.foreground, borderColor: colors.primary, backgroundColor: colors.background }]}
              value={editValue}
              onChangeText={onEditChange}
              onBlur={onEditCommit}
              onSubmitEditing={onEditCommit}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
            />
          ) : (
            <Pressable onPress={onEditStart} hitSlop={8}>
              <Text
                style={[
                  styles.amountBadge,
                  { backgroundColor: colors.secondary, color: colors.foreground },
                  item.checked && { backgroundColor: "transparent", color: colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}{item.unit ? ` ${item.unit}` : ""}
              </Text>
            </Pressable>
          )
        ) : null}
      </View>

      <View style={styles.rowTextWrap}>
        <Text
          style={[styles.rowText, { color: colors.foreground }, item.checked && { textDecorationLine: "line-through", color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        {item.addedFromRecipe && (
          <Text style={[styles.rowSource, { color: colors.mutedForeground }]} numberOfLines={1}>
            from {item.addedFromRecipe}{item.servingMultiplier && item.servingMultiplier !== 1 ? ` ×${item.servingMultiplier}` : ""}
          </Text>
        )}
      </View>

      <Pressable onPress={onDelete} hitSlop={12} style={({ pressed }) => [styles.deleteBtn, pressed && { backgroundColor: colors.secondary }]}>
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  diagnostics: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 20, gap: 8 },
  diagnosticsHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  diagnosticsTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  diagnosticRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  diagnosticLabel: { width: 105, fontSize: 11, fontFamily: "Inter_400Regular" },
  diagnosticValue: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  errorBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4, gap: 4 },
  errorTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  errorMeta: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 14 },
  testSaveButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 8, paddingVertical: 10, marginTop: 4 },
  testSaveButtonText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  root: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  headerLeft: { flex: 1, gap: 2 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 2 },
  headingInput: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 2, borderBottomWidth: 1.5, paddingBottom: 2 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  manualAddRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  manualAddInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 13 },
  manualAddBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  // Progress bar under the header, showing checked vs. total at a glance —
  // previously the only feedback was the "X of Y remaining" text.
  progressTrack: { height: 5, borderRadius: 3, marginTop: 10, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  empty: { alignItems: "center", paddingVertical: 64, gap: 14 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260, lineHeight: 20 },

  aisleSection: { marginBottom: 22 },
  aisleHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  aisleIconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  aisleIcon: { fontSize: 13 },
  aisleLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.5 },
  aisleCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  aisleLine: { flex: 1, height: 1 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 9,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  // Checked rows previously used a flat opacity, which washed out the
  // border along with everything else and made the whole row look
  // "disabled" rather than "done." Now they get a tinted fill instead
  // (set inline, from colors.secondary) and only the text dims.
  rowChecked: { shadowOpacity: 0, elevation: 0 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Reserves the same width whether or not an item shows a quantity, so
  // every row's name starts at the same x position.
  amountCol: { minWidth: 52, alignItems: "flex-start", justifyContent: "center" },
  amountBadge: { fontSize: 12, fontFamily: "Inter_700Bold", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  amountInput: { fontSize: 13, fontFamily: "Inter_600SemiBold", borderRadius: 7, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 4, width: 64 },

  rowTextWrap: { flex: 1, gap: 2 },
  rowText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  rowSource: { fontSize: 11, fontFamily: "Inter_400Regular" },
  deleteBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
