import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase().trim() === "true";
  const admin = createAdminClient();

  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
  const isInternal = demoMode || (!!internalSecret && internalHeader === internalSecret);

  try {
    let currentUserId: string | null = null;
    let isAdmin = false;
    if (!isInternal) {
      const sessionClient = createRouteHandlerClient({ cookies });
      const { data: userData } = await sessionClient.auth.getUser();
      const user = userData.user;
      if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      currentUserId = user.id;
      const pr = await sessionClient.from("profiles").select("role").eq("user_id", user.id).single();
      isAdmin = (pr.data as any)?.role === "admin";
    }

    const cRes = await admin.from("hunting_campaigns").select("id,created_by").eq("id", id).single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    if (!isInternal && !isAdmin && (cRes.data as any)?.created_by && (cRes.data as any).created_by !== currentUserId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const pRes = await admin
      .from("prospects")
      .select("id,created_at,name,title,company,email,domain,status,recent_activity,last_email_sent")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (pRes.error) return NextResponse.json({ success: false, error: pRes.error.message }, { status: 500 });

    return NextResponse.json({ success: true, campaign_id: id, prospects: pRes.data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Prospects lookup failed" }, { status: 500 });
  }
}

