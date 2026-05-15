import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";

type ImportRow = {
  email?: string;
  domain?: string;
  company?: string;
  name?: string;
  title?: string;
  industry?: string;
  linkedin_url?: string;
  notes?: string;
};

function normalizeHeader(h: string) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function deriveDomain(email?: string, domain?: string) {
  const d = String(domain || "").trim();
  if (d) return d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at === -1) return "";
  return e.slice(at + 1).replace(/^www\./, "").toLowerCase();
}

function safeEmail(email?: string) {
  const e = String(email || "").trim();
  if (!e) return "";
  const ok = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(e);
  return ok ? e : "";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const supabase = demoMode ? createAdminClient() : createRouteHandlerClient({ cookies });
  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });

  try {
    if (!demoMode) {
      const { data: userData } = await (supabase as any).auth.getUser();
      const currentUser = userData.user;
      if (!currentUser) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

      const cRes = await supabase.from("hunting_campaigns").select("id,created_by").eq("id", id).single();
      if (cRes.error || !cRes.data) return NextResponse.json({ success: false, error: cRes.error?.message || "Campaign not found" }, { status: 404 });
      const pr = await supabase.from("profiles").select("role").eq("user_id", currentUser.id).single();
      const isAdmin = (pr.data as any)?.role === "admin";
      if (!isAdmin && (cRes.data as any).created_by && (cRes.data as any).created_by !== currentUser.id) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Missing file" }, { status: 400 });
    }
    if (!String(file.name || "").toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ success: false, error: "Only CSV is supported right now" }, { status: 400 });
    }

    const raw = await file.text();
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return NextResponse.json({ success: false, error: "CSV has no rows" }, { status: 400 });

    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    const idx = (name: string) => headers.findIndex((h) => h === name);
    const iEmail = idx("email");
    const iDomain = idx("domain");
    const iCompany = idx("company");
    const iName = idx("name");
    const iFirst = idx("first_name");
    const iLast = idx("last_name");
    const iTitle = idx("title");
    const iIndustry = idx("industry");
    const iLinkedin = idx("linkedin_url");
    const iNotes = idx("notes");

    const rows: ImportRow[] = [];
    const seenKeys = new Set<string>();
    for (const line of lines.slice(1)) {
      const cols = parseCsvLine(line);
      const email = safeEmail(cols[iEmail] || "").toLowerCase();
      const domain = deriveDomain(email, cols[iDomain] || "");
      const name =
        (cols[iName] || "").trim() ||
        `${String(cols[iFirst] || "").trim()} ${String(cols[iLast] || "").trim()}`.trim() ||
        "";
      const company = String(cols[iCompany] || "").trim() || (domain ? domain.replace(/^www\./, "") : "");
      const title = String(cols[iTitle] || "").trim();
      const industry = String(cols[iIndustry] || "").trim();
      const linkedin_url = String(cols[iLinkedin] || "").trim();
      const notes = String(cols[iNotes] || "").trim();

      if (!email && !domain && !company && !name) continue;
      const key = domain ? `${domain}|${email || ""}` : email ? `|${email}` : "";
      if (key) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      rows.push({ email, domain, company, name, title, industry, linkedin_url, notes });
    }

    if (rows.length === 0) return NextResponse.json({ success: false, error: "No valid rows found" }, { status: 400 });

    const existingRes = await supabase.from("prospects").select("email,domain").eq("campaign_id", id);
    const existingKeys = new Set<string>(
      ((existingRes.data || []) as any[])
        .map((x) => {
          const e = String(x.email || "").trim().toLowerCase();
          const d = String(x.domain || "").trim().toLowerCase();
          if (d) return `${d}|${e || ""}`;
          if (e) return `|${e}`;
          return "";
        })
        .filter(Boolean),
    );
    const toInsertRows = rows
      .filter((r) => {
        const e = String(r.email || "").trim().toLowerCase();
        const d = String(r.domain || "").trim().toLowerCase();
        const key = d ? `${d}|${e || ""}` : e ? `|${e}` : "";
        if (!key) return true;
        return !existingKeys.has(key);
      })
      .slice(0, 250);
    const skipped_duplicates = Math.max(0, rows.length - toInsertRows.length);

    const insert = toInsertRows.map((r) => ({
      campaign_id: id,
      name: r.name || r.company || r.domain || r.email || "Unknown",
      title: r.title || null,
      company: r.company || null,
      domain: r.domain || null,
      industry: r.industry || null,
      linkedin_url: r.linkedin_url || null,
      email: r.email || null,
      status: r.email ? "email_ready" : "discovered",
      source: "import",
      notes: r.notes || null,
      recent_activity: r.domain ? `Imported domain: ${r.domain}` : null,
    }));

    if (insert.length === 0) {
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "import", result_summary: "imported=0; skipped_duplicates=" + skipped_duplicates, status: "success" });
      return NextResponse.json({ success: true, imported: 0, skipped_duplicates, truncated_to: 250 });
    }

    const ins = await supabase.from("prospects").insert(insert);
    if (ins.error) return NextResponse.json({ success: false, error: ins.error.message || "Insert failed" }, { status: 500 });

    try {
      const foundCountRes = await supabase.from("prospects").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      await supabase.from("hunting_campaigns").update({ found_count: foundCountRes.count || null }).eq("id", id);
    } catch {}

    try {
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "import", result_summary: `imported=${insert.length}; skipped_duplicates=${skipped_duplicates}`, status: "success" });
    } catch {}

    return NextResponse.json({ success: true, imported: insert.length, skipped_duplicates, truncated_to: 250 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Import failed" }, { status: 500 });
  }
}
