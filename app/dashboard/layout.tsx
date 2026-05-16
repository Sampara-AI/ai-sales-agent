"use client";
import Link from "next/link";
import { Nunito_Sans } from "next/font/google";
import AuthProvider, { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useMemo, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

function Sidebar() {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const { user } = useAuth();
  const { isAdmin } = useAuth();
  const isDev = process.env.NODE_ENV === "development";
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const [activeCampaigns, setActiveCampaigns] = useState(0);
  useEffect(() => {
    const load = async () => {
      const res = await supabase.from("hunting_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
      setActiveCampaigns(res.count || 0);
    };
    load();
  }, [supabase]);
  if (!user && !isDev && !demoMode) return null;
  return (
    <aside className="w-full max-w-[240px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="space-y-2 text-sm">
        <Link href="/dashboard" className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Overview</Link>
        <Link href="/dashboard/hunting" className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Hunting Campaigns <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">{activeCampaigns}</span></Link>
        <Link href="/dashboard/inbox" className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Inbox</Link>
        <Link href="/prospects/discover" className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Prospects</Link>
        {(isAdmin || isDev) && <Link href="/admin" className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Admin</Link>}
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-6">
        <AuthProvider>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
            <Sidebar />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>
          </div>
        </AuthProvider>
      </div>
    </div>
  );
}
