import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
  timestamp?: string | Date;
}
interface RequestBody {
  conversation_id: string;
  prospect_email: string;
  messages: Message[];
}
interface ModelJson {
  report?: string;
  lead_score?: number;
  summary?: string;
}

const extractJson = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

const computeLeadScore = (text: string) => {
  let score = 0;
  const enterprise = /(enterprise|fortune|global|scale|budget|pricing|cost|roi|procurement|compliance)/i.test(text) ? 30 : 5;
  const decision = /(cto|chief|cpo|cfo|ceo|vp|director|head)/i.test(text) ? 25 : 5;
  const urgency = /(timeline|deadline|q[1-4]|soon|asap|urgent|this quarter|next quarter)/i.test(text) ? 20 : 5;
  const technical = /(stack|api|sdk|architecture|models|ml|ai|vector|embedding|pipeline|infra|kubernetes|serverless)/i.test(text) ? 15 : 5;
  const maturity = /(pilot|poC|production|fine-tune|retrieval|llm|prompt|agent|maturity)/i.test(text) ? 10 : 3;
  score = enterprise + decision + urgency + technical + maturity;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!apiKey) return NextResponse.json({ success: false, error: "Missing GROQ_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });

    const body = (await req.json()) as RequestBody;
    const { conversation_id, prospect_email, messages } = body || {};
    if (!conversation_id || typeof conversation_id !== "string") return NextResponse.json({ success: false, error: "Invalid conversation_id" }, { status: 400 });
    if (!prospect_email || typeof prospect_email !== "string") return NextResponse.json({ success: false, error: "Invalid prospect_email" }, { status: 400 });
    if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ success: false, error: "Invalid messages" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const existing = await supabase.from("conversations").select("id").eq("id", conversation_id).single();
    if (existing.error) return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });

    const groq = new Groq({ apiKey });
    const system =
      "You are an AI consultant analyzing a sales conversation. Based on the conversation, generate a professional AI Readiness Report.\n\n" +
      "Make it highly personalized - reference specific things they mentioned. Be consultative and helpful, not salesy.\n\n" +
      "The report should demonstrate deep expertise (the founder has 6 patents in AI) while being accessible.\n\n" +
      "Also provide:\n- A lead_score (0-100) based on enterprise signals, urgency, decision-maker role\n- A brief summary (1 sentence) of their main challenge\n\n" +
      "Return valid JSON with: { report: 'markdown content', lead_score: number, summary: 'one sentence' }";

    const convoText = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
    const groqMessages = [
      { role: "system", content: system },
      { role: "user", content: convoText },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: groqMessages,
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as ModelJson | null;
    if (!parsed || typeof parsed.report !== "string" || typeof parsed.summary !== "string") {
      return NextResponse.json({ success: false, error: "Model returned invalid JSON" }, { status: 502 });
    }

    const calculatedScore = computeLeadScore(convoText);
    const leadScore = Number.isFinite(parsed.lead_score as number) ? Math.round(calculatedScore) : Math.round(calculatedScore);

    const update = await supabase
      .from("conversations")
      .update({
        lead_score: leadScore,
        prospect_email,
        summary: parsed.summary,
        report: parsed.report,
        status: "report_generated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation_id);

    if (update.error) {
      console.error("generate-report update error", update.error);
      return NextResponse.json({ success: false, error: "Failed to update conversation" }, { status: 500 });
    }

    let downloadUrl = "";
    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const margin = 36;
      const pageWidth = 612;
      const pageHeight = 792;
      const lineHeight = 14;
      const maxLineChars = 90;
      const lines: string[] = [];
      parsed.report.split("\n").forEach((ln) => {
        if (ln.length <= maxLineChars) {
          lines.push(ln);
        } else {
          const words = ln.split(" ");
          let buf = "";
          for (const w of words) {
            if ((buf + w).length > maxLineChars) {
              lines.push(buf.trim());
              buf = w + " ";
            } else {
              buf += w + " ";
            }
          }
          if (buf.trim()) lines.push(buf.trim());
        }
      });
      let y = pageHeight - margin;
      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.setFont(font);
      page.setFontSize(11);
      for (const ln of lines) {
        if (y <= margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          page.setFont(font);
          page.setFontSize(11);
          y = pageHeight - margin;
        }
        page.drawText(ln, { x: margin, y: y - lineHeight });
        y -= lineHeight;
      }
      const pdfBytes = await pdfDoc.save();
      const base64 = Buffer.from(pdfBytes).toString("base64");
      downloadUrl = `data:application/pdf;base64,${base64}`;
    } catch (e) {
      console.error("PDF generation failed", e);
      const mdBase64 = Buffer.from(parsed.report, "utf-8").toString("base64");
      downloadUrl = `data:text/markdown;base64,${mdBase64}`;
    }

    return NextResponse.json({ success: true, report: parsed.report, lead_score: leadScore, summary: parsed.summary, download_url: downloadUrl });
  } catch (err: any) {
    console.error("generate-report error", err);
    const code = err?.status ?? 500;
    const message = typeof err?.message === "string" ? err.message : "Report generation failed";
    if (Number(code) === 429) return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}