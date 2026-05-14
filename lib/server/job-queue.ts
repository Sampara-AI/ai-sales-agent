import { createAdminClient } from "@/lib/server/supabase-admin";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export type JobType = "send_email" | "domain_enrich" | "generate_outreach" | "send_followup" | "gmail_sync";

export type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  locked_until?: string | null;
  last_error: string | null;
  payload: any;
};

export async function enqueueJob(type: JobType, payload: Record<string, any>, opts?: { priority?: number; runAfter?: Date; maxAttempts?: number }) {
  const admin = createAdminClient();
  const priority = typeof opts?.priority === "number" ? opts.priority : 100;
  const runAfter = (opts?.runAfter || new Date()).toISOString();
  const maxAttempts = typeof opts?.maxAttempts === "number" ? opts.maxAttempts : 5;
  const res = await admin.from("job_queue").insert({ type, payload, priority, run_after: runAfter, max_attempts: maxAttempts }).select("id").single();
  if (res.error) throw new Error(res.error.message);
  return res.data?.id as string;
}

export async function enqueueJobs(
  items: Array<{ type: JobType; payload: Record<string, any>; priority?: number; runAfter?: Date; maxAttempts?: number }>
) {
  if (items.length === 0) return { inserted: 0 };
  const admin = createAdminClient();
  const rows = items.map((it) => ({
    type: it.type,
    payload: it.payload,
    priority: typeof it.priority === "number" ? it.priority : 100,
    run_after: (it.runAfter || new Date()).toISOString(),
    max_attempts: typeof it.maxAttempts === "number" ? it.maxAttempts : 5,
  }));
  const res = await admin.from("job_queue").insert(rows);
  if (res.error) throw new Error(res.error.message);
  return { inserted: rows.length };
}

export async function claimJobs(lockId: string, limit: number) {
  const admin = createAdminClient();
  const safeLimit = Math.max(1, Math.min(50, limit));
  const claimed = await admin
    .rpc("claim_job_queue", { lock_id: lockId, max_jobs: safeLimit, lock_seconds: 600 })
    .select("id,type,status,priority,attempts,max_attempts,run_after,locked_at,locked_by,locked_until,last_error,payload");

  if (!claimed.error) return ((claimed.data || []) as JobRow[]);

  const nowIso = new Date().toISOString();
  const q = await admin
    .from("job_queue")
    .select("id,type,status,priority,attempts,max_attempts,run_after,locked_at,locked_by,locked_until,last_error,payload")
    .eq("status", "queued")
    .lte("run_after", nowIso)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(safeLimit);
  if (q.error) throw new Error(q.error.message);
  const jobs = (q.data || []) as JobRow[];
  if (jobs.length === 0) return [];

  const ids = jobs.map((j) => j.id);
  const upd = await admin
    .from("job_queue")
    .update({ status: "running", locked_at: nowIso, locked_by: lockId, locked_until: new Date(Date.now() + 600_000).toISOString(), updated_at: nowIso })
    .in("id", ids)
    .eq("status", "queued");
  if (upd.error) throw new Error(upd.error.message);

  return jobs;
}

function backoffMs(attempts: number) {
  const base = 15_000;
  const max = 15 * 60_000;
  const ms = Math.min(max, base * Math.pow(2, Math.max(0, attempts - 1)));
  const jitter = Math.floor(Math.random() * 2000);
  return ms + jitter;
}

export async function markJobSuccess(jobId: string, meta?: Record<string, any>) {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const upd = await admin
    .from("job_queue")
    .update({ status: "succeeded", updated_at: nowIso, last_error: null, locked_at: null, locked_by: null, locked_until: null })
    .eq("id", jobId);
  if (upd.error) throw new Error(upd.error.message);
}

export async function markJobFailure(job: JobRow, error: string) {
  const admin = createAdminClient();
  const attempts = Number(job.attempts || 0) + 1;
  const nowIso = new Date().toISOString();
  if (attempts >= Number(job.max_attempts || 5)) {
    const upd = await admin
      .from("job_queue")
      .update({ status: "dead", attempts, last_error: error, locked_at: null, locked_by: null, locked_until: null, updated_at: nowIso })
      .eq("id", job.id);
    if (upd.error) throw new Error(upd.error.message);
    return { status: "dead" as const, attempts };
  }

  const runAfter = new Date(Date.now() + backoffMs(attempts)).toISOString();
  const upd = await admin
    .from("job_queue")
    .update({ status: "queued", attempts, last_error: error, run_after: runAfter, locked_at: null, locked_by: null, locked_until: null, updated_at: nowIso })
    .eq("id", job.id);
  if (upd.error) throw new Error(upd.error.message);
  return { status: "queued" as const, attempts, runAfter };
}
