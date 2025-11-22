import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

type ProspectInput = {
  name?: string;
  title?: string;
  company?: string;
  industry?: string;
  recent_activity?: string;
  pain_points?: string;
  source?: string;
  prospect_id?: string;
};

type OutreachResult = {
  email_body: string;
  subject_lines: string[];
  personalization_score: number;
  confidence_score: number;
  reasoning: string;
};

const extractJson = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as ProspectInput;
    const { name, title, company, industry, recent_activity, pain_points, source, prospect_id } = body || {};
    if (!name || !company) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    const groq = new Groq({ apiKey });
    const system =
      "You are an expert at writing personalized cold outreach emails for enterprise AI sales.\n\n" +
      "Rules:\n- Reference something SPECIFIC about their company or recent activity\n- Identify a likely pain point for their role/industry\n- Mention relevant experience (6 patents in AI) naturally\n- Soft CTA: offer value first (assessment, insights, resource)\n- Tone: Peer-to-peer consultant, NOT salesperson\n- Length: 70-100 words MAX\n- No buzzwords or hype\n- Sound human and thoughtful\n\n" +
      "The founder has 6 patents in:\n- Enterprise AI architecture\n- ML model deployment at scale\n- AI governance frameworks\n\nRecent case studies:\n- Fintech company: 40% cost reduction in AI infrastructure\n- Healthcare: HIPAA-compliant AI implementation\n- Manufacturing: Predictive maintenance AI (3x ROI)\n\n" +
      "Email structure:\n1) Specific observation about them/company\n2-3) Relevant challenge/opportunity\n4) Brief credibility (patent or case study)\n5) Soft ask with value offer\nSignature: Just name + \"AI Architect, 6 Patents\"\n\n" +
      "Subject lines:\n- Insight-based: \"[Insight] about [their company]'s AI strategy\"\n- Question-based: \"Quick question about [specific challenge]\"\n- Value-based: \"[Resource] for [their role] at [company]\"\n\n" +
      "Return JSON only: { email_body: string, subject_lines: string[], personalization_score: number, confidence_score: number, reasoning: string }\n\n" +
      "Good examples:\n- \"Noticed your team open-sourced an inference toolkit last week. Many teams at your scale hit latency and cost tradeoffs—happy to share a 30-minute assessment we used to cut infra costs 40% at a fintech. I'm an AI architect (6 patents). Want a quick audit checklist?\"\n\n" +
      "Bad examples:\n- \"We are the leading AI platform to revolutionize your workflows!!!\"\n- \"Let's hop on a call to discuss synergies.\"\n";

    const user = JSON.stringify({ name, title, company, industry, recent_activity, pain_points, source });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as OutreachResult | null;
    if (!parsed || !Array.isArray(parsed.subject_lines) || typeof parsed.email_body !== "string") {
      return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 502 });
    }

    const personalization_score = Math.max(0, Math.min(100, Number(parsed.personalization_score ?? 0)));
    const confidence_score = Math.max(0, Math.min(100, Number(parsed.confidence_score ?? 0)));
    const result: OutreachResult = {
      email_body: parsed.email_body,
      subject_lines: parsed.subject_lines.slice(0, 3),
      personalization_score,
      confidence_score,
      reasoning: parsed.reasoning ?? "",
    };

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const insertPayload = {
      prospect_id: prospect_id || null,
      subject_lines: result.subject_lines,
      body: result.email_body,
      personalization_score: result.personalization_score,
      confidence_score: result.confidence_score,
      status: "draft",
    };
    const insertRes = await supabase.from("email_drafts").insert(insertPayload);
    if (insertRes.error) {
      console.error("generate-outreach save error", insertRes.error);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("generate-outreach error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Outreach generation failed";
    if (Number(code) === 429) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}