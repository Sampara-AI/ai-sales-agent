import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";

type QueueJob = {
  id: string;
  created_at: string;
  updated_at: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
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

    const pRes = await admin.from("prospects").select("id").eq("campaign_id", id).limit(2000);
    const prospectIds = ((pRes.data || []) as Array<{ id: string }>).map((x) => x.id).filter(Boolean);
    if (prospectIds.length === 0) {
      return NextResponse.json({ success: true, campaign_id: id, counts: { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 }, jobs: [] });
    }

    const jobsRes = await admin
      .from("job_queue")
      .select("id,created_at,updated_at,type,status,priority,attempts,max_attempts,run_after,locked_by,locked_until,last_error,payload")
      .in("payload->>prospect_id", prospectIds)
      .order("updated_at", { ascending: false })
      .limit(200);

    const jobs = (jobsRes.data || []) as QueueJob[];
    const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
    for (const j of jobs) {
      const s = String(j.status || "");
      if (s === "queued") counts.queued += 1;
      else if (s === "running") counts.running += 1;
      else if (s === "succeeded") counts.succeeded += 1;
      else if (s === "failed") counts.failed += 1;
      else if (s === "dead") counts.dead += 1;
    }

    return NextResponse.json({ success: true, campaign_id: id, counts, jobs });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Queue lookup failed" }, { status: 500 });
  }
}
