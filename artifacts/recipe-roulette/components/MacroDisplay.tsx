export function IngredientBreakdown({
  items,
  colors,
}: {
  items: IngredientBreakdownItem[] | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (!items || items.length === 0) return null;

  const resolvedCount = items.filter((i) => !i.unresolved).length;
  const maxCalories = Math.max(1, ...items.map((i) => (i.unresolved ? 0 : i.calories)));

  return (
    <View style={[macroStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={macroStyles.headingRow}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide ingredient breakdown" : "Show ingredient breakdown"}
      >
        <Text style={[macroStyles.heading, { color: colors.mutedForeground }]}>
          INGREDIENT BREAKDOWN · {resolvedCount}
        </Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </Pressable>
      {expanded && (
        <View style={{ marginTop: 8, gap: 10 }}>
          {items.map((item, i) => {
            const barPct = item.unresolved ? 0 : Math.max(6, Math.round((item.calories / maxCalories) * 100));
            return (
              <View
                key={i}
                style={[
                  macroStyles.ingredientCard,
                  { backgroundColor: colors.secondary, opacity: item.unresolved ? 0.55 : 1 },
                ]}
              >
                <View style={macroStyles.ingredientContentRow}>
                  <View style={macroStyles.ingredientTextCol}>
                    <Text style={[macroStyles.ingredientName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.line}
                    </Text>
                    {item.unresolved ? (
                      <View style={macroStyles.ingredientUnresolvedRow}>
                        <Feather name="minus-circle" size={11} color={colors.mutedForeground} />
                        <Text style={[macroStyles.ingredientMeta, { color: colors.mutedForeground }]}>
                          Not counted — no match found
                        </Text>
                      </View>
                    ) : (
                      <Text style={[macroStyles.ingredientMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {Math.round(item.grams)}g · {item.matchedDescription ?? "unknown source"}
                      </Text>
                    )}
                  </View>
                  {!item.unresolved && (
                    <Text style={[macroStyles.ingredientCalories, { color: colors.foreground }]}>
                      {Math.round(item.calories)}
                      <Text style={[macroStyles.ingredientCaloriesUnit, { color: colors.mutedForeground }]}> kcal</Text>
                    </Text>
                  )}
                </View>

                {!item.unresolved && (
                  <>
                    <View style={[macroStyles.ingredientBarTrack, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          macroStyles.ingredientBarFill,
                          { width: `${barPct}%`, backgroundColor: colors.primary },
                        ]}
                      />
                    </View>
                    <View style={macroStyles.ingredientChipRow}>
                      <View style={[macroStyles.macroChip, { backgroundColor: `${MACRO_COLORS.protein}22` }]}>
                        <View style={[macroStyles.dot, { backgroundColor: MACRO_COLORS.protein }]} />
                        <Text style={[macroStyles.macroChipText, { color: colors.foreground }]}>
                          {Math.round(item.protein)}g P
                        </Text>
                      </View>
                      <View style={[macroStyles.macroChip, { backgroundColor: `${MACRO_COLORS.carbs}22` }]}>
                        <View style={[macroStyles.dot, { backgroundColor: MACRO_COLORS.carbs }]} />
                        <Text style={[macroStyles.macroChipText, { color: colors.foreground }]}>
                          {Math.round(item.carbs)}g C
                        </Text>
                      </View>
                      <View style={[macroStyles.macroChip, { backgroundColor: `${MACRO_COLORS.fat}22` }]}>
                        <View style={[macroStyles.dot, { backgroundColor: MACRO_COLORS.fat }]} />
                        <Text style={[macroStyles.macroChipText, { color: colors.foreground }]}>
                          {Math.round(item.fat)}g F
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
