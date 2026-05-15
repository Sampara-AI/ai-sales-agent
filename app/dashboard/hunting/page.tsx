import { Nunito_Sans } from "next/font/google";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

async function createCampaign(formData: FormData) {
  "use server";
  const admin = createAdminClient();

  const rawName = String(formData.get("name") || "").trim();
  if (!rawName) redirect("/dashboard/hunting");

  const parseList = (v: FormDataEntryValue | null) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const requireManual = String(formData.get("require_manual_review") || "").toLowerCase() === "on";
  const dailyLimit = Math.max(1, Math.min(500, Number(formData.get("daily_prospect_limit") || 20)));
  const emailDaily = Math.max(1, Math.min(500, Number(formData.get("email_daily_limit") || 10)));

  await admin.from("hunting_campaigns").insert({
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
    created_by: "demo",
  });

  redirect("/dashboard/hunting");
}

export default async function HuntingDashboardPage() {
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

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">Create Campaign</div>
              <form action={createCampaign} className="mt-4 space-y-3">
                <input name="name" placeholder="Campaign name" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
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
