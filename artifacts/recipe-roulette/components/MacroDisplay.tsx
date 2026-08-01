import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { Macros } from "@/lib/types";

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
      <Text style={[macroStyles.heading, { color: colors.mutedForeground }]}>NUTRITION PER SERVING</Text>
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
  return (
    <View style={macroStyles.pillRow}>
      <View style={[macroStyles.pill, { backgroundColor: colors.secondary }]}>
        <Text style={[macroStyles.pillVal, { color: colors.foreground }]}>{Math.round(macros.calories)}</Text>
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

const macroStyles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 8, marginBottom: 4 },
  heading: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  cell: { alignItems: "center", flex: 1 },
  value: { fontSize: 17, fontFamily: "Inter_700Bold" },
  unit: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  label: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pillVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  pillLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
