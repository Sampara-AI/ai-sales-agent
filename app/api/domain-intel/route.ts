import { NextResponse } from "next/server";
import Groq from "groq-sdk";

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 180) : "";
}

function extractMetaDescription(html: string) {
  const m =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  return m ? String(m[1]).trim().slice(0, 280) : "";
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });

    const body = (await req.json().catch(() => ({}))) as { domain?: string; product?: string; context?: string };
    const domain = String(body?.domain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return NextResponse.json({ success: false, error: "Missing domain" }, { status: 400 });

    let html = "";
    const candidates = [`https://${domain}`, `http://${domain}`];
    for (const u of candidates) {
      try {
        const res = await fetchWithTimeout(u, 8000);
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml\+xml/i.test(ct)) continue;
        html = await res.text();
        if (html) break;
      } catch {}
    }

    const title = html ? extractTitle(html) : "";
    const description = html ? extractMetaDescription(html) : "";
    const pageText = html ? stripTags(html).slice(0, 4000) : "";

    const groq = new Groq({ apiKey: groqKey });
    const system =
      "You are a GTM research assistant. Given a company domain and website snippets, produce concise domain intelligence for cold outreach.\n" +
      "Return JSON only: { company_summary: string, personalization_hooks: string[], likely_buyer_roles: string[], caveats: string[] }.\n" +
      "Rules:\n" +
      "- company_summary: 2-3 sentences max\n" +
      "- personalization_hooks: 3-5 bullets, specific and safe (no hallucinations)\n" +
      '- if enrichment signals are unavailable, add a caveat like: "Additional enrichment signals unavailable. Using imported context + domain intelligence."\n';

    const user = JSON.stringify({
      domain,
      title,
      description,
      page_text: pageText,
      product: body?.product || "VPersonalize",
      context: body?.context || "mass personalization, 3D product configurator, and on-demand manufacturing automation",
    });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 700,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ success: false, error: "Model returned invalid JSON" }, { status: 502 });

    const parsed = JSON.parse(match[0]);
    return NextResponse.json({ success: true, domain, title, description, ...parsed });
  } catch (err: any) {
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Domain intel failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
