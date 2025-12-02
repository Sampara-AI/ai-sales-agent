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
  const [activeCampaigns, setActiveCampaigns] = useState(0);
  useEffect(() => {
    const load = async () => {
      const res = await supabase.from("hunting_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
      setActiveCampaigns(res.count || 0);
    };
    load();
  }, [supabase]);
  if (!user && !isDev) return null;
  return (
    <aside className="w-full max-w-[240px] rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
      <div className="space-y-2 text-sm">
        <Link href="/dashboard" className="block rounded-lg bg-white/5 px-3 py-2">Overview</Link>
        <Link href="/dashboard/hunting" className="block rounded-lg bg-white/5 px-3 py-2">🎯 Hunting Campaigns <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] text-white">{activeCampaigns}</span></Link>
        <Link href="/prospects" className="block rounded-lg bg-white/5 px-3 py-2">Prospects</Link>
        {(isAdmin || isDev) && <Link href="/admin" className="block rounded-lg bg-white/5 px-3 py-2">🛡️ Admin</Link>}
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto max-w-7xl px-6 py-6">
        <AuthProvider>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
            <Sidebar />
            <div className="rounded-2xl border border-white/20 bg-white/5 p-4 backdrop-blur-xl">{children}</div>
          </div>
        </AuthProvider>
      </div>
    </div>
  );
}
