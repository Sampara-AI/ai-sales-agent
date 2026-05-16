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

function extractMissingColumnName(message: string) {
  const msg = String(message || "");
  const m =
    msg.match(/Could not find the '([^']+)' column of 'prospects'/) ||
    msg.match(/column \"([^\"]+)\" of relation \"prospects\" does not exist/i) ||
    msg.match(/column \"([^\"]+)\" does not exist/i);
  return m?.[1] ? String(m[1]) : "";
}

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

function cleanCell(v: string) {
  let s = String(v || "").trim();
  if (!s) return "";
  if ((s.startsWith("`") && s.endsWith("`")) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

function splitLine(line: string, delimiter: "," | "\t") {
  if (delimiter === ",") return parseCsvLine(line).map(cleanCell);
  return line.split("\t").map((s) => cleanCell(s));
}

function detectDelimiter(lines: string[]) {
  const sample = lines.find((l) => l.trim().length > 0) || "";
  const tabs = (sample.match(/\t/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function deriveDomain(email?: string, domain?: string) {
  const d = cleanCell(String(domain || ""));
  if (d) return d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  const e = cleanCell(String(email || ""));
  const at = e.indexOf("@");
  if (at === -1) return "";
  return e.slice(at + 1).replace(/^www\./, "").toLowerCase();
}

function safeEmail(email?: string) {
  const e = cleanCell(String(email || ""));
  if (!e) return "";
  const ok = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(e);
  return ok ? e : "";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const supabase = demoMode ? createAdminClient() : createRouteHandlerClient({ cookies });
  const id = String((await params)?.id || "").trim();
  if (!id) return NextResponse.json({ success: false, error: "Invalid campaign id" }, { status: 400 });
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html");

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
    if (lines.length < 1) return NextResponse.json({ success: false, error: "CSV has no rows" }, { status: 400 });

    const delimiter = detectDelimiter(lines);
    const headers = splitLine(lines[0], delimiter).map(normalizeHeader);
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
    const hasHeaderMapping = iEmail !== -1 || iDomain !== -1 || iCompany !== -1 || iName !== -1 || iFirst !== -1 || iLast !== -1;
    const dataLines = hasHeaderMapping ? lines.slice(1) : lines;
    for (const line of dataLines) {
      const cols = splitLine(line, delimiter);

      let email = "";
      let domain = "";
      let name = "";
      let company = "";
      let title = "";
      let industry = "";
      let linkedin_url = "";
      let notes = "";

      if (hasHeaderMapping) {
        email = safeEmail(cols[iEmail] || "").toLowerCase();
        domain = deriveDomain(email, cols[iDomain] || "");
        name =
          cleanCell(cols[iName] || "") ||
          `${cleanCell(cols[iFirst] || "")} ${cleanCell(cols[iLast] || "")}`.trim() ||
          "";
        company = cleanCell(cols[iCompany] || "") || (domain ? domain.replace(/^www\./, "") : "");
        title = cleanCell(cols[iTitle] || "");
        industry = cleanCell(cols[iIndustry] || "");
        linkedin_url = cleanCell(cols[iLinkedin] || "");
        notes = cleanCell(cols[iNotes] || "");
      } else {
        const first = cleanCell(cols[0] || "");
        const second = cleanCell(cols[1] || "");
        const third = cleanCell(cols[2] || "");
        const maybeEmail = safeEmail(first) || safeEmail(second) || safeEmail(third);
        email = maybeEmail.toLowerCase();
        const maybeDomain = email ? "" : first;
        domain = deriveDomain(email, maybeDomain || first);
        company = domain ? domain.replace(/^www\./, "") : "";
        name = "";
        notes = "";
      }

      if (!email && !domain && !company && !name) continue;
      const key = domain ? `${domain}|${email || ""}` : email ? `|${email}` : "";
      if (key) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      rows.push({ email, domain, company, name, title, industry, linkedin_url, notes });
    }

    if (rows.length === 0) {
      if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?import=0&campaign=${encodeURIComponent(id)}`, req.url), 303);
      return NextResponse.json({ success: false, error: "No valid rows found. Use headers domain,email or upload a 2-column list (domain/email) separated by comma or tab." }, { status: 400 });
    }

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
      if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?import=0&skipped=${skipped_duplicates}&campaign=${encodeURIComponent(id)}`, req.url), 303);
      return NextResponse.json({ success: true, imported: 0, skipped_duplicates, truncated_to: 250 });
    }

    let attemptRows = insert.map((r) => ({ ...r })) as Record<string, any>[];
    let lastErr: any = null;
    for (let i = 0; i < 12; i++) {
      const ins = await supabase.from("prospects").insert(attemptRows);
      if (!ins.error) { lastErr = null; break; }
      lastErr = ins.error;
      const missing = extractMissingColumnName(ins.error.message || "");
      if (missing && Object.prototype.hasOwnProperty.call(attemptRows[0] || {}, missing)) {
        attemptRows = attemptRows.map((r) => {
          const next = { ...r };
          delete next[missing];
          return next;
        });
        continue;
      }
      break;
    }
    if (lastErr) return NextResponse.json({ success: false, error: lastErr.message || "Insert failed" }, { status: 500 });

    try {
      const foundCountRes = await supabase.from("prospects").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      await supabase.from("hunting_campaigns").update({ found_count: foundCountRes.count || null }).eq("id", id);
    } catch {}

    try {
      await supabase.from("hunting_campaign_runs").insert({ campaign_id: id, run_type: "import", result_summary: `imported=${insert.length}; skipped_duplicates=${skipped_duplicates}`, status: "success" });
    } catch {}

    if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?import=${insert.length}&skipped=${skipped_duplicates}&campaign=${encodeURIComponent(id)}`, req.url), 303);
    return NextResponse.json({ success: true, imported: insert.length, skipped_duplicates, truncated_to: 250 });
  } catch (err: any) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/dashboard/hunting?import=failed&campaign=${encodeURIComponent(id)}`, req.url), 303);
    return NextResponse.json({ success: false, error: err?.message || "Import failed" }, { status: 500 });
  }
}
