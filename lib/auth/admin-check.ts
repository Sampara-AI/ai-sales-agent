import { SupabaseClient } from "@supabase/supabase-js";

export async function isAdminUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const pr = await supabase.from("profiles").select("role").eq("user_id", userId).single();
  return ((pr.data as any)?.role === "admin");
}