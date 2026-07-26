// app/auth.tsx
// Magic link sign-in screen. No passwords — user enters email,
// receives a link, taps it, session is established automatically.

import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";
import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSendLink = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: "https://whats-for-dinner-two-tan.vercel.app/auth/callback",
        },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        {/* Logo / branding */}
        <View style={styles.brandRow}>
          <Text style={styles.brandEmoji}>🍽️</Text>
          <Text style={[styles.brandName, { color: colors.foreground }]}>That's Dinner</Text>
        </View>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Plan meals, spin for ideas, shop together
        </Text>

        {sent ? (
          /* Confirmation state */
          <View style={[styles.sentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="mail" size={32} color={colors.primary} />
            <Text style={[styles.sentTitle, { color: colors.foreground }]}>Check your email</Text>
            <Text style={[styles.sentBody, { color: colors.mutedForeground }]}>
              We sent a sign-in link to{"\n"}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{email.trim()}</Text>
            </Text>
            <Text style={[styles.sentHint, { color: colors.mutedForeground }]}>
              Tap the link in the email to sign in. You can close this screen.
            </Text>
            <Pressable onPress={() => { setSent(false); setEmail(""); }} style={styles.resendBtn}>
              <Text style={[styles.resendText, { color: colors.primary }]}>Use a different email</Text>
            </Pressable>
          </View>
        ) : (
          /* Sign-in form */
          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>EMAIL</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: error ? colors.destructive : colors.border, color: colors.foreground }]}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(""); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              onSubmitEditing={handleSendLink}
              returnKeyType="send"
            />
            {error ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            ) : null}

            <Pressable
              onPress={handleSendLink}
              disabled={loading || !email.trim()}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: !email.trim() ? colors.muted : colors.primary },
                pressed && email.trim() && { opacity: 0.9 },
              ]}
            >
              {loading
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Text style={[styles.sendBtnText, { color: !email.trim() ? colors.mutedForeground : colors.primaryForeground }]}>
                    Send Magic Link
                  </Text>
              }
            </Pressable>

            <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
              No password needed. We'll email you a secure sign-in link.
            </Text>
          </View>
        )}

        {/* Skip / continue without account */}
        <Pressable
          onPress={() => {
            // Navigating to tabs without a session — local-only mode.
            // The router redirect in _layout.tsx will handle this.
          }}
          style={styles.skipBtn}
        >
          <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
            Continue without an account →
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "center" },
  brandEmoji: { fontSize: 40 },
  brandName: { fontSize: 32, fontFamily: "Inter_700Bold" },
  tagline: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  form: { gap: 10 },
  label: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 2 },
  input: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, fontFamily: "Inter_400Regular",
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sendBtn: {
    borderRadius: 12, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
    marginTop: 4,
  },
  sendBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  disclaimer: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  sentCard: {
    borderRadius: 16, borderWidth: 1,
    padding: 24, alignItems: "center", gap: 12,
  },
  sentTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sentBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  sentHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  resendBtn: { marginTop: 4 },
  resendText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
