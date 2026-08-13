import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function isRealConfigValue(value: string | undefined) {
  return Boolean(value && !value.includes("YOUR_PROJECT") && !value.includes("YOUR_PUBLISHABLE_KEY"));
}

export const isSupabaseConfigured = isRealConfigValue(supabaseUrl) && isRealConfigValue(supabasePublishableKey);

export function getSupabase() {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) return null;
  if (!client) client = createClient(supabaseUrl, supabasePublishableKey);
  return client;
}

/** @deprecated Use isSupabaseConfigured for online-mode checks. */
export const cloudEnabled = isSupabaseConfigured;
