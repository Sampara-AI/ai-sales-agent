import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id || null;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
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

    const res = await admin.from("hunting_campaigns").insert(payload).select("id").single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 });
    return NextResponse.json({ id: res.data?.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
