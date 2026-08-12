import "react-native-url-polyfill/auto";

import asyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

import "expo-sqlite/localStorage/install";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: asyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
