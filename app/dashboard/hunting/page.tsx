import { Nunito_Sans } from "next/font/google";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });
const demoUserId = "00000000-0000-0000-0000-000000000001";

async function insertHuntingCampaign(admin: ReturnType<typeof createAdminClient>, initialPayload: Record<string, any>) {
  let payload = { ...initialPayload };
  let lastErr: any = null;
  for (let i = 0; i < 12; i++) {
    const res = await admin.from("hunting_campaigns").insert(payload).select("id").single();
    if (!res.error) return res;
    lastErr = res.error;
    const code = String((res.error as any)?.code || "");
    if (code === "23503" && Object.prototype.hasOwnProperty.call(payload, "created_by")) {
      delete (payload as any).created_by;
      continue;
    }
    const msg = String(res.error.message || "");
    const m =
      msg.match(/Could not find the '([^']+)' column of 'hunting_campaigns'/) ||
      msg.match(/column \"([^\"]+)\" of relation \"hunting_campaigns\" does not exist/i) ||
      msg.match(/column \"([^\"]+)\" does not exist/i);
    const missing = m?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(payload, missing)) {
      delete (payload as any)[missing];
      continue;
    }
    break;
  }
  return { data: null, error: lastErr };
}

async function sendDemoEmail(formData: FormData) {
  "use server";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) redirect("/dashboard/hunting");

  const toEmail = String(formData.get("to_email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim() || "Demo Recipient";
  const title = String(formData.get("title") || "").trim() || "Founder";
  const companyInput = String(formData.get("company") || "").trim();
  if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(toEmail)) redirect("/dashboard/hunting?demo=invalid_email");

  const domain = toEmail.includes("@") ? toEmail.split("@")[1]?.trim().toLowerCase() : "";
  const company = companyInput || (domain ? domain.replace(/^www\./, "") : "Demo Company");

  const admin = createAdminClient();
  let campaignId: string | null = null;
  try {
    const existing = await admin.from("hunting_campaigns").select("id").order("created_at", { ascending: false }).limit(1);
    campaignId = String((existing.data || [])[0]?.id || "") || null;
  } catch {}
  if (!campaignId) {
    const created = await insertHuntingCampaign(admin, {
      name: "Demo Campaign",
      description: "Demo campaign (auto-created)",
      titles: [title],
      industries: [],
      locations: [],
      keywords: [],
      exclude_companies: [],
      daily_prospect_limit: 20,
      min_ai_score: 0,
      email_daily_limit: 50,
      send_weekends: true,
      followup_days: [3, 7, 14],
      max_followups: 3,
      require_manual_review: false,
      status: "active",
      created_by: demoUserId,
    });
    campaignId = String((created.data as any)?.id || "") || null;
  }
  if (!campaignId) redirect("/dashboard/hunting?demo=campaign_failed");

  const prospectIns = await admin
    .from("prospects")
    .insert({
      campaign_id: campaignId,
      name,
      title,
      company,
      domain: domain || null,
      industry: null,
      linkedin_url: null,
      email: toEmail,
      status: "email_ready",
      source: "demo",
      notes: "demo recipient",
      recent_activity: domain ? `Imported domain: ${domain}` : null,
    })
    .select("id")
    .single();
  const prospectId = String((prospectIns.data as any)?.id || "").trim();
  if (!prospectId) redirect("/dashboard/hunting?demo=prospect_failed");

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const genRes = await fetch(`${baseUrl}/api/generate-outreach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prospect_id: prospectId, enqueue_only: false }),
    cache: "no-store",
  });
  const genJson = await genRes.json().catch(() => ({} as any));
  if (!genRes.ok) redirect("/dashboard/hunting?demo=generate_failed");
  const subject = String((genJson as any)?.subject_lines?.[0] || `Quick question about ${company}`).trim();
  const body = String((genJson as any)?.email_body || "").trim();
  if (!body) redirect("/dashboard/hunting?demo=generate_failed");

  const sendRes = await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prospect_id: prospectId, to_email: toEmail, subject, body, enqueue_only: false, run_now: true }),
    cache: "no-store",
  });
  if (!sendRes.ok) redirect("/dashboard/hunting?demo=send_failed");

  redirect("/dashboard/hunting?demo=sent");
}

async function createCampaign(formData: FormData) {
  "use server";
  const admin = createAdminClient();

  const rawName = String(formData.get("name") || "").trim();
  if (!rawName) redirect("/dashboard/hunting?created=missing_name");

  const parseList = (v: FormDataEntryValue | null) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const requireManual = String(formData.get("require_manual_review") || "").toLowerCase() === "on";
  const dailyLimit = Math.max(1, Math.min(500, Number(formData.get("daily_prospect_limit") || 20)));
  const emailDaily = Math.max(1, Math.min(500, Number(formData.get("email_daily_limit") || 10)));

  const ins = await insertHuntingCampaign(admin, {
    name: rawName,
    description: String(formData.get("description") || ""),
    titles: parseList(formData.get("titles")),
    industries: parseList(formData.get("industries")),
    locations: parseList(formData.get("locations")),
    keywords: parseList(formData.get("keywords")),
    exclude_companies: parseList(formData.get("exclude_companies")),
    daily_prospect_limit: dailyLimit,
    email_daily_limit: emailDaily,
    min_ai_score: Math.max(0, Math.min(100, Number(formData.get("min_ai_score") || 70))),
    send_weekends: String(formData.get("send_weekends") || "").toLowerCase() === "on",
    followup_days: [3, 7, 14],
    max_followups: 3,
    require_manual_review: requireManual,
    status: "active",
    created_by: demoUserId,
  });

  if (ins.error) {
    const code = encodeURIComponent(String((ins.error as any)?.code || ""));
    const msg = encodeURIComponent(String(ins.error.message || "").slice(0, 160));
    redirect(`/dashboard/hunting?created=failed&code=${code}&msg=${msg}`);
  }
  redirect(`/dashboard/hunting?created=ok`);
}

export default async function HuntingDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const admin = createAdminClient();
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const [campaignsRes, emailsRes, repliesRes, meetingsRes, runsRes, prospectsRes] = await Promise.all([
    admin.from("hunting_campaigns").select("id,name,status,found_count,contacted_count,replied_count,booked_count,last_run_at,created_at").order("created_at", { ascending: false }),
    admin.from("email_campaigns").select("id", { count: "exact", head: true }).gte("sent_at", start.toISOString()),
    admin.from("prospects").select("id", { count: "exact", head: true }).eq("replied", true),
    admin.from("prospects").select("id", { count: "exact", head: true }).eq("meeting_booked", true),
    admin.from("hunting_campaign_runs").select("id,created_at,campaign_id,run_type,result_summary,status").order("created_at", { ascending: false }).limit(50),
    admin.from("prospects").select("id,created_at,name,title,company,email,ai_score,status,last_email_sent,replied,meeting_booked,source,campaign_id").order("created_at", { ascending: false }).limit(100),
  ]);

  const campaigns = (campaignsRes.data || []) as any[];
  const stats = {
    active: campaigns.filter((c) => String(c.status) === "active").length,
    emailsToday: emailsRes.count || 0,
    replies: repliesRes.count || 0,
    meetings: meetingsRes.count || 0,
  };

  const runs = (runsRes.data || []) as any[];
  const prospects = (prospectsRes.data || []) as any[];
  const demoNotice = typeof searchParams?.demo === "string" ? searchParams?.demo : "";
  const createdNotice = typeof searchParams?.created === "string" ? searchParams?.created : "";
  const createdCode = typeof searchParams?.code === "string" ? searchParams?.code : "";
  const createdMsg = typeof searchParams?.msg === "string" ? searchParams?.msg : "";
  const importNotice = typeof searchParams?.import === "string" ? searchParams?.import : "";
  const huntNotice = typeof searchParams?.hunt === "string" ? searchParams?.hunt : "";
  const sendNotice = typeof searchParams?.send === "string" ? searchParams?.send : "";
  const followupNotice = typeof searchParams?.followup === "string" ? searchParams?.followup : "";

  const campaignsError = (campaignsRes as any)?.error;
  const campaignsErrCode = String(campaignsError?.code || "");
  const campaignsErrMsg = String(campaignsError?.message || "");

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        {(campaignsErrCode || campaignsErrMsg) && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">Database not initialized for the demo workflow</div>
            <div className="mt-1">Campaign create/import requires Supabase tables like hunting_campaigns and prospects.</div>
            <div className="mt-2 text-xs">Error: {campaignsErrCode ? `${campaignsErrCode} ` : ""}{campaignsErrMsg || "unknown"}</div>
          </div>
        )}
        {createdNotice && (
          <div className={`mb-6 rounded-2xl border p-4 text-sm ${createdNotice === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {createdNotice === "ok"
              ? "Campaign created."
              : createdNotice === "missing_name"
                ? "Campaign name is required."
                : createdCode === "42P01"
                  ? "Could not create campaign: hunting_campaigns table is missing in Supabase."
                  : `Could not create campaign. ${createdCode ? `(${createdCode}) ` : ""}${createdMsg || ""}`.trim()}
          </div>
        )}
        {demoNotice && (
          <div className={`mb-6 rounded-2xl border p-4 text-sm ${demoNotice === "sent" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {demoNotice === "sent"
              ? "Demo email sent. Check your inbox."
              : demoNotice === "invalid_email"
                ? "Enter a valid email address."
                : demoNotice === "generate_failed"
                  ? "Could not generate outreach. Check GROQ_API_KEY."
                  : demoNotice === "send_failed"
                    ? "Could not send email. Check RESEND_API_KEY and verified sender."
                    : "Demo action failed."}
          </div>
        )}
        {(importNotice || huntNotice || sendNotice || followupNotice) && (
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            {importNotice && <div>CSV import: {importNotice === "failed" ? "failed" : `${importNotice} rows imported`}</div>}
            {huntNotice && <div>Hunt: {huntNotice === "ok" ? "completed" : "failed"}</div>}
            {sendNotice && <div>Send: {sendNotice === "failed" ? "failed" : `${sendNotice} emails enqueued`}</div>}
            {followupNotice && <div>Followups: {followupNotice === "failed" ? "failed" : `${followupNotice} followups enqueued`}</div>}
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          <div className="font-semibold text-slate-900">Demo steps</div>
          <div className="mt-1">1) Create campaign → 2) Upload CSV (inside the campaign card) → 3) Run Hunt → 4) Send Batch</div>
          <div className="mt-2">Knowledge upload: go to <a className="underline" href="/admin#knowledge">Admin → Knowledge Base</a>.</div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Active Campaigns</div>
            <div className="mt-1 text-2xl font-semibold">{stats.active}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Emails Today</div>
            <div className="mt-1 text-2xl font-semibold">{stats.emailsToday}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Replies</div>
            <div className="mt-1 text-2xl font-semibold">{stats.replies}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">Meetings</div>
            <div className="mt-1 text-2xl font-semibold">{stats.meetings}</div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Campaigns</div>
              <div className="mt-4 space-y-4">
                {campaigns.length === 0 ? (
                  <div className="text-sm text-slate-600">No campaigns yet</div>
                ) : (
                  campaigns.map((c) => (
                    <div key={String(c.id)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{String(c.name || "Untitled")}</div>
                          <div className="mt-1 text-xs text-slate-600">
                            Status: {String(c.status || "—")} · Found {Number(c.found_count || 0)} · Contacted {Number(c.contacted_count || 0)} · Replied{" "}
                            {Number(c.replied_count || 0)} · Booked {Number(c.booked_count || 0)}
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-500">Last run {c.last_run_at ? new Date(String(c.last_run_at)).toLocaleString() : "—"}</div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <form method="post" action={`/api/campaigns/${String(c.id)}/hunt`}>
                          <button type="submit" className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
                            Run Hunt
                          </button>
                        </form>
                        <form method="post" action={`/api/campaigns/${String(c.id)}/send`}>
                          <button type="submit" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                            Send Batch
                          </button>
                        </form>
                        <form method="post" action={`/api/campaigns/${String(c.id)}/followup`}>
                          <button type="submit" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                            Send Followups
                          </button>
                        </form>
                        <a href={`/dashboard/hunting/${String(c.id)}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                          View
                        </a>
                      </div>

                      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-xs font-semibold text-slate-700">Import CSV</div>
                        <form method="post" encType="multipart/form-data" action={`/api/campaigns/${String(c.id)}/import`} className="mt-2 flex flex-wrap items-center gap-2">
                          <input name="file" type="file" accept=".csv" className="text-sm" required />
                          <button type="submit" className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-sm text-white">
                            Upload
                          </button>
                        </form>
                        <div className="mt-2 text-xs text-slate-500">Headers supported: domain,email,name,title,company,industry,linkedin_url,notes</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Recent Activity</div>
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2 text-left">Time</th>
                      <th className="p-2 text-left">Campaign</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length === 0 ? (
                      <tr>
                        <td className="p-2 text-slate-600" colSpan={5}>
                          No recent runs
                        </td>
                      </tr>
                    ) : (
                      runs.map((r) => (
                        <tr key={String(r.id)} className="border-t border-slate-100">
                          <td className="p-2">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : "—"}</td>
                          <td className="p-2">{String(r.campaign_id || "—")}</td>
                          <td className="p-2">{String(r.run_type || "—")}</td>
                          <td className="p-2">{String(r.status || "—")}</td>
                          <td className="p-2">{String(r.result_summary || "—")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Recent Prospects</div>
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-left">Company</th>
                      <th className="p-2 text-left">Email</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Score</th>
                      <th className="p-2 text-left">Last Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.length === 0 ? (
                      <tr>
                        <td className="p-2 text-slate-600" colSpan={6}>
                          No prospects yet
                        </td>
                      </tr>
                    ) : (
                      prospects.map((p) => (
                        <tr key={String(p.id)} className="border-t border-slate-100">
                          <td className="p-2">{String(p.name || "—")}</td>
                          <td className="p-2">{String(p.company || "—")}</td>
                          <td className="p-2">{String(p.email || "—")}</td>
                          <td className="p-2">{String(p.status || "—")}</td>
                          <td className="p-2">{p.ai_score == null ? "—" : String(p.ai_score)}</td>
                          <td className="p-2">{p.last_email_sent ? new Date(String(p.last_email_sent)).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div id="quick-demo" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Quick Demo: Send yourself an outreach email</div>
              <form action={sendDemoEmail} className="mt-4 space-y-3">
                <input name="to_email" placeholder="Your email (to receive the demo)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="name" placeholder="Your name (optional)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="title" placeholder="Your title (optional)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="company" placeholder="Company (optional)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                  Generate + Send
                </button>
              </form>
              <div className="mt-3 text-xs text-slate-500">Uses live AI generation + sends via Resend.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Create Campaign</div>
              <form action={createCampaign} className="mt-4 space-y-3">
                <input name="name" placeholder="Campaign name" required className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="titles" placeholder="Titles (comma-separated)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="industries" placeholder="Industries (comma-separated)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="locations" placeholder="Locations (comma-separated)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="keywords" placeholder="Keywords (comma-separated)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <input name="exclude_companies" placeholder="Exclude companies (comma-separated)" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <div className="grid grid-cols-2 gap-3">
                  <input name="daily_prospect_limit" type="number" min={1} max={500} defaultValue={20} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                  <input name="email_daily_limit" type="number" min={1} max={500} defaultValue={10} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                </div>
                <input name="min_ai_score" type="number" min={0} max={100} defaultValue={70} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input name="require_manual_review" type="checkbox" className="h-4 w-4" /> Require manual review (otherwise auto-send)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input name="send_weekends" type="checkbox" className="h-4 w-4" /> Send on weekends
                </label>
                <button type="submit" className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
                  Create
                </button>
              </form>
              <div className="mt-3 text-xs text-slate-500">This demo view runs server-side (no browser Supabase or auth required).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
