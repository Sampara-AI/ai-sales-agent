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
    return await fetch(url, { signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchDomainHtml(domain: string) {
  const d = String(domain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return { domain: "", html: "", title: "", description: "", pageText: "" };

  let html = "";
  const candidates = [`https://${d}`, `http://${d}`];
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
  return { domain: d, html, title, description, pageText };
}

export async function summarizeDomain(input: { domain: string; title?: string; description?: string; pageText?: string }) {
  const groqKey = process.env.GROQ_API_KEY as string | undefined;
  if (!groqKey) throw new Error("Missing GROQ_API_KEY");

  const groq = new Groq({ apiKey: groqKey });
  const system =
    "You are a GTM research assistant. Summarize the company from domain evidence only. Return JSON only: " +
    '{ company_summary: string, personalization_hooks: string[], likely_buyer_roles: string[], caveats: string[] }. ' +
    "company_summary must be 2-3 sentences max. personalization_hooks must be 3-5 short bullets. No hallucinations.";

  const user = JSON.stringify({
    domain: input.domain,
    title: input.title || "",
    description: input.description || "",
    page_text: input.pageText || "",
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
  if (!match) throw new Error("Model returned invalid JSON");
  return JSON.parse(match[0]) as {
    company_summary?: string;
    personalization_hooks?: string[];
    likely_buyer_roles?: string[];
    caveats?: string[];
  };
}

