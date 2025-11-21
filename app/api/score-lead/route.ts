import { NextResponse } from "next/server";
import Groq from "groq-sdk";

type LeadInput = {
  name: string;
  email: string;
  company: string;
  role: string;
  pain_points: string;
};

const extractJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY configuration" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { name, email, company, role, pain_points } = body ?? {};

    if (
      [name, email, company, role, pain_points].some(
        (v) => typeof v !== "string" || !v.trim()
      )
    ) {
      return NextResponse.json(
        { error: "Invalid input. Provide name, email, company, role, pain_points" },
        { status: 400 }
      );
    }

    const lead: LeadInput = {
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      role: role.trim(),
      pain_points: pain_points.trim(),
    };

    const client = new Groq({ apiKey });

    const system =
      "You are a B2B sales lead scorer. Score 0-100 strictly based on this rubric: " +
      "enterprise company signals (50 points), decision-maker role (30 points), AI pain points relevance (20 points). " +
      "Return only JSON with keys: score (integer 0-100), reasoning (short string), priority (high|medium|low).";

    const user = `Lead data:\nName: ${lead.name}\nEmail: ${lead.email}\nCompany: ${lead.company}\nRole: ${lead.role}\nPain Points: ${lead.pain_points}`;

    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);

    let score = 0;
    let reasoning = "";
    let priority = "low";

    if (parsed) {
      score = Number(parsed.score ?? 0);
      if (!Number.isFinite(score)) score = 0;
      if (score < 0) score = 0;
      if (score > 100) score = 100;
      reasoning = String(parsed.reasoning ?? "");
      priority = String(parsed.priority ?? "");
    }

    if (!priority || !["high", "medium", "low"].includes(priority)) {
      priority = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
    }

    return NextResponse.json({ score, reasoning, priority });
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Failed to score lead";
    console.error("score-lead error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}