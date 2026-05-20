import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { isAdminUser } from "@/lib/auth/admin-check";

type AiSettings = {
  brand_name: string;
  brand_website: string;
  brand_one_liner: string;
  tone: string;
  cta_text: string;
  cta_url: string;
  qualification_line: string;
  sender_name: string;
  sender_title: string;
  sender_company: string;
  credibility_line: string;
  temperature: number;
  max_tokens: number;
  banned_phrases: string[];
};

function defaults(): AiSettings {
  const brandUrl = String(process.env.EMAIL_BRAND_URL || process.env.NEXT_PUBLIC_BRAND_URL || "https://www.vpersonalize.com").trim();
  const fromName = String(process.env.DEFAULT_FROM_NAME || "VPersonalize").trim();
  return {
    brand_name: String(process.env.NEXT_PUBLIC_BRAND_NAME || "VPersonalize").trim(),
    brand_website: brandUrl,
    brand_one_liner: String(process.env.NEXT_PUBLIC_BRAND_ONE_LINER || "Custom teamwear & merch made easy for clubs, teams, and brands.").trim(),
    tone: "Exciting and confident, not pushy. Value-first. Sound human. Keep it concise. No hype.",
    cta_text: String(process.env.EMAIL_FOOTER_LINK_TEXT || "Book a quick 15-minute chat").trim(),
    cta_url: String(process.env.EMAIL_FOOTER_LINK_URL || "https://cal.com/vpersonalize/intro").trim(),
    qualification_line: "If helpful, what product type are you considering, what size range, and roughly how many units?",
    sender_name: fromName,
    sender_title: String(process.env.EMAIL_SIGNATURE_TITLE || "Partnerships").trim(),
    sender_company: String(process.env.EMAIL_SIGNATURE_COMPANY || "VPersonalize").trim(),
    credibility_line: String(process.env.EMAIL_CREDIBILITY_LINE || "We help teams launch on-brand customization without operational headaches.").trim(),
    temperature: 0.55,
    max_tokens: 700,
    banned_phrases: ["Tuple AI", "6 patents", "AI Architect"],
  };
}

function sanitize(input: any): AiSettings {
  const d = defaults();
  const obj = input && typeof input === "object" ? input : {};
  const arr = Array.isArray(obj.banned_phrases) ? obj.banned_phrases : d.banned_phrases;
  const t = Number(obj.temperature ?? d.temperature);
  const mt = Number(obj.max_tokens ?? d.max_tokens);
  return {
    brand_name: String(obj.brand_name ?? d.brand_name).trim(),
    brand_website: String(obj.brand_website ?? d.brand_website).trim(),
    brand_one_liner: String(obj.brand_one_liner ?? d.brand_one_liner).trim(),
    tone: String(obj.tone ?? d.tone).trim(),
    cta_text: String(obj.cta_text ?? d.cta_text).trim(),
    cta_url: String(obj.cta_url ?? d.cta_url).trim(),
    qualification_line: String(obj.qualification_line ?? d.qualification_line).trim(),
    sender_name: String(obj.sender_name ?? d.sender_name).trim(),
    sender_title: String(obj.sender_title ?? d.sender_title).trim(),
    sender_company: String(obj.sender_company ?? d.sender_company).trim(),
    credibility_line: String(obj.credibility_line ?? d.credibility_line).trim(),
    temperature: Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : d.temperature,
    max_tokens: Number.isFinite(mt) ? Math.max(200, Math.min(1200, mt)) : d.max_tokens,
    banned_phrases: arr.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 30),
  };
}

export async function GET() {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    const user = userData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await isAdminUser(sessionClient as any, user.id);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  try {
    const res = await admin
      .from("audit_events")
      .select("meta,created_at")
      .eq("action", "ai_settings")
      .order("created_at", { ascending: false })
      .limit(1);
    if (res.error) return NextResponse.json({ success: true, settings: defaults(), source: "defaults" });
    const meta = ((res.data || []) as any[])[0]?.meta;
    const settings = meta ? sanitize(meta) : defaults();
    return NextResponse.json({ success: true, settings, source: meta ? "db" : "defaults" });
  } catch {
    return NextResponse.json({ success: true, settings: defaults(), source: "defaults" });
  }
}

export async function POST(req: NextRequest) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  if (!demoMode) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    const user = userData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await isAdminUser(sessionClient as any, user.id);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const settings = sanitize(body?.settings ?? body);
  const admin = createAdminClient();
  try {
    const ins = await admin.from("audit_events").insert({
      actor_user_id: null,
      actor_email: "demo@local",
      action: "ai_settings",
      entity_type: "settings",
      entity_id: "ai_settings",
      meta: settings,
    });
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save settings" }, { status: 500 });
  }

  return NextResponse.json({ success: true, settings });
}
