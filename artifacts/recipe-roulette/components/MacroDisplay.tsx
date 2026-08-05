import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import type { Macros } from "@/lib/types";
import type { IngredientBreakdownItem } from "@/lib/macros";

// Shared macro accent colors — also used by the ratio bar and dot markers
// below, so a color always means the same macro everywhere it appears.
const MACRO_COLORS = { protein: "#7C8C5E", carbs: "#C8A86B", fat: "#B87333", fiber: "#6B8E6B" };

// Nutrition here is inherently a per-serving figure — it does NOT change
// based on how many servings the person is scaling the ingredients to
// cook. Ingredient amounts scale with a servings stepper elsewhere in the
// screens that use this; nutrition just doesn't. See
// lib/macros.ts's estimateMacrosPerServing() for how this invariant is
// maintained for recipes that don't come with API-provided macros.
export function MacroBar({ macros, colors }: { macros: Macros; colors: ReturnType<typeof useColors> }) {
  // Calories-from-each-macro, not macros.calories itself — protein/carbs
  // are 4 kcal/g, fat is 9 kcal/g. Using this sum (rather than the
  // reported total, which can differ slightly due to rounding/alcohol/
  // sugar alcohols) keeps the three bar segments an honest partition that
  // always adds up to exactly 100%.
  const calFromProtein = macros.protein * 4;
  const calFromCarbs = macros.carbs * 4;
  const calFromFat = macros.fat * 9;
  const calTotal = calFromProtein + calFromCarbs + calFromFat;
  const pct = (n: number) => (calTotal > 0 ? Math.round((n / calTotal) * 100) : 0);

  const stats: { label: string; value: number; color: string; sharePct?: number }[] = [
    { label: "Protein", value: Math.round(macros.protein), color: MACRO_COLORS.protein, sharePct: pct(calFromProtein) },
    { label: "Carbs", value: Math.round(macros.carbs), color: MACRO_COLORS.carbs, sharePct: pct(calFromCarbs) },
    { label: "Fat", value: Math.round(macros.fat), color: MACRO_COLORS.fat, sharePct: pct(calFromFat) },
    { label: "Fiber", value: Math.round(macros.fiber), color: MACRO_COLORS.fiber },
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

      <View style={macroStyles.heroRow}>
        <Text style={[macroStyles.heroValue, { color: colors.foreground }]}>{Math.round(macros.calories)}</Text>
        <Text style={[macroStyles.heroUnit, { color: colors.mutedForeground }]}>kcal</Text>
      </View>

      {calTotal > 0 && (
        <View style={[macroStyles.ratioBar, { backgroundColor: colors.border }]}>
          <View style={{ flex: Math.max(calFromProtein, 0.0001), backgroundColor: MACRO_COLORS.protein }} />
          <View style={{ flex: Math.max(calFromCarbs, 0.0001), backgroundColor: MACRO_COLORS.carbs }} />
          <View style={{ flex: Math.max(calFromFat, 0.0001), backgroundColor: MACRO_COLORS.fat }} />
        </View>
      )}

      <View style={macroStyles.row}>
        {stats.map((item) => (
          <View key={item.label} style={macroStyles.cell}>
            <View style={macroStyles.cellLabelRow}>
              <View style={[macroStyles.dot, { backgroundColor: item.color }]} />
              <Text style={[macroStyles.label, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
            <Text style={[macroStyles.value, { color: colors.foreground }]}>
              {item.value}
              <Text style={[macroStyles.unit, { color: colors.mutedForeground }]}>g</Text>
            </Text>
            {item.sharePct !== undefined && (
              <Text style={[macroStyles.sharePct, { color: colors.mutedForeground }]}>{item.sharePct}%</Text>
            )}
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
  const pills: { value: string; label: string; dot?: string }[] = [
    { value: `${caloriesPrefix}${Math.round(macros.calories)}`, label: "kcal" },
    { value: `${Math.round(macros.protein)}g`, label: "protein", dot: MACRO_COLORS.protein },
    { value: `${Math.round(macros.carbs)}g`, label: "carbs", dot: MACRO_COLORS.carbs },
    { value: `${Math.round(macros.fat)}g`, label: "fat", dot: MACRO_COLORS.fat },
  ];
  return (
    <View style={macroStyles.pillRow}>
      {pills.map((p) => (
        <View key={p.label} style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
          {p.dot && <View style={[macroStyles.pillDot, { backgroundColor: p.dot }]} />}
          <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{p.value}</Text>
          <Text style={[macroStyles.pillLabel, { color: colors.mutedForeground }]}>{p.label}</Text>
        </View>
      ))}
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
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  estimatedBadge: { fontSize: 9, fontFamily: "Inter_600SemiBold", borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 6 },
  heroValue: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  heroUnit: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ratioBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 12, marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  cell: { alignItems: "flex-start", flex: 1 },
  cellLabelRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  value: { fontSize: 18, fontFamily: "Inter_700Bold" },
  unit: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sharePct: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: { flexDirection: "row", alignItems: "baseline", gap: 4, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillDot: { width: 6, height: 6, borderRadius: 3, alignSelf: "center", marginRight: -1 },
  pillVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  pillLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  ingredientRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, gap: 10 },
  ingredientTextCol: { flex: 1 },
  ingredientMacroCol: { alignItems: "flex-end" },
  ingredientName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  ingredientMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  ingredientCalories: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
