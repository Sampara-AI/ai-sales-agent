"use client";
import { useEffect, useMemo, useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useAuth } from "@/lib/supabase/auth-provider";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type Profile = { id: string; user_id: string; name?: string | null; email?: string | null; company?: string | null; role?: string | null; created_at?: string };
type Campaign = { id: string; name: string; status: string };
type Prospect = { id: string; created_at: string; last_email_sent?: string | null };
type Run = { id: string; created_at: string; campaign_id: string; run_type: string; status: string; result_summary?: string | null };
type SetupReq = { id: string; created_at: string; name?: string | null; email?: string | null; company?: string | null; status?: string | null };

export default function AdminPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<Profile[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState(0);
  const [totalProspects, setTotalProspects] = useState(0);
  const [emailsSentToday, setEmailsSentToday] = useState(0);
  const [health, setHealth] = useState("✅ All services operational");
  const [runs, setRuns] = useState<Run[]>([]);
  const [setupRequests, setSetupRequests] = useState<SetupReq[]>([]);
  const [filterRole, setFilterRole] = useState<"all" | "free" | "paid" | "admin">("all");

  useEffect(() => {
    if (!user) { router.replace("/dashboard"); return; }
    if (!isAdmin) { router.replace("/dashboard"); return; }
  }, [user, isAdmin]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const uRes = await supabase.from("profiles").select("id,user_id,name,email,company,role,created_at").order("created_at", { ascending: false }).limit(500);
        setUsers(((uRes.data || []) as Profile[]));
        const cRes = await supabase.from("hunting_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
        setActiveCampaigns(cRes.count || 0);
        const pRes = await supabase.from("prospects").select("id", { count: "exact", head: true });
        setTotalProspects(pRes.count || 0);
        const start = new Date(); start.setHours(0,0,0,0);
        const eRes = await supabase.from("prospects").select("id,last_email_sent").gte("last_email_sent", start.toISOString());
        setEmailsSentToday(((eRes.data || []) as Prospect[]).filter((x) => !!x.last_email_sent).length);
        const rRes = await supabase.from("hunting_campaign_runs").select("id,created_at,campaign_id,run_type,status,result_summary").order("created_at", { ascending: false }).limit(50);
        setRuns((rRes.data || []) as Run[]);
        const sRes = await supabase.from("setup_calls").select("id,created_at,name,email,company,status").order("created_at", { ascending: false }).limit(100);
        setSetupRequests((sRes.data || []) as SetupReq[]);
        const ok = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.GROQ_API_KEY && process.env.RESEND_API_KEY;
        setHealth(ok ? "✅ All services operational" : "⚠️ Check environment configuration");
        const channel = supabase.channel("admin-feed").on("postgres_changes", { event: "*", schema: "public", table: "hunting_campaign_runs" }, (payload) => { setRuns((prev) => [payload.new as any, ...prev].slice(0, 50)); }).on("postgres_changes", { event: "*", schema: "public", table: "setup_calls" }, (payload) => { setSetupRequests((prev) => [payload.new as any, ...prev].slice(0, 100)); });
        channel.subscribe();
      } catch (e: any) {
        setError(e?.message || "Failed to load admin data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [supabase]);

  const signupsSeries = (() => {
    const byDay: Record<string, number> = {};
    for (const u of users) {
      const key = (u.created_at ? new Date(u.created_at) : new Date()).toISOString().slice(0,10);
      byDay[key] = (byDay[key] || 0) + 1;
    }
    return Object.entries(byDay).map(([d,n]) => ({ date: d.slice(5), count: n })).sort((a,b) => a.date.localeCompare(b.date)).slice(-14);
  })();

  const emailRateSeries = (() => {
    const byDay: Record<string, { sent: number; replies: number }> = {};
    for (const r of runs) {
      if (r.run_type !== "email") continue;
      const key = new Date(r.created_at).toISOString().slice(0,10);
      if (!byDay[key]) byDay[key] = { sent: 0, replies: 0 };
      const m = r.result_summary || "";
      const s = Number((m.match(/emails_sent=(\d+)/)?.[1]) || 0);
      byDay[key].sent += s;
    }
    return Object.entries(byDay).map(([d,v]) => ({ date: d.slice(5), rate: v.sent })).sort((a,b) => a.date.localeCompare(b.date)).slice(-14);
  })();

  const apiUsageBars = (() => {
    const items = [
      { name: "Groq", value: runs.filter((r) => /followup/.test(r.run_type)).length },
      { name: "Apollo", value: runs.filter((r) => /hunt/.test(r.run_type)).length },
      { name: "Resend", value: runs.filter((r) => /email/.test(r.run_type)).length },
    ];
    return items;
  })();

  const filteredUsers = users.filter((u) => {
    if (filterRole === "admin") return (u.role || "") === "admin";
    if (filterRole === "free") return (u.role || "") === "user";
    if (filterRole === "paid") return (u.role || "") === "paid";
    return true;
  });

  const makeAdmin = async (userId: string) => { await supabase.from("profiles").update({ role: "admin" }).eq("user_id", userId); };
  const suspendUser = async (userId: string) => { await supabase.from("profiles").update({ role: "suspended" }).eq("user_id", userId); };
  const markSetupContacted = async (id: string) => { await supabase.from("setup_calls").update({ status: "contacted" }).eq("id", id); };

  const pauseAllCampaigns = async () => { await supabase.from("hunting_campaigns").update({ status: "paused" }).eq("status", "active"); };
  const runManualHuntAll = async () => {
    const cRes = await supabase.from("hunting_campaigns").select("id").eq("status", "active");
    const host = window.location.host; const proto = host.includes("localhost") ? "http" : "https"; const base = `${proto}://${host}`;
    for (const c of (cRes.data || []) as { id: string }[]) { try { await fetch(`${base}/api/campaigns/${c.id}/hunt`, { method: "POST" }); } catch {} }
  };
  const exportAllData = async () => {
    const pRes = await supabase.from("prospects").select("*");
    const cRes = await supabase.from("hunting_campaigns").select("*");
    const data = { prospects: pRes.data || [], campaigns: cRes.data || [] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "export.json"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">{error}</div>}
        <div className="mb-6 text-xl font-bold">Admin Dashboard</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4"><div className="text-xs text-zinc-400">Total Users</div><div className="mt-1 text-2xl font-bold">{users.length}</div></div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4"><div className="text-xs text-zinc-400">Active Campaigns</div><div className="mt-1 text-2xl font-bold">{activeCampaigns}</div></div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4"><div className="text-xs text-zinc-400">Total Prospects</div><div className="mt-1 text-2xl font-bold">{totalProspects}</div></div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4"><div className="text-xs text-zinc-400">Emails Sent Today</div><div className="mt-1 text-2xl font-bold">{emailsSentToday}</div></div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4"><div className="text-xs text-zinc-400">System Health</div><div className="mt-1 text-sm">{health}</div></div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/20 bg-white/10 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Users</div>
            <div className="flex items-center gap-2 text-xs">
              <button onClick={() => setFilterRole("all")} className={`rounded px-2 py-1 ${filterRole==='all'?"bg-blue-600 text-white":"bg-white/5"}`}>All</button>
              <button onClick={() => setFilterRole("free")} className={`rounded px-2 py-1 ${filterRole==='free'?"bg-blue-600 text-white":"bg_white/5"}`}>Free</button>
              <button onClick={() => setFilterRole("paid")} className={`rounded px-2 py-1 ${filterRole==='paid'?"bg-blue-600 text-white":"bg_white/5"}`}>Paid</button>
              <button onClick={() => setFilterRole("admin")} className={`rounded px-2 py-1 ${filterRole==='admin'?"bg-blue-600 text-white":"bg_white/5"}`}>Admin</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-300"><th className="p-2">Email</th><th className="p-2">Name</th><th className="p-2">Company</th><th className="p-2">Role</th><th className="p-2">Signup Date</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-t border-white/10">
                    <td className="p-2">{u.email || "—"}</td>
                    <td className="p-2">{u.name || "—"}</td>
                    <td className="p-2">{u.company || "—"}</td>
                    <td className="p-2">{u.role || "user"}</td>
                    <td className="p-2">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                    <td className="p-2">Active</td>
                    <td className="p-2"><div className="flex items-center gap-2"><button className="rounded bg-zinc-800 px-2 py-1 text-xs">View Details</button><button onClick={() => makeAdmin(u.user_id)} className="rounded bg-zinc-800 px-2 py-1 text-xs">Make Admin</button><button onClick={() => suspendUser(u.user_id)} className="rounded bg-zinc-800 px-2 py-1 text-xs">Suspend</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-3 text-sm font-semibold">Signups Over Time</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={signupsSeries}><XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} /><YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey="count" stroke="#60a5fa" strokeWidth={2} dot={false} /></LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-3 text-sm font-semibold">Email Send Rate</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%"><LineChart data={emailRateSeries}><XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} /><YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey="rate" stroke="#a78bfa" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-3 text-sm font-semibold">API Usage</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={apiUsageBars}><XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} /><YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="value" fill="#60a5fa" /></BarChart></ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-3 text-sm font-semibold">Recent Activity</div>
            <div className="space-y-2">
              {runs.length === 0 ? (<div className="rounded border border_white/10 bg_white/5 p-3 text-sm">No activity yet</div>) : runs.map((r) => (<div key={r.id} className="flex items-start gap-3"><div className={`mt-1 h-2 w-2 rounded-full ${r.run_type === "hunt" ? "bg-blue-500" : r.run_type === "email" ? "bg-purple-500" : "bg-amber-500"}`}></div><div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-xs text-zinc-400">{new Date(r.created_at).toLocaleString()}</div><div className="text-sm">{r.run_type} • {r.result_summary || ""}</div></div></div>))}
            </div>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-3 text-sm font-semibold">System Controls</div>
            <div className="flex flex-wrap items-center gap-2"><button onClick={pauseAllCampaigns} className="rounded bg-zinc-800 px-3 py-2 text-sm">Pause All Campaigns</button><button onClick={runManualHuntAll} className="rounded bg-zinc-800 px-3 py-2 text-sm">Run Manual Hunt</button><button onClick={exportAllData} className="rounded bg-zinc-800 px-3 py-2 text-sm">Export All Data</button></div>
            <div className="mt-3 text-xs text-zinc-400">Use the hunting dashboard to view error logs.</div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/20 bg-white/10 p-4">
          <div className="mb-3 text-sm font-semibold">Setup Requests</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-zinc-300"><th className="p-2">Email</th><th className="p-2">Company</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody>{setupRequests.map((s) => (<tr key={s.id} className="border-t border-white/10"><td className="p-2">{s.email || "—"}</td><td className="p-2">{s.company || "—"}</td><td className="p-2">{s.status || "pending"}</td><td className="p-2"><div className="flex items-center gap-2"><button onClick={() => markSetupContacted(s.id)} className="rounded bg-zinc-800 px-2 py-1 text-xs">Mark as Contacted</button><button className="rounded bg-zinc-800 px-2 py-1 text-xs">Schedule Call</button></div></td></tr>))}</tbody></table>
          </div>
        </div>
      </div>
    </div>
  );
}