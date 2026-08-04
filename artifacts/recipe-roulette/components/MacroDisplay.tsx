import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import type { Macros } from "@/lib/types";
import type { IngredientBreakdownItem } from "@/lib/macros";

// Nutrition here is inherently a per-serving figure — it does NOT change
// based on how many servings the person is scaling the ingredients to
// cook. Ingredient amounts scale with a servings stepper elsewhere in the
// screens that use this; nutrition just doesn't. See
// lib/macros.ts's estimateMacrosPerServing() for how this invariant is
// maintained for recipes that don't come with API-provided macros.
export function MacroBar({ macros, colors }: { macros: Macros; colors: ReturnType<typeof useColors> }) {
  const items: { label: string; value: number; unit: string; color: string }[] = [
    { label: "Calories", value: Math.round(macros.calories), unit: "kcal", color: colors.primary },
    { label: "Protein", value: Math.round(macros.protein), unit: "g", color: "#7C8C5E" },
    { label: "Carbs", value: Math.round(macros.carbs), unit: "g", color: "#C8A86B" },
    { label: "Fat", value: Math.round(macros.fat), unit: "g", color: "#B87333" },
    { label: "Fiber", value: Math.round(macros.fiber), unit: "g", color: "#6B8E6B" },
  ];
  return (
    <View style={[macroStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={macroStyles.headingRow}>
        <Text style={[macroStyles.heading, { color: colors.mutedForeground }]}>NUTRITION PER SERVING</Text>
        {/* Distinguishes real API-sourced macros (Spoonacular bookmarks)
            from lib/macros.ts's USDA/local-table estimate, so it's
            obvious at a glance which one you're looking at — useful for
            spotting a recipe that should have real data but doesn't
            (e.g. bookmarked before servings/macros persistence existed,
            or before this build was deployed). */}
        {macros.estimated && (
          <Text style={[macroStyles.estimatedBadge, { color: colors.mutedForeground, borderColor: colors.border }]}>
            estimated
          </Text>
        )}
      </View>
      <View style={macroStyles.row}>
        {items.map((item) => (
          <View key={item.label} style={macroStyles.cell}>
            <Text style={[macroStyles.value, { color: colors.foreground }]}>{item.value}</Text>
            <Text style={[macroStyles.unit, { color: item.color }]}>{item.unit}</Text>
            <Text style={[macroStyles.label, { color: colors.mutedForeground }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function MacroPills({ macros, colors }: { macros: Macros; colors: ReturnType<typeof useColors> }) {
  // Same real-vs-estimated distinction as MacroBar's badge, just
  // compact enough to fit a list row: a "~" prefix on calories rather
  // than a separate label.
  const caloriesPrefix = macros.estimated ? "~" : "";
  return (
    <View style={macroStyles.pillRow}>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{caloriesPrefix}{Math.round(macros.calories)}</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>kcal</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{Math.round(macros.protein)}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>protein</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{Math.round(macros.carbs)}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>carbs</Text>
      </View>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{Math.round(macros.fat)}g</Text>
        <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>fat</Text>
      </View>
    </View>
  );
}

// Per-ingredient view of how a recipe's macro estimate was built — lets
// someone see exactly what each line resolved to (and whether it
// resolved at all), rather than just trusting the aggregate numbers
// above. Collapsed by default since it's a lot of detail; only rendered
// when there's actually a breakdown to show (i.e. macros came from
// lib/macros.ts's estimator, not real API-sourced data — those don't
// carry a line-by-line breakdown).
export function IngredientBreakdown({
  items,
  colors,
}: {
  items: IngredientBreakdownItem[] | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (!items || items.length === 0) return null;

  return (
    <View style={[macroStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={macroStyles.headingRow}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide ingredient breakdown" : "Show ingredient breakdown"}
      >
        <Text style={[macroStyles.heading, { color: colors.mutedForeground }]}>INGREDIENT BREAKDOWN</Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {expanded && (
        <View>
          {items.map((item, i) => (
            <View
              key={i}
              style={[
                macroStyles.ingredientRow,
                i < items.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={macroStyles.ingredientTextCol}>
                <Text style={[macroStyles.ingredientName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.line}
                </Text>
                <Text style={[macroStyles.ingredientMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {item.unresolved
                    ? "Not counted — no matching ingredient found"
                    : `${Math.round(item.grams)}g · ${item.matchedDescription ?? "unknown source"}`}
                </Text>
              </View>
              {!item.unresolved && (
                <View style={macroStyles.ingredientMacroCol}>
                  <Text style={[macroStyles.ingredientCalories, { color: colors.foreground }]}>
                    {Math.round(item.calories)} kcal
                  </Text>
                  <Text style={[macroStyles.ingredientMeta, { color: colors.mutedForeground }]}>
                    {Math.round(item.protein)}p · {Math.round(item.carbs)}c · {Math.round(item.fat)}f
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const macroStyles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 8, marginBottom: 4 },
  heading: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  estimatedBadge: { fontSize: 9, fontFamily: "Inter_600SemiBold", borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  cell: { alignItems: "center", flex: 1 },
  value: { fontSize: 17, fontFamily: "Inter_700Bold" },
  unit: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  label: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  pillLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  ingredientRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, gap: 10 },
  ingredientTextCol: { flex: 1 },
  ingredientMacroCol: { alignItems: "flex-end" },
  ingredientName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  ingredientMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  ingredientCalories: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
