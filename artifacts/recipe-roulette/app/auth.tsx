// app/auth.tsx
// OTP sign-in screen. No passwords — user enters email, receives a
// 6-digit code, enters it here, session is established automatically.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
ActivityIndicator,
KeyboardAvoidingView,
NativeSyntheticEvent,
Platform,
Pressable,
StyleSheet,
Text,
TextInput,
TextInputKeyPressEventData,
View,
} from "react-native";

import { supabase } from "@/lib/supabase";
import { useColors } from "@/hooks/useColors";

const CODE_LENGTH = 6;

export default function AuthScreen() {
const colors = useColors();
const router = useRouter();

// Step control: "email" -> "code"
const [step, setStep] = useState<"email" | "code">("email");

const [email, setEmail] = useState("");
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");

const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
const [verifying, setVerifying] = useState(false);
const inputRefs = useRef<Array<TextInput | null>>([]);

const code = digits.join("");

const handleSendCode = async () => {
if (!email.trim()) return;
setLoading(true);
setError("");
try {
const { error: authError } = await supabase.auth.signInWithOtp({
email: email.trim().toLowerCase(),
options: {
shouldCreateUser: true,
},
});
if (authError) throw authError;
setDigits(Array(CODE_LENGTH).fill(""));
setStep("code");
// Focus the first box once the code screen mounts.
setTimeout(() => inputRefs.current[0]?.focus(), 50);
} catch (err: any) {
setError(err.message ?? "Something went wrong. Please try again.");
} finally {
setLoading(false);
}
};

const handleVerifyCode = async (fullCode: string) => {
if (fullCode.length !== CODE_LENGTH) return;
setVerifying(true);
setError("");
try {
const { error: verifyError } = await supabase.auth.verifyOtp({
email: email.trim().toLowerCase(),
token: fullCode,
type: "email",
});
if (verifyError) throw verifyError;
// Success: onAuthStateChange in app/_layout.tsx picks up the new
// session and redirects to /(tabs) automatically.
} catch (err: any) {
setError("Incorrect code, please try again");
setDigits(Array(CODE_LENGTH).fill(""));
inputRefs.current[0]?.focus();
} finally {
setVerifying(false);
}
};

const handleDigitChange = (value: string, index: number) => {
// Only allow single numeric characters; ignore anything else.
const cleaned = value.replace(/[^0-9]/g, "");

if (cleaned.length > 1) {
// Handles paste of the full code into one box.
const pasted = cleaned.slice(0, CODE_LENGTH).split("");
const next = Array(CODE_LENGTH).fill("");
pasted.forEach((d, i) => { next[i] = d; });
setDigits(next);
if (pasted.length === CODE_LENGTH) {
inputRefs.current[CODE_LENGTH - 1]?.blur();
handleVerifyCode(next.join(""));
} else {
inputRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
}
return;
}

const next = [...digits];
next[index] = cleaned;
setDigits(next);
setError("");

if (cleaned && index < CODE_LENGTH - 1) {
inputRefs.current[index + 1]?.focus();
}

const joined = next.join("");
if (joined.length === CODE_LENGTH) {
inputRefs.current[index]?.blur();
handleVerifyCode(joined);
}
};

const handleKeyPress = (
e: NativeSyntheticEvent<TextInputKeyPressEventData>,
index: number
) => {
if (e.nativeEvent.key === "Backspace" && !digits[index] && index > 0) {
inputRefs.current[index - 1]?.focus();
const next = [...digits];
next[index - 1] = "";
setDigits(next);
}
};

const handleResend = () => {
setStep("email");
setDigits(Array(CODE_LENGTH).fill(""));
setError("");
};

const handleSkip = () => {
router.replace("/(tabs)");
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

{step === "email" ? (
/* Step 1 — email input */
<View style={styles.form}>
<Text style={[styles.label, { color: colors.mutedForeground }]}>EMAIL</Text>
<TextInput
style={[
styles.input,
{ backgroundColor: colors.card, borderColor: error ? colors.destructive : colors.border, color: colors.foreground },
]}
value={email}
onChangeText={(v) => { setEmail(v); setError(""); }}
placeholder="you@example.com"
placeholderTextColor={colors.mutedForeground}
keyboardType="email-address"
autoCapitalize="none"
autoCorrect={false}
autoComplete="email"
onSubmitEditing={handleSendCode}
returnKeyType="send"
/>
{error ? (
<Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
) : null}

<Pressable
onPress={handleSendCode}
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
Send Code
</Text>
}
</Pressable>

<Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
No password needed. We'll email you a 6-digit code.
</Text>
</View>
) : (
/* Step 2 — code entry */
<View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
<Feather name="mail" size={32} color={colors.primary} />
<Text style={[styles.sentTitle, { color: colors.foreground }]}>Enter your code</Text>
<Text style={[styles.sentBody, { color: colors.mutedForeground }]}>
We sent a 6-digit code to{"\n"}
<Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{email.trim()}</Text>
</Text>

<View style={styles.codeRow}>
{digits.map((d, i) => (
<TextInput
key={i}
ref={(r) => { inputRefs.current[i] = r; }}
style={[
styles.codeBox,
{
backgroundColor: colors.background,
borderColor: error ? colors.destructive : (d ? colors.primary : colors.border),
color: colors.foreground,
},
]}
value={d}
onChangeText={(v) => handleDigitChange(v, i)}
onKeyPress={(e) => handleKeyPress(e, i)}
keyboardType="number-pad"
maxLength={i === 0 ? CODE_LENGTH : 1}
textAlign="center"
autoFocus={i === 0}
editable={!verifying}
selectTextOnFocus
/>
))}
</View>

{error ? (
<Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
) : null}

<Pressable
onPress={() => handleVerifyCode(code)}
disabled={verifying || code.length !== CODE_LENGTH}
style={({ pressed }) => [
styles.sendBtn,
{ backgroundColor: code.length !== CODE_LENGTH ? colors.muted : colors.primary, width: "100%" },
pressed && code.length === CODE_LENGTH && { opacity: 0.9 },
]}
>
{verifying
? <ActivityIndicator color={colors.primaryForeground} />
: <Text style={[styles.sendBtnText, { color: code.length !== CODE_LENGTH ? colors.mutedForeground : colors.primaryForeground }]}>
Verify Code
</Text>
}
</Pressable>

<Pressable onPress={handleResend} style={styles.resendBtn}>
<Text style={[styles.resendText, { color: colors.primary }]}>Resend code</Text>
</Pressable>
</View>
)}

{/* Skip / continue without account */}
<Pressable onPress={handleSkip} style={styles.skipBtn}>
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
errorText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
sendBtn: {
borderRadius: 12, paddingVertical: 16,
alignItems: "center", justifyContent: "center",
marginTop: 4,
},
sendBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
disclaimer: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
codeCard: {
borderRadius: 16, borderWidth: 1,
padding: 24, alignItems: "center", gap: 14,
},
sentTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
sentBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
codeRow: {
flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4, marginBottom: 4,
},
codeBox: {
width: 44, height: 54,
borderRadius: 10, borderWidth: 1.5,
fontSize: 22, fontFamily: "Inter_600SemiBold",
},
resendBtn: { marginTop: 2 },
resendText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
skipBtn: { alignItems: "center", paddingVertical: 8 },
skipText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
