import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { useColors } from "@/hooks/useColors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroceryItem {
  id: string;
  name: string;
  amount: number;
  unit: string;
  checked: boolean;
}

// ─── Unit conversion map (to ml) ─────────────────────────────────────────────

const TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  tsp: 4.92,
  teaspoon: 4.92,
  teaspoons: 4.92,
  tbsp: 14.79,
  tablespoon: 14.79,
  tablespoons: 14.79,
  cup: 236.6,
  cups: 236.6,
  "fl oz": 29.57,
  floz: 29.57,
};

// Most readable display unit from ml total
function mlToReadable(ml: number): { amount: number; unit: string } {
  if (ml >= 900) return { amount: Math.round((ml / 1000) * 10) / 10, unit: "l" };
  if (ml >= 60) return { amount: Math.round(ml / 14.79 * 10) / 10, unit: "tbsp" };
  if (ml >= 5) return { amount: Math.round(ml / 4.92 * 10) / 10, unit: "tsp" };
  return { amount: Math.round(ml), unit: "ml" };
}

// ─── combineIngredients utility ───────────────────────────────────────────────
//
// Test cases (as comments):
//
// combineIngredients(
//   [{ id:"1", name:"butter", amount:2, unit:"tbsp", checked:false }],
//   [{ id:"x", name:"Butter", amount:1, unit:"tbsp", checked:false }]
// )
// → [{ name:"butter", amount:3, unit:"tbsp", checked:false, ... }]
//
// combineIngredients(
//   [{ id:"1", name:"milk", amount:1, unit:"cup", checked:false }],
//   [{ id:"x", name:"milk", amount:4, unit:"tbsp", checked:false }]
// )
// → units differ → both converted to ml (236.6 + 59.16 = 295.76 ml)
//   displayed as most readable unit → { amount:~1.3, unit:"cup"... }
//   (rounds to tbsp/cups etc.)
//
// combineIngredients(
//   [{ id:"1", name:"chicken", amount:500, unit:"g", checked:false }],
//   [{ id:"x", name:"chicken", amount:200, unit:"g", checked:false }]
// )
// → same unit → { amount:700, unit:"g", ... }
//
// combineIngredients(
//   [],
//   [{ id:"x", name:"garlic", amount:3, unit:"cloves", checked:false }]
// )
// → garlic not found → appended as new item

export function combineIngredients(
  existing: GroceryItem[],
  incoming: GroceryItem[]
): GroceryItem[] {
  const result = [...existing];

  for (const inc of incoming) {
    const incNameLower = inc.name.toLowerCase().trim();
    const idx = result.findIndex((e) => e.name.toLowerCase().trim() === incNameLower);

    if (idx === -1) {
      // Not found — append as new
      result.push({ ...inc });
    } else {
      const ex = result[idx];
      const exUnit = ex.unit.toLowerCase().trim();
      const incUnit = inc.unit.toLowerCase().trim();

      if (exUnit === incUnit) {
        // Same unit — simple addition
        result[idx] = { ...ex, amount: Math.round((ex.amount + inc.amount) * 100) / 100 };
      } else if (TO_ML[exUnit] && TO_ML[incUnit]) {
        // Both convertible to ml — sum in ml then display readably
        const totalMl = ex.amount * TO_ML[exUnit] + inc.amount * TO_ML[incUnit];
        const readable = mlToReadable(totalMl);
        result[idx] = { ...ex, amount: readable.amount, unit: readable.unit };
      } else {
        // Units differ and not both convertible — append as separate item
        result.push({ ...inc, id: `${inc.id}_${Date.now()}` });
      }
    }
  }

  return result;
}

// ─── Storage key ──────────────────────────────────────────────────────────────

export const GROCERY_KEY = "@recipe_roulette_grocery";

export async function loadGroceryList(): Promise<GroceryItem[]> {
  try {
    const json = await AsyncStorage.getItem(GROCERY_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveGroceryList(items: GroceryItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(GROCERY_KEY, JSON.stringify(items));
  } catch {}
}

export async function addIngredientsToGrocery(
  rawIngredients: string
): Promise<void> {
  const existing = await loadGroceryList();

  // Parse comma-separated or newline-separated ingredients
  // Each item looks like: "2 tbsp butter" or "500g chicken" or "garlic cloves"
  const lines = rawIngredients
    .split(/,|\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const incoming: GroceryItem[] = lines.map((line, i) => {
    // Try to parse amount + unit + name
    const match = line.match(
      /^([\d./]+)\s*([a-zA-Z]+(?:\s+[a-zA-Z]+)?)?\s+(.+)$/
    );
    if (match) {
      const amount = parseFloat(match[1]) || 1;
      const unit = match[2]?.trim() || "";
      const name = match[3]?.trim() || line;
      return { id: `g_${Date.now()}_${i}`, name, amount, unit, checked: false };
    }
    // Fallback — whole line is the name
    return { id: `g_${Date.now()}_${i}`, name: line, amount: 1, unit: "", checked: false };
  });

  const combined = combineIngredients(existing, incoming);
  await saveGroceryList(combined);
}

// ─── Format item for display ──────────────────────────────────────────────────

function formatItem(item: GroceryItem): string {
  const amtStr =
    item.amount === 1 && !item.unit
      ? ""
      : `${item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}${item.unit ? " " + item.unit : ""} `;
  return `${amtStr}${item.name}`;
}

// ─── Grocery List Screen ──────────────────────────────────────────────────────

export default function GroceryScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadGroceryList().then((list) => {
        setItems(list);
        setLoaded(true);
      });
    }, [])
  );

  const persist = async (updated: GroceryItem[]) => {
    setItems(updated);
    await saveGroceryList(updated);
  };

  const toggleItem = async (id: string) => {
    await Haptics.selectionAsync();
    await persist(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
  };

  const handleCopy = async () => {
    const unchecked = items.filter((it) => !it.checked);
    if (unchecked.length === 0) {
      Alert.alert("Nothing to copy", "All items are checked off.");
      return;
    }
    const text = unchecked.map((it) => `• ${formatItem(it)}`).join("\n");
    await Share.share({ message: `Shopping List:\n\n${text}` });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleClear = () => {
    Alert.alert(
      "Clear list?",
      "This will remove all items from your grocery list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await persist([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const uncheckedCount = items.filter((it) => !it.checked).length;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: topPad + 32,
        paddingHorizontal: 20,
        paddingBottom: 120,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.heading, { color: colors.foreground }]}>
            Grocery List
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {items.length === 0
              ? "Add ingredients from any recipe"
              : `${uncheckedCount} of ${items.length} remaining`}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {items.length > 0 && (
            <>
              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel="Copy list"
              >
                <Feather name="share" size={16} color={colors.foreground} />
              </Pressable>
              <Pressable
                onPress={handleClear}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel="Clear list"
              >
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            </>
          )}
        </View>
      </View>

      {/* Empty state */}
      {loaded && items.length === 0 && (
        <View style={styles.empty}>
          <Feather name="shopping-cart" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Your list is empty
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Tap "Add to grocery list" inside any recipe to get started
          </Text>
        </View>
      )}

      {/* Unchecked items */}
      {items.filter((it) => !it.checked).map((item) => (
        <GroceryRow
          key={item.id}
          item={item}
          colors={colors}
          onToggle={() => toggleItem(item.id)}
        />
      ))}

      {/* Checked items section */}
      {items.some((it) => it.checked) && (
        <>
          <Text
            style={[
              styles.sectionDivider,
              { color: colors.mutedForeground, borderBottomColor: colors.border },
            ]}
          >
            IN CART
          </Text>
          {items.filter((it) => it.checked).map((item) => (
            <GroceryRow
              key={item.id}
              item={item}
              colors={colors}
              onToggle={() => toggleItem(item.id)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ─── Row component ─────────────────────────────────────────────────────────────

function GroceryRow({
  item,
  colors,
  onToggle,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        item.checked && styles.rowChecked,
        pressed && { opacity: 0.7 },
      ]}
    >
      {/* Checkbox */}
      <View
        style={[
          styles.checkbox,
          {
            borderColor: item.checked ? colors.primary : colors.border,
            backgroundColor: item.checked ? colors.primary : "transparent",
          },
        ]}
      >
        {item.checked && (
          <Feather name="check" size={12} color={colors.primaryForeground} />
        )}
      </View>

      {/* Label */}
      <Text
        style={[
          styles.rowText,
          { color: colors.foreground },
          item.checked && {
            textDecorationLine: "line-through",
            color: colors.mutedForeground,
          },
        ]}
      >
        {formatItem(item)}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 64,
    gap: 12,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 20,
  },
  sectionDivider: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 2,
    paddingBottom: 12,
    marginBottom: 4,
    marginTop: 12,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  rowChecked: { opacity: 0.45 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
