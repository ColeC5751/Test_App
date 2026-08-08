// // app/(tabs)/shared.tsx
// "Shared with me" — plans and grocery lists the signed-in user has
// previously opened via a share link (joined automatically on open,
// see useSharedPlanSync / useSharedGrocerySync in lib/sync.ts).
//
// Locked behind a real Supabase session via useRequireSession — this
// feature isn't available in "continue without account" mode, even though
// the rest of the app is. Skip-auth users tapping this tab get redirected
// to /auth with a contextual "Sign in to view shared plans" banner (see
// REASON_MESSAGES in app/auth.tsx, keyed by the "shared" reason below).

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
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useRequireSession } from "@/hooks/useRequireSession";
import { supabase } from "@/lib/supabase";
import { deleteAccount } from "@/lib/account";
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
  busy,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  icon: keyof typeof Feather.glyphMap;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
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
              disabled={busy}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                (pressed || busy) && { opacity: 0.7 },
              ]}
            >
              <Text style={[confirmStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: colors.destructive },
                (pressed || busy) && { opacity: 0.85 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[confirmStyles.btnText, { color: "#fff" }]}>{confirmLabel}</Text>
              )}
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

// ─── Delete Account Modal ───────────────────────────────────────────────────
// Deliberately a separate, stricter component from ConfirmModal above,
// rather than reusing it with a scarier icon. Account deletion is
// permanent and irreversible in a way sign-out and "remove shared item"
// aren't — this requires typing DELETE before the button even becomes
// pressable, so it can't be dismissed with a single reflexive tap the way
// a two-button Alert can. Calls the delete-account Edge Function via
// lib/account.ts; the actual data/auth deletion happens server-side (see
// that function for why it can't happen in the client).

const DELETE_CONFIRM_PHRASE = "DELETE";

function DeleteAccountModal({
  visible,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const colors = useColors();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canConfirm = confirmText.trim().toUpperCase() === DELETE_CONFIRM_PHRASE && !deleting;

  const handleClose = () => {
    if (deleting) return; // don't allow dismissing mid-request
    setConfirmText("");
    setErrorMessage(null);
    onClose();
  };

  const handleDelete = async () => {
    if (!canConfirm) return;
    setDeleting(true);
    setErrorMessage(null);

    const result = await deleteAccount();

    if (!result.success) {
      setDeleting(false);
      setErrorMessage(result.message);
      return;
    }

    Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfirmText("");
    setDeleting(false);
    onDeleted();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={confirmStyles.overlay}>
        <View style={[confirmStyles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[confirmStyles.iconWrap, { backgroundColor: colors.secondary }]}>
            <Feather name="alert-triangle" size={20} color={colors.destructive} />
          </View>

          <Text style={[confirmStyles.title, { color: colors.foreground }]}>Delete your account?</Text>
          <Text style={[confirmStyles.message, { color: colors.mutedForeground }]}>
            This permanently deletes your account, recipes, meal plans, and grocery lists. Shared plans/lists you
            created will no longer be accessible to anyone you shared them with. This cannot be undone.
          </Text>

          <Text style={[deleteStyles.inputLabel, { color: colors.mutedForeground }]}>
            Type DELETE to confirm
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deleting}
            placeholder="DELETE"
            placeholderTextColor={colors.mutedForeground}
            style={[
              deleteStyles.input,
              { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground },
            ]}
          />

          {errorMessage && (
            <Text style={[deleteStyles.errorText, { color: colors.destructive }]}>{errorMessage}</Text>
          )}

          <View style={confirmStyles.actions}>
            <Pressable
              onPress={handleClose}
              disabled={deleting}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                (pressed || deleting) && { opacity: 0.7 },
              ]}
            >
              <Text style={[confirmStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              disabled={!canConfirm}
              style={({ pressed }) => [
                confirmStyles.btn,
                { backgroundColor: colors.destructive },
                (!canConfirm || pressed) && { opacity: canConfirm ? 0.85 : 0.4 },
              ]}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[confirmStyles.btnText, { color: "#fff" }]}>Delete Account</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const deleteStyles = StyleSheet.create({
  inputLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, alignSelf: "flex-start", marginTop: 4 },
  input: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
    marginBottom: 8,
    textAlign: "center",
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 8 },
});

function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// What's pending removal — drives the second confirm modal below.
type PendingRemoval = {
  kind: "plan" | "grocery";
  id: string;
  title: string;
} | null;

export default function SharedWithMeScreen() {
  const colors = useColors();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : 0;

  const { loading: sessionLoading, locked } = useRequireSession("shared");

  const { plans, status: plansStatus, reload: reloadPlans } = useSharedWithMePlans();
  const { lists, status: listsStatus, reload: reloadLists } = useSharedWithMeGroceryLists();

  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
  const [removing, setRemoving] = useState(false);

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

  // Tapping the trash icon on a row opens the confirm modal rather than
  // removing immediately — same reasoning as sign out above.
  const handleRequestRemove = (kind: "plan" | "grocery", id: string, title: string) => {
    setPendingRemoval({ kind, id, title });
  };

  // Fires once DeleteAccountModal's Edge Function call succeeds. Mirrors
  // confirmSignOut's local-cache cleanup below (same AsyncStorage keys),
  // since the account no longer exists to sync back to on next launch —
  // there's nothing to "resume" into. Routes to /auth same as sign-out,
  // with a plain Alert confirming what happened since there's no screen
  // left to show a toast on (the account itself is gone).
  const handleAccountDeleted = async () => {
    setShowDeleteAccountModal(false);

    await AsyncStorage.multiRemove([
      "@recipe_roulette_grocery",
      "@recipe_roulette_grocery_row_id",
      "@recipe_roulette_plan",
      "@recipe_roulette_plan_row_id",
      "@recipe_roulette_personal",
    ]);

    router.replace("/auth");
    // Slight delay so the alert appears after navigation settles rather
    // than racing the route transition.
    setTimeout(() => {
      Alert.alert("Account deleted", "Your account and all associated data have been permanently removed.");
    }, 400);
  };

  // Fires once the person taps "Remove" in the confirm modal. This removes
  // *this user's* membership on the shared plan/list — it does not delete
  // the underlying plan/list for the person who shared it.
  //
  // NOTE: adjust the table/column names below (`plan_members` /
  // `grocery_list_members`, `plan_id` / `list_id`, `user_id`) to match
  // whatever join table useSharedPlanSync / useSharedGrocerySync actually
  // write to in lib/sync.ts — this mirrors the shape those hooks imply but
  // wasn't visible in this file.
  const confirmRemove = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert("Couldn't remove", "You need to be signed in to do that.");
        setRemoving(false);
        return;
      }

      const table = pendingRemoval.kind === "plan" ? "plan_members" : "grocery_list_members";
      const idColumn = pendingRemoval.kind === "plan" ? "plan_id" : "list_id";

      const { error } = await supabase
        .from(table)
        .delete()
        .eq(idColumn, pendingRemoval.id)
        .eq("user_id", user.id);

      if (error) {
        Alert.alert("Couldn't remove", error.message);
        setRemoving(false);
        return;
      }

      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingRemoval(null);
      setRemoving(false);
      reloadPlans();
      reloadLists();
    } catch (error: any) {
      console.error("REMOVE SHARED ITEM ERROR:", error);
      Alert.alert("Couldn't remove", error?.message ?? "Unexpected error while removing");
      setRemoving(false);
    }
  };

  // Session check hasn't resolved yet, or it resolved to "no session" and
  // useRequireSession is already redirecting to /auth — render nothing in
  // both cases rather than flashing shared content that isn't accessible
  // in skip-auth mode.
  if (sessionLoading || locked) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

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
                onDelete={() => handleRequestRemove("plan", p.planId, p.name || "Untitled meal plan")}
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
                onDelete={() => handleRequestRemove("grocery", l.listId, l.name || "Untitled grocery list")}
              />
            ))}
          </>
        )}

        {/* Account management — placed at the bottom of the screen so it's
            always reachable regardless of whether the person has any
            shared plans/lists, but visually secondary to the actual
            content above. Discoverability matters here (App Store review
            checks that account deletion isn't buried), but it shouldn't
            compete with the screen's primary purpose for attention. */}
        <View style={[styles.accountSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
          <Pressable
            onPress={() => setShowDeleteAccountModal(true)}
            style={({ pressed }) => [styles.deleteAccountLink, pressed && { opacity: 0.7 }]}
          >
            <Feather name="trash-2" size={14} color={colors.destructive} />
            <Text style={[styles.deleteAccountText, { color: colors.destructive }]}>Delete Account</Text>
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

      <ConfirmModal
        visible={!!pendingRemoval}
        title="Remove this item?"
        message={
          pendingRemoval
            ? `"${pendingRemoval.title}" will be removed from your Shared with me list. Whoever shared it will keep their copy.`
            : ""
        }
        confirmLabel="Remove"
        icon="trash-2"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemoval(null)}
        busy={removing}
      />

      <DeleteAccountModal
        visible={showDeleteAccountModal}
        onClose={() => setShowDeleteAccountModal(false)}
        onDeleted={handleAccountDeleted}
      />
    </>
  );
}

function SharedRow({
  icon, title, permission, joinedAt, colors, onPress, onDelete,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  permission: "view" | "edit";
  joinedAt: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  onDelete: () => void;
}) {
  const tint = ICON_TINTS[icon as keyof typeof ICON_TINTS] ?? colors.foreground;

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.85 }]}>
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

      <Pressable
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => [
          styles.deleteBtn,
          { borderColor: colors.border },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Feather name="trash-2" size={16} color={colors.destructive} />
      </Pressable>
    </View>
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
  accountSection: { marginTop: 32, paddingTop: 20, borderTopWidth: 1 },
  deleteAccountLink: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  deleteAccountText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingVertical: 64, gap: 12, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    paddingRight: 8,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTextWrap: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
