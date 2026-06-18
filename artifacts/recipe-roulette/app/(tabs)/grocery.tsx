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
  TextInput,
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
  aisle: string;
}

// ─── Aisle categorization ─────────────────────────────────────────────────────

const AISLE_MAP: { aisle: string; icon: string; keywords: string[] }[] = [
  {
    aisle: "Produce",
    icon: "🥦",
    keywords: [
      "apple","apples","avocado","basil","bean","beans","bell pepper","broccoli",
      "cabbage","carrot","carrots","cauliflower","celery","cherry","chili","cilantro",
      "corn","cucumber","eggplant","garlic","ginger","grape","kale","leek","lemon",
      "lettuce","lime","mint","mushroom","mushrooms","onion","onions","orange",
      "parsley","pea","peas","pepper","peppers","potato","potatoes","rosemary",
      "scallion","spinach","squash","sweet potato","thyme","tomato","tomatoes",
      "zucchini","asparagus","fennel","leeks","parsnip","radish","shallot","turnip",
    ],
  },
  {
    aisle: "Meat & Seafood",
    icon: "🥩",
    keywords: [
      "bacon","beef","chicken","chorizo","clam","cod","crab","duck","fish",
      "ground beef","ground turkey","ham","lamb","lobster","pork","prosciutto",
      "salmon","sausage","scallop","shrimp","steak","tilapia","tuna","turkey",
      "venison","anchovy","anchovies","mussels","sardines","squid",
    ],
  },
  {
    aisle: "Dairy & Eggs",
    icon: "🧀",
    keywords: [
      "butter","cheddar","cheese","cottage cheese","cream","cream cheese","egg",
      "eggs","feta","goat cheese","gouda","gruyere","half and half","heavy cream",
      "milk","mozzarella","parmesan","ricotta","sour cream","whipping cream",
      "yogurt","brie","manchego","pecorino",
    ],
  },
  {
    aisle: "Bakery & Bread",
    icon: "🍞",
    keywords: [
      "bagel","baguette","bread","breadcrumbs","brioche","bun","ciabatta",
      "crouton","croutons","english muffin","flatbread","naan","pita","roll",
      "rolls","sourdough","tortilla","wrap",
    ],
  },
  {
    aisle: "Pantry",
    icon: "🫙",
    keywords: [
      "baking powder","baking soda","bay leaf","black beans","bouillon","broth",
      "brown sugar","capers","chickpeas","chili powder","chocolate","cinnamon",
      "clove","cloves","cocoa","coconut milk","cornstarch","cumin","curry",
      "flour","honey","hot sauce","ketchup","kidney beans","lentils","maple syrup",
      "mayonnaise","molasses","mustard","nutritional yeast","oats","oil",
      "olive oil","oregano","oyster sauce","paprika","peanut butter","pepper",
      "quinoa","red pepper flakes","salt","sesame oil","soy sauce","stock",
      "sugar","tahini","tomato paste","tomato sauce","turmeric","vanilla",
      "vegetable oil","vinegar","worcestershire","yeast","coconut oil",
      "fish sauce","hoisin","miso","sriracha","tabasco",
    ],
  },
  {
    aisle: "Pasta, Rice & Grains",
    icon: "🍝",
    keywords: [
      "barley","brown rice","couscous","egg noodles","farro","fettuccine",
      "lasagna","linguine","macaroni","noodles","orzo","pasta","penne",
      "polenta","ramen","rice","rigatoni","risotto","spaghetti","udon",
      "vermicelli","white rice","wild rice",
    ],
  },
  {
    aisle: "Canned & Jarred",
    icon: "🥫",
    keywords: [
      "artichoke","canned corn","canned tomato","canned tuna","cannellini",
      "crushed tomatoes","diced tomatoes","green chile","green olives",
      "jalapeño","jalapeños","kidney beans","olives","pinto beans",
      "roasted peppers","sun-dried tomato","tomato",
    ],
  },
  {
    aisle: "Frozen",
    icon: "🧊",
    keywords: [
      "frozen broccoli","frozen corn","frozen peas","frozen spinach",
      "frozen shrimp","ice cream","edamame","frozen","tater tots",
    ],
  },
  {
    aisle: "Nuts, Seeds & Dried Fruit",
    icon: "🥜",
    keywords: [
      "almond","almonds","cashew","cashews","chia","cranberry","dried fruit",
      "flaxseed","hemp seed","macadamia","peanut","peanuts","pecan","pecans",
      "pistachio","poppy seed","pumpkin seed","raisin","raisins","sesame",
      "sunflower seed","walnut","walnuts","pine nuts",
    ],
  },
  {
    aisle: "Beverages",
    icon: "🧃",
    keywords: [
      "apple juice","beer","broth","coffee","coconut water","juice","lemonade",
      "orange juice","soda","sparkling water","tea","water","wine","champagne",
      "cider","kombucha","milk alternative","oat milk","almond milk","soy milk",
    ],
  },
  {
    aisle: "Condiments & Sauces",
    icon: "🫙",
    keywords: [
      "barbecue sauce","bbq sauce","buffalo sauce","caesar dressing","dijon",
      "dressing","guacamole","hummus","jam","jelly","pesto","pickle","pickles",
      "ranch","relish","salsa","teriyaki","tzatziki",
    ],
  },
  {
    aisle: "Herbs & Spices",
    icon: "🌿",
    keywords: [
      "allspice","anise","cardamom","cayenne","chives","coriander","dill",
      "fennel seed","herbes","marjoram","nutmeg","saffron","sage","smoked paprika",
      "star anise","tarragon","za'atar",
    ],
  },
];

const AISLE_ORDER = AISLE_MAP.map((a) => a.aisle).concat(["Other"]);

function getAisle(name: string): string {
  const lower = name.toLowerCase().trim();
  // Longest keyword match wins to avoid "corn" matching "acorn squash"
  let best = { aisle: "Other", len: 0 };
  for (const { aisle, keywords } of AISLE_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw) && kw.length > best.len) {
        best = { aisle, len: kw.length };
      }
    }
  }
  return best.aisle;
}

// ─── Unit conversion map (to ml) ─────────────────────────────────────────────

const TO_ML: Record<string, number> = {
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, liter: 1000, liters: 1000,
  tsp: 4.92, teaspoon: 4.92, teaspoons: 4.92,
  tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79,
  cup: 236.6, cups: 236.6,
  "fl oz": 29.57, floz: 29.57,
};

function mlToReadable(ml: number): { amount: number; unit: string } {
  if (ml >= 900) return { amount: Math.round((ml / 1000) * 10) / 10, unit: "l" };
  if (ml >= 60)  return { amount: Math.round(ml / 14.79 * 10) / 10, unit: "tbsp" };
  if (ml >= 5)   return { amount: Math.round(ml / 4.92 * 10) / 10, unit: "tsp" };
  return { amount: Math.round(ml), unit: "ml" };
}

// ─── combineIngredients ───────────────────────────────────────────────────────

export function combineIngredients(
  existing: GroceryItem[],
  incoming: GroceryItem[]
): GroceryItem[] {
  const result = [...existing];
  for (const inc of incoming) {
    const incLower = inc.name.toLowerCase().trim();
    const idx = result.findIndex((e) => e.name.toLowerCase().trim() === incLower);
    if (idx === -1) {
      result.push({ ...inc });
    } else {
      const ex = result[idx];
      const exUnit = ex.unit.toLowerCase().trim();
      const incUnit = inc.unit.toLowerCase().trim();
      if (exUnit === incUnit) {
        result[idx] = { ...ex, amount: Math.round((ex.amount + inc.amount) * 100) / 100 };
      } else if (TO_ML[exUnit] && TO_ML[incUnit]) {
        const totalMl = ex.amount * TO_ML[exUnit] + inc.amount * TO_ML[incUnit];
        const readable = mlToReadable(totalMl);
        result[idx] = { ...ex, amount: readable.amount, unit: readable.unit };
      } else {
        result.push({ ...inc, id: `${inc.id}_${Date.now()}` });
      }
    }
  }
  return result;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export const GROCERY_KEY = "@recipe_roulette_grocery";

export async function loadGroceryList(): Promise<GroceryItem[]> {
  try {
    const json = await AsyncStorage.getItem(GROCERY_KEY);
    return json ? JSON.parse(json) : [];
  } catch { return []; }
}

export async function saveGroceryList(items: GroceryItem[]): Promise<void> {
  try { await AsyncStorage.setItem(GROCERY_KEY, JSON.stringify(items)); } catch {}
}

export async function addIngredientsToGrocery(rawIngredients: string): Promise<void> {
  const existing = await loadGroceryList();
  const lines = rawIngredients.split(/,|\n/).map((l) => l.trim()).filter(Boolean);
  const incoming: GroceryItem[] = lines.map((line, i) => {
    const match = line.match(/^([\d./]+)\s*([a-zA-Z]+(?:\s+[a-zA-Z]+)?)?\s+(.+)$/);
    if (match) {
      const name = match[3]?.trim() || line;
      return {
        id: `g_${Date.now()}_${i}`,
        name,
        amount: parseFloat(match[1]) || 1,
        unit: match[2]?.trim() || "",
        checked: false,
        aisle: getAisle(name),
      };
    }
    return { id: `g_${Date.now()}_${i}`, name: line, amount: 1, unit: "", checked: false, aisle: getAisle(line) };
  });
  await saveGroceryList(combineIngredients(existing, incoming));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      items: map.get(a)!,
    }));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GroceryScreen() {
  const colors = useColors();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useFocusEffect(
    useCallback(() => {
      loadGroceryList().then((list) => { setItems(list); setLoaded(true); });
    }, [])
  );

  const persist = async (updated: GroceryItem[]) => {
    setItems(updated);
    await saveGroceryList(updated);
  };

  const toggleItem = async (id: string) => {
    await Haptics.selectionAsync();
    await persist(items.map((it) => it.id === id ? { ...it, checked: !it.checked } : it));
  };

  const startEdit = (item: GroceryItem) => {
    setEditingId(item.id);
    setEditValue(item.amount % 1 === 0 ? String(item.amount) : item.amount.toFixed(1));
  };

  const commitEdit = async (id: string) => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && parsed > 0) {
      await persist(items.map((it) => it.id === id ? { ...it, amount: Math.round(parsed * 100) / 100 } : it));
    }
    setEditingId(null);
    setEditValue("");
  };

  const handleCopy = async () => {
    const unchecked = items.filter((it) => !it.checked);
    if (unchecked.length === 0) { Alert.alert("Nothing to copy", "All items are checked off."); return; }
    const grouped = groupByAisle(unchecked);
    const text = grouped
      .map(({ aisle, icon, items: aisleItems }) =>
        `${icon} ${aisle}\n` + aisleItems.map((it) => `  • ${formatItem(it)}`).join("\n")
      )
      .join("\n\n");
    await Share.share({ message: `Shopping List:\n\n${text}` });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleClear = () => {
    Alert.alert("Clear list?", "This will remove all items.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: async () => { await persist([]); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  };

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
        <View>
          <Text style={[styles.heading, { color: colors.foreground }]}>Grocery List</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {items.length === 0
              ? "Add ingredients from any recipe"
              : `${unchecked.length} of ${items.length} remaining`}
          </Text>
        </View>
        {items.length > 0 && (
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
            >
              <Feather name="share" size={16} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={handleClear}
              style={({ pressed }) => [styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
            >
              <Feather name="trash-2" size={16} color={colors.destructive} />
            </Pressable>
          </View>
        )}
      </View>

      {/* Empty state */}
      {loaded && items.length === 0 && (
        <View style={styles.empty}>
          <Feather name="shopping-cart" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your list is empty</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Tap "Add to Grocery List" inside any recipe to get started
          </Text>
        </View>
      )}

      {/* Unchecked items grouped by aisle */}
      {uncheckedGroups.map(({ aisle, icon, items: aisleItems }) => (
        <View key={aisle} style={styles.aisleSection}>
          <View style={styles.aisleHeader}>
            <Text style={styles.aisleIcon}>{icon}</Text>
            <Text style={[styles.aisleLabel, { color: colors.mutedForeground }]}>{aisle.toUpperCase()}</Text>
            <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
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
              onDelete={() => persist(items.filter((it) => it.id !== item.id))}
            />
          ))}
        </View>
      ))}

      {/* In cart section */}
      {checked.length > 0 && (
        <View style={styles.aisleSection}>
          <View style={styles.aisleHeader}>
            <Text style={styles.aisleIcon}>✅</Text>
            <Text style={[styles.aisleLabel, { color: colors.mutedForeground }]}>IN CART</Text>
            <View style={[styles.aisleLine, { backgroundColor: colors.border }]} />
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
                onDelete={() => persist(items.filter((it) => it.id !== item.id))}
              />
            ))
          )}
        </View>
      )}
    </ScrollView>
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
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        item.checked && styles.rowChecked,
      ]}
    >
      {/* Checkbox */}
      <Pressable onPress={onToggle} hitSlop={8}>
        <View
          style={[
            styles.checkbox,
            { borderColor: item.checked ? colors.primary : colors.border, backgroundColor: item.checked ? colors.primary : "transparent" },
          ]}
        >
          {item.checked && <Feather name="check" size={12} color={colors.primaryForeground} />}
        </View>
      </Pressable>

      {/* Amount — tappable to edit */}
      {item.amount > 0 && item.unit !== "" || item.amount !== 1 ? (
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
          <Pressable onPress={onEditStart} hitSlop={8}>
            <Text style={[styles.amountBadge, { backgroundColor: colors.secondary, color: colors.mutedForeground }]}>
              {item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)}{item.unit ? ` ${item.unit}` : ""}
            </Text>
          </Pressable>
        )
      ) : null}

      {/* Name */}
      <Text
        style={[
          styles.rowText,
          { color: colors.foreground },
          item.checked && { textDecorationLine: "line-through", color: colors.mutedForeground },
        ]}
        numberOfLines={2}
      >
        {item.name}
      </Text>

      {/* Delete */}
      <Pressable onPress={onDelete} hitSlop={12}>
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 64, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260, lineHeight: 20 },
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
  rowText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
