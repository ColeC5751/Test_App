// // app/(tabs)/shared.tsx
// "Shared with me" — plans and grocery lists the signed-in user has
// previously opened via a share link (joined automatically on open,
// see useSharedPlanSync / useSharedGrocerySync in lib/sync.ts).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import {
  useSharedWithMePlans,
  useSharedWithMeGroceryLists,
} from "@/lib/sync";

// Vibrant per-type tint for the row icon. Card/background colors stay
// on the theme (colors.card / colors.secondary) — only the glyph itself
// picks up color here.
const ICON_TINTS = {
  calendar: "#FF9F4A", // meal plans — warm orange
  "shopping-cart": "#22C55E", // grocery lists — green
} as const;

// ─── Confirm Modal ────────────────────────────────────────────────────────────
// Same styled pattern used in grocery.tsx / plan.tsx — a real React Native
// <Modal> rather than Alert.alert/window.confirm, since Alert.alert with
// multiple buttons is unreliable on React Native Web (it can silently fail
// to present at all).

function ConfirmModal({
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

  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Opens the styled confirm modal instead of calling Alert.alert directly —
  // Alert.alert with multiple buttons is unreliable on React Native Web.
  const handleSignOut = () => setShowSignOutModal(true);

  // Fires once the person taps "Sign Out" in ConfirmModal.
  const confirmSignOut = async () => {
    setShowSignOutModal(false);
    setSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        Alert.alert("Couldn't sign out", error.message);
        setSigningOut(false);
        return;
      }

      // Clear locally cached rows/ids so a different user signing in on
      // this device afterward doesn't inherit the previous user's synced
      // grocery/plan/recipe state. Supabase's own session token is already
      // cleared by signOut() above; these are just the app's own
      // AsyncStorage caches from lib/sync.ts.
      await AsyncStorage.multiRemove([
        "@recipe_roulette_grocery",
        "@recipe_roulette_grocery_row_id",
        "@recipe_roulette_plan",
        "@recipe_roulette_plan_row_id",
        "@recipe_roulette_personal",
      ]);

      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/auth");
    } catch (error: any) {
      console.error("SIGN OUT ERROR:", error);
      Alert.alert("Couldn't sign out", error?.message ?? "Unexpected error while signing out");
      setSigningOut(false);
    }
  };

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
    <>
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
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heading, { color: colors.foreground }]}>Shared with me</Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                Plans and lists others have shared with you
              </Text>
            </View>
            <Pressable
              onPress={handleSignOut}
              disabled={signingOut}
              style={({ pressed }) => [
                styles.signOutBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
                (pressed || signingOut) && { opacity: 0.7 },
              ]}
            >
              <Feather name="log-out" size={16} color={colors.destructive} />
            </Pressable>
          </View>
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

      <ConfirmModal
        visible={showSignOutModal}
        title="Sign out?"
        message="You'll need to sign back in to access your recipes, meal plan, and grocery list."
        confirmLabel="Sign Out"
        icon="log-out"
        onConfirm={confirmSignOut}
        onCancel={() => setShowSignOutModal(false)}
      />
    </>
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
  const tint = ICON_TINTS[icon as keyof typeof ICON_TINTS] ?? colors.foreground;

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
        <Feather name={icon} size={18} color={tint} />
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
  headerTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  signOutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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
