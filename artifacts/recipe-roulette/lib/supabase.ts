import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ─── Supabase client ──────────────────────────────────────────────────────────

const SUPABASE_URL = "https://zvdnibunhjqhxnmdfaea.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QF_4FSZ8SgsXbSs8rlumZw_CGC3KB7M";

const supabaseStorage =
  Platform.OS === "web"
    ? undefined
    : {
        getItem: (key: string) => AsyncStorage.getItem(key),
        setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
        removeItem: (key: string) => AsyncStorage.removeItem(key),
      };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: supabaseStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // needed for magic link callback on web
    flowType: "pkce",         // PKCE is more secure and works with magic links
  },
});

// ─── Share URL helpers ────────────────────────────────────────────────────────

export function buildShareUrl(type: "grocery" | "plan", token: string): string {
  return `https://whats-for-dinner-two-tan.vercel.app/${type}/${token}`;
}

export function extractTokenFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}
