import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  emails?: string[];
  email?: string;
  organization?: { name?: string; industry?: string; employee_count?: string } | null;
  linkedin_url?: string | null;
  location?: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  titles?: string[] | null;
  industries?: string[] | null;
  locations?: string[] | null;
  size_min?: number | null;
  size_max?: number | null;
  keywords?: string[] | null;
  exclude_companies?: string[] | null;
  daily_prospect_limit?: number | null;
  min_ai_score?: number | null;
  send_weekends?: boolean | null;
  schedule_start?: string | null;
  found_count?: number | null;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = createRouteHandlerClient({ cookies });

  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  const nowIso = new Date().toISOString();
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;
  let runStatus: "success" | "partial" | "error" = "success";
  let runSummary = "";

  try {
    const { data: userData } = await supabase.auth.getUser();
    const currentUser = userData.user;
    if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const cRes = await supabase
      .from("hunting_campaigns")
      .select("id,name,status,titles,industries,locations,size_min,size_max,keywords,exclude_companies,daily_prospect_limit,min_ai_score,send_weekends,schedule_start,created_by")
      .eq("id", id)
      .single();
    if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
    const c = cRes.data as CampaignRow;
    const pr = await supabase.from("profiles").select("role").eq("user_id", currentUser.id).single();
    const isAdmin = (pr.data as any)?.role === "admin";
    if (!isAdmin && c && (c as any).created_by && (c as any).created_by !== currentUser.id) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    if (!["active", "draft"].includes(String(c.status))) return NextResponse.json({ success: false, error: "Campaign not in runnable state" }, { status: 400 });

    const perPage = Math.max(1, Math.min(100, Number(c.daily_prospect_limit || 20)));
    const titles = Array.isArray(c.titles) ? c.titles : [];
    const industries = Array.isArray(c.industries) ? c.industries : [];
    const locations = Array.isArray(c.locations) ? c.locations : [];
    const keywords = Array.isArray(c.keywords) ? c.keywords : [];
    const excludeCompanies = Array.isArray(c.exclude_companies) ? c.exclude_companies.map((x) => String(x).toLowerCase()) : [];

    const sizeMin = Number(c.size_min || 1);
    const sizeMax = Number(c.size_max || 50000);
    const sizeRange = `${sizeMin}-${sizeMax}`;

    const apolloKey = process.env.APOLLO_API_KEY as string | undefined;
    const apolloUrl = process.env.APOLLO_API_URL as string | undefined;
    const endpoint = apolloUrl || "https://api.apollo.io/v1/mixed_people/search";

    let people: ApolloPerson[] = [];
    if (apolloKey) {
      const query: Record<string, any> = {
        api_key: apolloKey,
        person_titles: titles,
        organization_locations: locations,
        organization_industry_tag_ids: industries,
        organization_num_employees_ranges: [sizeRange],
        person_seniorities: ["director", "vp", "c_suite"],
        per_page: perPage,
        page: 1,
      };
      if (keywords.length) query.keywords = keywords.join(", ");
      try {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
        if (!res.ok) throw new Error(`Apollo ${res.status}`);
        const json = await res.json();
        const arr = (json?.people || json?.matches || []) as any[];
        people = arr.map((p) => ({
          id: p?.id,
          first_name: p?.first_name,
          last_name: p?.last_name,
          name: p?.name || [p?.first_name, p?.last_name].filter(Boolean).join(" "),
          title: p?.title,
          emails: Array.isArray(p?.emails) ? p.emails : (p?.email ? [p.email] : []),
          email: p?.email,
          organization: p?.organization || { name: p?.organization_name, industry: p?.industry, employee_count: p?.employee_count },
          linkedin_url: p?.linkedin_url || null,
          location: p?.location || null,
        })) as ApolloPerson[];
      } catch (e: any) {
        runStatus = "partial";
      }
    } else {
      runStatus = "partial";
    }

    const existingRes = await supabase
      .from("prospects")
      .select("id,name,company,email")
      .or(`campaign_id.eq.${id},source.eq.campaign:${id}`);
    const existing = (existingRes.data || []) as { id: string; name: string; company: string | null; email: string | null }[];
    const knownEmails = new Set(existing.map((x) => (x.email || "").toLowerCase()).filter(Boolean));
    const knownPairs = new Set(existing.map((x) => `${(x.name || "").toLowerCase()}|${(x.company || "").toLowerCase()}`));

    let prospects_found = people.length;
    let prospects_added = 0;
    let high_scorers = 0;
    let emails_generated = 0;

    for (const p of people) {
      const name = String(p.name || [p.first_name, p.last_name].filter(Boolean).join(" ")).trim();
      const company = String(p.organization?.name || "").trim();
      const email = String((p.emails || [])[0] || p.email || "").trim().toLowerCase();
      if (!name || !company) continue;
      if (excludeCompanies.includes(company.toLowerCase())) continue;
      if (email && knownEmails.has(email)) continue;
      if (knownPairs.has(`${name.toLowerCase()}|${company.toLowerCase()}`)) continue;

      const enrichPayload: any = {
        name,
        title: p.title || undefined,
        company,
        industry: p.organization?.industry || undefined,
        recent_activity: undefined,
        pain_points: undefined,
        source: `campaign:${id}`,
      };
      let aiScore: number | null = null;
      let fitReasoning: string | null = null;
      try {
        const enr = await fetch(`${baseUrl}/api/enrich-prospect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enrichPayload) });
        if (enr.ok) {
          const ej = await enr.json();
          aiScore = typeof ej.ai_score === "number" ? ej.ai_score : null;
          fitReasoning = typeof ej.reasoning === "string" ? ej.reasoning : null;
        }
      } catch {}

      const minScore = Math.max(0, Math.min(100, Number(c.min_ai_score || 0)));
      if (aiScore != null && aiScore < minScore) continue;

      const insPayload: any = {
        name,
        title: p.title || null,
        company,
        company_size: p.organization?.employee_count || null,
        industry: p.organization?.industry || null,
        linkedin_url: p.linkedin_url || null,
        email: email || null,
        ai_score: aiScore,
        fit_reasoning: fitReasoning,
        status: "discovered",
        source: `campaign:${id}`,
        campaign_id: id,
      };
      const ins = await supabase.from("prospects").insert({ ...insPayload, user_id: currentUser.id }).select("id").single();
      if (ins.error) continue;
      prospects_added += 1;
      if (aiScore != null && aiScore >= minScore) {
        high_scorers += 1;
        try {
          const gen = await fetch(`${baseUrl}/api/generate-outreach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, title: p.title || undefined, company, industry: p.organization?.industry || undefined, recent_activity: "", pain_points: "", source: `campaign:${id}` , prospect_id: ins.data?.id }) });
          if (gen.ok) {
            emails_generated += 1;
            await supabase.from("prospects").update({ status: "email_ready" }).eq("id", ins.data?.id);
          }
        } catch {}
      }
      if (prospects_added >= perPage) break;
    }

    const next = (() => {
      const dt = new Date();
      dt.setHours(dt.getHours() + 24);
      if (c.send_weekends === false) {
        const day = dt.getDay();
        if (day === 0) dt.setDate(dt.getDate() + 1);
        if (day === 6) dt.setDate(dt.getDate() + 2);
      }
      return dt.toISOString();
    })();

    const upd = await supabase
      .from("hunting_campaigns")
      .update({ found_count: (c.found_count || 0) + prospects_added, last_run_at: nowIso, schedule_start: next })
      .eq("id", id);
    if (upd.error) runStatus = "partial";

    runSummary = `prospects_found=${prospects_found}; prospects_added=${prospects_added}; high_scorers=${high_scorers}; emails_generated=${emails_generated}`;
    await supabase
      .from("hunting_campaign_runs")
      .insert({ campaign_id: id, run_type: "hunt", result_summary: runSummary, status: runStatus });

    return NextResponse.json({ success: true, campaign_id: id, prospects_found, prospects_added, high_scorers, emails_generated, next_action: "Send emails from dashboard" });
  } catch (err: any) {
    runStatus = "error";
    runSummary = String(err?.message || "Unknown error");
    try {
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "hunt", result_summary: runSummary, status: runStatus });
    } catch {}
    return NextResponse.json({ success: false, error: err?.message || "Hunt failed" }, { status: 500 });
  }
}