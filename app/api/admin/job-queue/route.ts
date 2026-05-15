import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { isAdminUser } from "@/lib/auth/admin-check";

export async function GET() {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    const user = userData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await isAdminUser(sessionClient as any, user.id);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [queued, running, succeeded, dead] = await Promise.all([
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "queued"),
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "succeeded"),
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "dead"),
  ]);

  const deadJobs = await admin
    .from("job_queue")
    .select("id,type,status,attempts,max_attempts,run_after,locked_by,locked_until,last_error,updated_at,created_at")
    .eq("status", "dead")
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    counts: { queued: queued.count || 0, running: running.count || 0, succeeded: succeeded.count || 0, dead: dead.count || 0 },
    dead_jobs: deadJobs.data || [],
  });
}

export async function POST(req: NextRequest) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    const user = userData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await isAdminUser(sessionClient as any, user.id);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String((body as any)?.action || "").trim();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  if (action === "retry_dead") {
    const ids = Array.isArray((body as any)?.ids) ? ((body as any).ids as any[]).map((x) => String(x)).filter(Boolean) : [];
    if (ids.length === 0) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
    const upd = await admin
      .from("job_queue")
      .update({ status: "queued", run_after: nowIso, locked_at: null, locked_by: null, locked_until: null, updated_at: nowIso })
      .in("id", ids)
      .eq("status", "dead");
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    return NextResponse.json({ success: true, retried: ids.length });
  }

  if (action === "retry_all_dead") {
    const upd = await admin
      .from("job_queue")
      .update({ status: "queued", run_after: nowIso, locked_at: null, locked_by: null, locked_until: null, updated_at: nowIso })
      .eq("status", "dead");
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
