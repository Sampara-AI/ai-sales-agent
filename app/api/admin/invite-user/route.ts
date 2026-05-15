import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!supabaseUrl || !serviceKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

    if (!demoMode) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      const currentUser = userData.user;
      if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

      const pr = await sessionClient.from("profiles").select("role").eq("user_id", currentUser.id).single();
      if ((pr.data as any)?.role !== "admin") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string; full_name?: string; company?: string; role?: "admin" | "user" };
    const email = String(body?.email || "").trim().toLowerCase();
    const full_name = String(body?.full_name || "").trim();
    const company = String(body?.company || "").trim();
    const role = (body?.role === "admin" ? "admin" : "user") as "admin" | "user";

    if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email)) return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });

    const admin = createClient(supabaseUrl, serviceKey);
    const inviteRes = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name, company } });
    if (inviteRes.error) return NextResponse.json({ success: false, error: inviteRes.error.message }, { status: 400 });

    const userId = inviteRes.data.user?.id;
    if (userId) {
      await admin
        .from("profiles")
        .upsert(
          {
            user_id: userId,
            email,
            full_name: full_name || null,
            company: company || null,
            role,
            subscription_status: "paid",
            onboarding_completed: true,
          },
          { onConflict: "user_id" },
        );
    }

    return NextResponse.json({ success: true, invited: true, user_id: userId || null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Invite failed" }, { status: 500 });
  }
}
