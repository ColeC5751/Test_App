// app/settings.tsx
// Reached via the gear icon on the "Shared with me" tab. Not a bottom tab
// itself — pushed as a standalone screen so it stays out of the main nav.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";

// ─── Confirm Modal ────────────────────────────────────────────────────────────
// Same styled pattern used in grocery.tsx / plan.tsx — a real React Native
// <Modal> rather than Alert.alert/window.confirm, since Alert.alert with
// multiple buttons is unreliable on React Native Web (it can silently fail
// to present at all). Resolves via onConfirm/onCancel callbacks rather than
// a promise here since this screen only has one confirmation flow.

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

// ─── Settings Screen ──────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Opens the styled confirm modal instead of calling Alert.alert directly —
  // see ConfirmModal notes above for why.
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

      // Clear locally cached rows/ids so that if a different user signs in
      // on this same device afterward, they don't inherit the previous
      // user's synced grocery/plan/recipe state. Supabase's own session
      // token is already cleared by signOut() above; these are just the
      // app's own AsyncStorage caches from lib/sync.ts.
      await AsyncStorage.multiRemove([
        "@recipe_roulette_grocery",
        "@recipe_roulette_grocery_row_id",
        "@recipe_roulette_plan",
        "@recipe_roulette_plan_row_id",
        "@recipe_roulette_personal",
      ]);

      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Adjust this to whatever your actual sign-in/auth route is.
      router.replace("/login");
    } catch (error: any) {
      console.error("SIGN OUT ERROR:", error);
      Alert.alert("Couldn't sign out", error?.message ?? "Unexpected error while signing out");
      setSigningOut(false);
    }
  };

  return (
    <>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 32, paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.heading, { color: colors.foreground }]}>Settings</Text>
          {/* Spacer to keep the title visually centered against the back chevron */}
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.section}>
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
            <Text style={[styles.signOutText, { color: colors.destructive }]}>
              {signingOut ? "Signing out…" : "Sign Out"}
            </Text>
          </Pressable>
        </View>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  heading: { fontSize: 18, fontFamily: "Inter_700Bold" },
  section: { gap: 10 },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 15,
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
