import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// ─── Supabase client ──────────────────────────────────────────────────────────

const SUPABASE_URL = "https://zvdnibunhjqhxnmdfaea.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QF_4FSZ8SgsXbSs8rlumZw_CGC3KB7M";

// Use AsyncStorage for session persistence on native, localStorage on web
const supabaseStorage =
  Platform.OS === "web"
    ? undefined // supabase uses localStorage by default on web
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
    detectSessionInUrl: false,
  },
});

// ─── Device ID ────────────────────────────────────────────────────────────────
// A stable anonymous identifier for this device. Used to identify ownership
// of grocery lists, recipes, and meal plans without requiring an account.
// Persisted in AsyncStorage so it survives app restarts but not reinstalls.

const DEVICE_ID_KEY = "@recipe_roulette_device_id";

function generateDeviceId(): string {
  return "device_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

let _deviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      _deviceId = stored;
      return stored;
    }
    const newId = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    _deviceId = newId;
    return newId;
  } catch {
    // Fallback to a session-only ID if storage fails
    _deviceId = generateDeviceId();
    return _deviceId;
  }
}

// ─── Share token helpers ──────────────────────────────────────────────────────

export function buildShareUrl(type: "grocery" | "plan", token: string): string {
  // Deep link format — update this once you have a custom domain
  const base = "https://thatsdinner.app";
  return `${base}/${type}/${token}`;
}

export function extractTokenFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}
