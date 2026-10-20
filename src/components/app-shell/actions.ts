"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Signs out this browser only (scope local), so one reviewer never logs out another (SPEC §12). */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("signOut failed", error.status, error.code);
  redirect("/login");
}
