"use client";
import { useEffect, useMemo, useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { createClient } from "@supabase/supabase-js";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type Campaign = {
  id: string;
  name: string;
  status: "active" | "paused" | "draft";
  target_summary?: string;
  found_count?: number;
  contacted_count?: number;
  replied_count?: number;
  booked_count?: number;
  last_run_at?: string | null;
};

type ActivityRun = {
  id: string;
  created_at: string;
  campaign_id: string;
  campaign_name?: string;
  run_type: "hunt" | "email" | "followup";
  result_summary?: string;
  status: "success" | "partial" | "error";
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export default function HuntingDashboardPage() {
  const [tab, setTab] = useState<"campaigns" | "activity">("campaigns");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [stats, setStats] = useState({ active: 0, emailsToday: 0, meetings: 0, replies: 0, dailyLimit: 100 });
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !anon) { setError("Supabase not configured"); setLoading(false); return; }
    const s = createClient(url, anon);
    const load = async () => {
      try {
        const cRes = await s.from("hunting_campaigns").select("id,name,status,target_summary,found_count,contacted_count,replied_count,booked_count,last_run_at").order("created_at", { ascending: false });
        const campaignsData = Array.isArray(cRes.data) ? cRes.data as Campaign[] : [];
        setCampaigns(campaignsData);
        const start = new Date(); start.setHours(0,0,0,0);
        const emailsRes = await s.from("email_campaigns").select("id", { count: "exact", head: true }).gte("sent_at", start.toISOString());
        const repliesRes = await s.from("prospects").select("id", { count: "exact", head: true }).eq("replied", true);
        const meetingsRes = await s.from("prospects").select("id", { count: "exact", head: true }).eq("meeting_booked", true);
        const activeCount = campaignsData.filter((c) => c.status === "active").length;
        setStats({ active: activeCount, emailsToday: emailsRes.count || 0, meetings: meetingsRes.count || 0, replies: repliesRes.count || 0, dailyLimit: 100 });
        const rRes = await s.from("hunting_campaign_runs").select("id,created_at,campaign_id,run_type,result_summary,status").order("created_at", { ascending: false }).limit(50);
        const runsData = Array.isArray(rRes.data) ? rRes.data as ActivityRun[] : [];
        const nameById: Record<string,string> = {}; campaignsData.forEach((c) => nameById[c.id] = c.name);
        runsData.forEach((r) => r.campaign_name = nameById[r.campaign_id]);
        setRuns(runsData);
      } catch (e: any) {
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const runNow = async (id: string) => {
    setActionBusy(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/hunt`, { method: "POST" });
      if (!res.ok) throw new Error("Hunt failed");
    } catch (e: any) {
      setError(e?.message || "Failed to run hunt");
    } finally {
      setActionBusy(null);
    }
  };
  const pause = async (id: string) => {
    setActionBusy(id);
    try {
      if (!url || !anon) throw new Error("Supabase not configured");
      const s = createClient(url, anon);
      await s.from("hunting_campaigns").update({ status: "paused" }).eq("id", id);
    } catch (e: any) {
      setError(e?.message || "Failed to pause");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}> 
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Active Campaigns</div>
            <div className="mt-1 text-2xl font-bold">{stats.active}</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Emails Today</div>
            <div className="mt-1 text-2xl font-bold">{stats.emailsToday} / {stats.dailyLimit}</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Meetings</div>
            <div className="mt-1 text-2xl font-bold">{stats.meetings}</div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Replies</div>
            <div className="mt-1 text-2xl font-bold">{stats.replies}</div>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          <button onClick={() => setTab("campaigns")} className={`rounded-xl border px-3 py-2 text-sm ${tab === "campaigns" ? "border-blue-500 bg-blue-600 text-white" : "border-white/20 bg-white/10 text-zinc-200"}`}>Campaigns</button>
          <button onClick={() => setTab("activity")} className={`rounded-xl border px-3 py-2 text-sm ${tab === "activity" ? "border-blue-500 bg-blue-600 text-white" : "border-white/20 bg-white/10 text-zinc-200"}`}>Activity Log</button>
        </div>

        {loading && (
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            {[...Array(4)].map((_,i) => (
              <div key={i} className="h-40 animate-pulse rounded-3xl border border-white/20 bg-white/5" />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-8 rounded-2xl border border-red-600/30 bg-red-900/30 p-4 text-red-300">{error}</div>
        )}

        {!loading && !error && tab === "campaigns" && (
          <div className="mt-8">
            <div className="mb-4 flex justify-end">
              <button className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">+ Create New Campaign</button>
            </div>
            {campaigns.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/10 p-6 text-center text-sm text-zinc-300">No campaigns yet</div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {campaigns.map((c) => (
                  <div key={c.id} className="rounded-3xl border border-white/20 bg-gradient-to-br from-zinc-900/80 to-zinc-800/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold">{c.name}</div>
                      <span className={`rounded-full border px-3 py-1 text-xs ${c.status === "active" ? "border-green-600/40 bg-green-700/30 text-green-300" : c.status === "paused" ? "border-yellow-600/40 bg-yellow-700/30 text-yellow-300" : "border-white/20 bg-white/10 text-zinc-300"}`}>{c.status.toUpperCase()}</span>
                    </div>
                    <div className="mt-2 text-sm text-zinc-300">{c.target_summary || "—"}</div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Found {c.found_count ?? 0}</div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Contacted {c.contacted_count ?? 0}</div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Replied {c.replied_count ?? 0}</div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Booked {c.booked_count ?? 0}</div>
                    </div>
                    <div className="mt-3 text-xs text-zinc-400">Last run {c.last_run_at ? new Date(c.last_run_at).toLocaleString() : "—"}</div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button onClick={() => runNow(c.id)} disabled={actionBusy === c.id} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm disabled:opacity-60">{actionBusy === c.id ? "…" : "▶️ Run Now"}</button>
                      <button onClick={() => pause(c.id)} disabled={actionBusy === c.id} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm disabled:opacity-60">⏸️ Pause</button>
                      <button className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm">⚙️ Edit</button>
                      <button className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm">📊 View Details</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && !error && tab === "activity" && (
          <div className="mt-8">
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/10 p-6 text-center text-sm text-zinc-300">No recent activity</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/20 bg-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-300">
                      <th className="p-2 text-left">Timestamp</th>
                      <th className="p-2 text-left">Campaign</th>
                      <th className="p-2 text-left">Run Type</th>
                      <th className="p-2 text-left">Results</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-t border-white/10">
                        <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="p-2">{r.campaign_name || r.campaign_id}</td>
                        <td className="p-2">{r.run_type.toUpperCase()}</td>
                        <td className="p-2">{r.result_summary || "—"}</td>
                        <td className="p-2">
                          <span className={`rounded-full border px-3 py-1 text-xs ${r.status === "success" ? "border-green-600/40 bg-green-700/30 text-green-300" : r.status === "partial" ? "border-yellow-600/40 bg-yellow-700/30 text-yellow-300" : "border-red-600/40 bg-red-700/30 text-red-300"}`}>{r.status.toUpperCase()}</span>
                        </td>
                        <td className="p-2"><button className="rounded-xl border border-white/20 bg-white/10 px-3 py-1">View Details</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}