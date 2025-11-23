import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

type AssessType = "enterprise" | "skills";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY as string | undefined;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as { type: AssessType; data: any };
    const type = body?.type;
    const data = body?.data || {};
    if (type !== "enterprise" && type !== "skills") return NextResponse.json({ success: false, error: "Invalid assessment type" }, { status: 400 });

    const groq = new Groq({ apiKey });
    const system =
      type === "enterprise"
        ? "You are an AI consultant. Generate an Enterprise AI Readiness analysis as concise markdown with sections: Executive Summary, Strengths, Gaps, Recommended 90-day Plan, Risk & Compliance, ROI Potential. Consider details provided."
        : "You are an AI consultant. Generate an AI Team Skills analysis as concise markdown with sections: Team Profile, Current Tooling, Skills Strengths, Skill Gaps, Training Plan, Hiring Recommendations. Consider details provided.";

    const userText = JSON.stringify(data, null, 2);
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Assessment input:\n\n${userText}` },
      ] as any,
      temperature: 0.2,
      max_tokens: 1200,
    });
    const report = completion.choices?.[0]?.message?.content || "";
    if (!report) return NextResponse.json({ success: false, error: "Model returned empty content" }, { status: 502 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    try {
      await supabase.from("assessments").insert({
        type,
        email: data?.email || null,
        company: data?.company || null,
        full_name: data?.fullName || null,
        data_json: data,
        report_markdown: report,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("assessments insert failed", e);
    }

    return NextResponse.json({ success: true, report });
  } catch (err: any) {
    console.error("assess API error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Assessment failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}