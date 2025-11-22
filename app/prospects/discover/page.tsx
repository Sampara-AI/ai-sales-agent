"use client";
import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type ProspectRow = {
  name: string;
  title?: string;
  company?: string;
  company_size?: string;
  industry?: string;
  linkedin_url?: string;
  email?: string;
  source: string;
};

type Tab = "manual" | "apollo" | "github" | "company" | "funded";

export default function DiscoverProspectsPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) return createClient(url, anonKey);
    return null;
  }, []);

  const [active, setActive] = useState<Tab>("manual");
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [manual, setManual] = useState({
    name: "",
    title: "",
    company: "",
    company_size: "",
    industry: "",
    linkedin_url: "",
    email: "",
    recent_activity: "",
    notes: "",
  });
  const [apolloCfg, setApolloCfg] = useState({
    apiKey: "",
    titles: "CTO, VP Engineering, Head of AI",
    companySize: "100-1000",
    industry: "",
    location: "",
  });
  const [apolloResults, setApolloResults] = useState<ProspectRow[]>([]);
  const [apolloSelected, setApolloSelected] = useState<Record<number, boolean>>({});

  const [ghQuery, setGhQuery] = useState("enterprise AI ML");
  const [ghResults, setGhResults] = useState<ProspectRow[]>([]);

  const [companyResearch, setCompanyResearch] = useState({ domain: "", hunterKey: "" });
  const [companyResults, setCompanyResults] = useState<ProspectRow[]>([]);

  const [funded, setFunded] = useState({ company: "", amount: "", date: "", industry: "", note: "" });

  const saveProspect = async (p: ProspectRow, extra?: { recent_activity?: string }) => {
    try {
      if (!supabase) throw new Error("Supabase not configured");
      const payload: any = {
        name: p.name,
        title: p.title || null,
        company: p.company || null,
        company_size: p.company_size || null,
        industry: p.industry || null,
        linkedin_url: p.linkedin_url || null,
        email: p.email || null,
        status: "discovered",
        source: p.source,
        recent_activity: extra?.recent_activity || null,
      };
      const enrichRes = await fetch("/api/enrich-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let ai_score: number | null = null;
      let fit_reasoning: string | null = null;
      if (enrichRes.ok) {
        const data: { success: boolean; ai_score?: number; reasoning?: string } = await enrichRes.json();
        if (data.success) {
          ai_score = typeof data.ai_score === "number" ? data.ai_score : null;
          fit_reasoning = data.reasoning || null;
        }
      }
      payload.ai_score = ai_score;
      payload.fit_reasoning = fit_reasoning;
      const { error: insertErr } = await supabase.from("prospects").insert(payload);
      if (insertErr) throw new Error(insertErr.message);
      setBanner("Prospect saved");
    } catch (e: any) {
      setError(e?.message || "Failed to save prospect");
    }
  };

  const searchApollo = async () => {
    setError(null);
    setBanner(null);
    if (!apolloCfg.apiKey) {
      setError("Add Apollo API key to search");
      return;
    }
    try {
      setApolloResults([]);
      const sample: ProspectRow[] = [
        { name: "Alex Carter", title: "CTO", company: "Zenos Systems", company_size: apolloCfg.companySize, industry: apolloCfg.industry, email: "alex@zenos.ai", source: "apollo" },
        { name: "Priya Shah", title: "VP Engineering", company: "Skyline Robotics", company_size: apolloCfg.companySize, industry: apolloCfg.industry, email: "priya@skyline.io", source: "apollo" },
      ];
      setApolloResults(sample);
      setBanner("Found results");
    } catch (e: any) {
      setError("Apollo search failed");
    }
  };

  const searchGitHub = async () => {
    setError(null);
    setBanner(null);
    try {
      setGhResults([]);
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(ghQuery)}&sort=stars&order=desc&per_page=5`);
      if (!res.ok) throw new Error("GitHub rate limited");
      const json = await res.json();
      const items = (json.items || []).map((it: any) => ({
        name: it.owner?.login || "Unknown",
        company: it.owner?.type === "Organization" ? it.owner?.login : null,
        title: "Engineer",
        linkedin_url: null,
        email: null,
        source: "github",
      }));
      setGhResults(items);
      setBanner("GitHub results loaded");
    } catch (e: any) {
      setError("GitHub search failed");
    }
  };

  const researchCompany = async () => {
    setError(null);
    setBanner(null);
    try {
      const results: ProspectRow[] = [];
      if (companyResearch.hunterKey && companyResearch.domain) {
        try {
          const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(companyResearch.domain)}&api_key=${encodeURIComponent(companyResearch.hunterKey)}`;
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            const emails = json?.data?.emails || [];
            for (const e of emails.slice(0, 5)) {
              results.push({
                name: e?.first_name && e?.last_name ? `${e.first_name} ${e.last_name}` : e?.value,
                title: e?.position || undefined,
                company: json?.data?.organization || companyResearch.domain,
                email: e?.value,
                source: "hunter",
              });
            }
          }
        } catch {}
      }
      setCompanyResults(results);
      setBanner("Company research results");
    } catch (e: any) {
      setError("Company research failed");
    }
  };

  const importSelectedApollo = async () => {
    const selected = apolloResults.filter((_, idx) => apolloSelected[idx]);
    for (const p of selected) await saveProspect(p);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-50 px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Prospect Discovery</h1>
        </div>
        <div className="mb-4 flex gap-2">
          {([
            { key: "manual", label: "Manual Entry" },
            { key: "apollo", label: "Apollo.io" },
            { key: "github", label: "GitHub Discovery" },
            { key: "company", label: "Company Research" },
            { key: "funded", label: "Funded Companies" },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`rounded-lg px-3 py-2 text-sm ${active === t.key ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {banner && (
          <div className="mb-4 rounded-lg border border-green-600/30 bg-green-900/30 p-3 text-green-300 text-sm">{banner}</div>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">{error}</div>
        )}

        {active === "manual" && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Name *" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Company *" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} />
              <select className="rounded-lg border border-white/10 bg-zinc-800 p-3" value={manual.company_size} onChange={(e) => setManual({ ...manual, company_size: e.target.value })}>
                <option value="">Company Size</option>
                <option value="1-50">1-50</option>
                <option value="51-200">51-200</option>
                <option value="201-1000">201-1000</option>
                <option value="1000+">1000+</option>
              </select>
              <select className="rounded-lg border border-white/10 bg-zinc-800 p-3" value={manual.industry} onChange={(e) => setManual({ ...manual, industry: e.target.value })}>
                <option value="">Industry</option>
                <option value="Technology">Technology</option>
                <option value="SaaS">SaaS</option>
                <option value="Fintech">Fintech</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Other">Other</option>
              </select>
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="LinkedIn URL" value={manual.linkedin_url} onChange={(e) => setManual({ ...manual, linkedin_url: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
            </div>
            <textarea className="mt-4 w-full rounded-lg border border-white/10 bg-zinc-800 p-3" rows={4} placeholder="Recent Activity" value={manual.recent_activity} onChange={(e) => setManual({ ...manual, recent_activity: e.target.value })} />
            <textarea className="mt-3 w-full rounded-lg border border-white/10 bg-zinc-800 p-3" rows={3} placeholder="Notes" value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  if (!manual.name.trim() || !manual.company.trim()) {
                    setError("Name and Company are required");
                    return;
                  }
                  saveProspect({ name: manual.name.trim(), title: manual.title || undefined, company: manual.company.trim(), company_size: manual.company_size || undefined, industry: manual.industry || undefined, linkedin_url: manual.linkedin_url || undefined, email: manual.email || undefined, source: "manual" }, { recent_activity: manual.recent_activity });
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
              >
                Save Prospect
              </button>
            </div>
          </div>
        )}

        {active === "apollo" && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="mb-3 text-sm text-zinc-400">Get your free Apollo API key at apollo.io/api</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Apollo API Key" value={apolloCfg.apiKey} onChange={(e) => setApolloCfg({ ...apolloCfg, apiKey: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Job Titles" value={apolloCfg.titles} onChange={(e) => setApolloCfg({ ...apolloCfg, titles: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Company Size" value={apolloCfg.companySize} onChange={(e) => setApolloCfg({ ...apolloCfg, companySize: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Industry" value={apolloCfg.industry} onChange={(e) => setApolloCfg({ ...apolloCfg, industry: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Location" value={apolloCfg.location} onChange={(e) => setApolloCfg({ ...apolloCfg, location: e.target.value })} />
            </div>
            <div className="mt-4">
              <button onClick={searchApollo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">Search Apollo.io</button>
            </div>
            {apolloResults.length > 0 && (
              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-300">
                      <th className="px-2 py-2">Select</th>
                      <th className="px-2 py-2">Name</th>
                      <th className="px-2 py-2">Title</th>
                      <th className="px-2 py-2">Company</th>
                      <th className="px-2 py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apolloResults.map((r, i) => (
                      <tr key={i} className="border-t border-white/10">
                        <td className="px-2 py-2"><input type="checkbox" checked={!!apolloSelected[i]} onChange={(e) => setApolloSelected({ ...apolloSelected, [i]: e.target.checked })} /></td>
                        <td className="px-2 py-2">{r.name}</td>
                        <td className="px-2 py-2">{r.title}</td>
                        <td className="px-2 py-2">{r.company}</td>
                        <td className="px-2 py-2">{r.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4">
                  <button onClick={importSelectedApollo} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-500">Import Selected</button>
                </div>
              </div>
            )}
          </div>
        )}

        {active === "github" && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Keywords" value={ghQuery} onChange={(e) => setGhQuery(e.target.value)} />
            </div>
            <div className="mt-4">
              <button onClick={searchGitHub} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">Search GitHub</button>
            </div>
            {ghResults.length > 0 && (
              <div className="mt-6">
                {ghResults.map((r, i) => (
                  <div key={i} className="mb-3 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-800 p-3">
                    <div>
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-zinc-400">{r.company || "Individual"}</div>
                    </div>
                    <button onClick={() => saveProspect(r)} className="rounded-lg bg-green-600 px-3 py-2 text-xs text-white hover:bg-green-500">Add to Prospects</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {active === "company" && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="mb-3 text-sm text-zinc-400">Hunter.io API key: hunter.io/api</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Company domain" value={companyResearch.domain} onChange={(e) => setCompanyResearch({ ...companyResearch, domain: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Hunter API Key" value={companyResearch.hunterKey} onChange={(e) => setCompanyResearch({ ...companyResearch, hunterKey: e.target.value })} />
            </div>
            <div className="mt-4">
              <button onClick={researchCompany} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">Research Company</button>
            </div>
            {companyResults.length > 0 && (
              <div className="mt-6">
                {companyResults.map((r, i) => (
                  <div key={i} className="mb-3 flex items-center justify-between rounded-lg border border-white/10 bg-zinc-800 p-3">
                    <div>
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-zinc-400">{r.title} • {r.company}</div>
                    </div>
                    <button onClick={() => saveProspect(r)} className="rounded-lg bg-green-600 px-3 py-2 text-xs text-white hover:bg-green-500">Add to Prospects</button>
                  </div>
                ))}
                <div className="mt-2">
                  <button onClick={async () => { for (const r of companyResults) await saveProspect(r); }} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-500">Add All</button>
                </div>
              </div>
            )}
          </div>
        )}

        {active === "funded" && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Company" value={funded.company} onChange={(e) => setFunded({ ...funded, company: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Funding amount" value={funded.amount} onChange={(e) => setFunded({ ...funded, amount: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Date" value={funded.date} onChange={(e) => setFunded({ ...funded, date: e.target.value })} />
              <input className="rounded-lg border border-white/10 bg-zinc-800 p-3" placeholder="Industry" value={funded.industry} onChange={(e) => setFunded({ ...funded, industry: e.target.value })} />
            </div>
            <textarea className="mt-4 w-full rounded-lg border border-white/10 bg-zinc-800 p-3" rows={4} placeholder="Why they're a good fit" value={funded.note} onChange={(e) => setFunded({ ...funded, note: e.target.value })} />
            <div className="mt-4">
              <button
                onClick={() => {
                  if (!funded.company.trim()) { setError("Company is required"); return; }
                  const p: ProspectRow = { name: funded.company.trim(), company: funded.company.trim(), industry: funded.industry || undefined, source: "funded_companies" };
                  saveProspect(p, { recent_activity: `Funding: ${funded.amount} on ${funded.date}. ${funded.note}` });
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
              >
                Create Prospect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}