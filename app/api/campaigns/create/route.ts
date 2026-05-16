import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
    const demoUserId = "00000000-0000-0000-0000-000000000001";
    let userId = body?.created_by || null;
    if (!demoMode) {
      const supabase = createRouteHandlerClient({ cookies });
      const { data: session } = await supabase.auth.getSession();
      userId = session?.session?.user?.id || null;
      if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (demoMode && !userId) userId = demoUserId;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
    if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

    const admin = createClient(supabaseUrl, serviceKey);
    const status = body?.status as "draft" | "active" | "scheduled";
    const schedule_start = status === "scheduled" ? (body?.schedule_start || null) : null;
    const payload: Record<string, any> = {
      name: body?.name || null,
      description: body?.description || "",
      titles: body?.titles || [],
      industries: body?.industries || [],
      locations: body?.locations || [],
      size_min: body?.size_min ?? null,
      size_max: body?.size_max ?? null,
      keywords: body?.keywords || [],
      exclude_companies: body?.exclude_companies || [],
      daily_prospect_limit: body?.daily_prospect_limit ?? 20,
      min_ai_score: body?.min_ai_score ?? 70,
      email_daily_limit: body?.email_daily_limit ?? 10,
      send_weekends: !!body?.send_weekends,
      followup_days: Array.isArray(body?.followup_days) ? body.followup_days : [3, 7, 14],
      max_followups: body?.max_followups ?? 3,
      require_manual_review: !!body?.require_manual_review,
      status,
      schedule_start,
      created_by: userId,
    };

    let attempt = { ...payload };
    let lastErr: any = null;
    for (let i = 0; i < 12; i++) {
      const res = await admin.from("hunting_campaigns").insert(attempt).select("id").single();
      if (!res.error) return NextResponse.json({ id: res.data?.id }, { status: 200 });
      lastErr = res.error;
      const msg = String(res.error.message || "");
      const m =
        msg.match(/Could not find the '([^']+)' column of 'hunting_campaigns'/) ||
        msg.match(/column \"([^\"]+)\" of relation \"hunting_campaigns\" does not exist/i) ||
        msg.match(/column \"([^\"]+)\" does not exist/i);
      const missing = m?.[1];
      if (missing && Object.prototype.hasOwnProperty.call(attempt, missing)) {
        delete (attempt as any)[missing];
        continue;
      }
      break;
    }
    const res = { error: lastErr };
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 });
    return NextResponse.json({ error: "Insert failed" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
