import { NextResponse } from "next/server";
import Groq from "groq-sdk";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 });
    }

    const body = await req.json();
    const messages = body?.messages as ChatMessage[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
    }

    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.3,
      max_tokens: 512,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ content });
  } catch (err: any) {
    const code = err?.status ?? err?.code ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Chat error";
    if (Number(code) === 429) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }
    console.error("chat route error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}