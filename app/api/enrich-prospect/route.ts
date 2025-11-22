import { NextResponse } from "next/server";
import Groq from "groq-sdk";

type Prospect = {
  name?: string;
  title?: string;
  company?: string;
  company_size?: string;
  industry?: string;
  linkedin_url?: string;
  email?: string;
  phone?: string;
  location?: string;
  recent_activity?: string;
  pain_points?: string;
  tech_stack?: string;
  source?: string;
};

type EnrichResponse = {
  success: boolean;
  ai_score?: number;
  reasoning?: string;
  prospect?: Prospect;
  error?: string;
};

const computeFallbackScore = (p: Prospect) => {
  const text = [p.title, p.company, p.industry, p.recent_activity, p.pain_points, p.tech_stack].filter(Boolean).join("\n");
  let score = 0;
  const senior = /(cto|chief|cso|cpo|cfo|ceo|vp|director|head)/i.test(text) ? 25 : 5;
  const enterprise = /(1000\+|enterprise|global|fortune|scale|compliance|security|budget|roi)/i.test(text) ? 30 : 10;
  const activity = /(launched|pilot|poc|production|ml|ai|llm|agent|vector|embedding|architecture|kubernetes)/i.test(text) ? 25 : 5;
  const urgency = /(timeline|deadline|soon|asap|q[1-4]|this quarter|next quarter)/i.test(text) ? 20 : 5;
  score = senior + enterprise + activity + urgency;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" } as EnrichResponse, { status: 500 });

    const prospect = (await req.json()) as Prospect;
    if (!prospect || typeof prospect !== "object") return NextResponse.json({ success: false, error: "Invalid prospect" } as EnrichResponse, { status: 400 });

    const groq = new Groq({ apiKey });
    const system =
      "You are an AI consultant. Analyze this prospect and score AI readiness 0-100. " +
      "Consider company profile, title seniority, industry fit, and recent activity/signals. " +
      "Return JSON: { ai_score: number, reasoning: string }.";

    const user = JSON.stringify(prospect);
    let aiScore = 0;
    let reasoning = "";
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: 512,
      });
      const content = completion.choices?.[0]?.message?.content ?? "";
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        aiScore = Number(parsed.ai_score ?? 0);
        reasoning = String(parsed.reasoning ?? "");
      } else {
        aiScore = computeFallbackScore(prospect);
        reasoning = "Heuristic score based on provided signals.";
      }
      if (!Number.isFinite(aiScore)) aiScore = computeFallbackScore(prospect);
      if (aiScore < 0) aiScore = 0;
      if (aiScore > 100) aiScore = 100;
    } catch (err) {
      aiScore = computeFallbackScore(prospect);
      reasoning = "Model error; used heuristic scoring.";
    }

    return NextResponse.json({ success: true, ai_score: aiScore, reasoning, prospect } as EnrichResponse);
  } catch (err: any) {
    console.error("enrich-prospect error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Enrichment failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" } as EnrichResponse, { status: 429 });
    return NextResponse.json({ success: false, error: message } as EnrichResponse, { status: 500 });
  }
}