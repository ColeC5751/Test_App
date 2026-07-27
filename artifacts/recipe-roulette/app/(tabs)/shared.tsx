// app/(tabs)/shared.tsx
// "Shared with me" — plans and grocery lists the signed-in user has
// previously opened via a share link (joined automatically on open,
// see useSharedPlanSync / useSharedGrocerySync in lib/sync.ts).

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import {
  useSharedWithMePlans,
  useSharedWithMeGroceryLists,
} from "@/lib/sync";

function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SharedWithMeScreen() {
  const colors = useColors();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { plans, status: plansStatus, reload: reloadPlans } = useSharedWithMePlans();
  const { lists, status: listsStatus, reload: reloadLists } = useSharedWithMeGroceryLists();

  const loading = plansStatus === "syncing" && listsStatus === "syncing" && plans.length === 0 && lists.length === 0;
  const refreshing = plansStatus === "syncing" || listsStatus === "syncing";
  const isEmpty = plans.length === 0 && lists.length === 0;

  const onRefresh = () => {
    reloadPlans();
    reloadLists();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 16, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        Platform.OS !== "web" ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.foreground }]}>Shared with me</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Plans and lists others have shared with you
        </Text>
      </View>

      {isEmpty && (
        <View style={styles.empty}>
          <Feather name="users" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Nothing shared with you yet.{"\n"}Open a share link someone sends you — it'll show up here.
          </Text>
        </View>
      )}

      {plans.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MEAL PLANS</Text>
          {plans.map((p) => (
            <SharedRow
              key={p.planId}
              icon="calendar"
              title={p.name || "Untitled meal plan"}
              permission={p.permission}
              joinedAt={p.joinedAt}
              colors={colors}
              onPress={() => router.push(`/plan/${p.shareToken}` as any)}
            />
          ))}
        </>
      )}

      {lists.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: plans.length > 0 ? 20 : 0 }]}>
            GROCERY LISTS
          </Text>
          {lists.map((l) => (
            <SharedRow
              key={l.listId}
              icon="shopping-cart"
              title={l.name || "Untitled grocery list"}
              permission={l.permission}
              joinedAt={l.joinedAt}
              colors={colors}
              onPress={() => router.push(`/grocery/${l.shareToken}` as any)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SharedRow({
  icon, title, permission, joinedAt, colors, onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  permission: "view" | "edit";
  joinedAt: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={18} color={colors.foreground} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
          Joined {formatJoinedAt(joinedAt)} · {permission === "edit" ? "Can edit" : "View only"}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { marginBottom: 24 },
  heading: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2, marginBottom: 10 },
  empty: { alignItems: "center", paddingVertical: 64, gap: 12, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTextWrap: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
