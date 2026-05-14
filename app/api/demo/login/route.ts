import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";

export async function POST(req: Request) {
  const demoUser = String(process.env.DEMO_USERNAME || "").trim();
  const demoPass = String(process.env.DEMO_PASSWORD || "").trim();
  const demoEmail = String(process.env.DEMO_EVALUATOR_EMAIL || "").trim();
  if (!demoUser || !demoPass || !demoEmail) {
    return NextResponse.json({ success: false, error: "Missing demo auth configuration" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!username || !password) return NextResponse.json({ success: false, error: "Missing credentials" }, { status: 400 });
  if (username !== demoUser || password !== demoPass) return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });

  const supabase = createRouteHandlerClient({ cookies });
  const { data, error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPass });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 401 });

  const u = data.user;
  if (u) {
    try {
      const admin = createAdminClient();
      await admin.from("profiles").upsert({ user_id: u.id, role: "admin", onboarding_completed: true }, { onConflict: "user_id" });
    } catch {}
  }

  return NextResponse.json({ success: true });
}

