import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

type Body = { email?: string; deployment_type?: "free" | "paid" };

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    const resendKey = process.env.RESEND_API_KEY as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });
    if (!resendKey) return NextResponse.json({ success: false, error: "Missing RESEND_API_KEY" }, { status: 500 });

    const body = (await req.json()) as Body;
    const email = (body.email || "").trim().toLowerCase();
    const type = body.deployment_type === "paid" ? "paid" : "free";
    const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
    if (!email || !emailRegex.test(email)) return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const exists = await supabase.from("signups").select("id").eq("email", email).maybeSingle();
    if (exists.data?.id) return NextResponse.json({ success: true, message: "Already registered" });

    const ins = await supabase.from("signups").insert({ email, deployment_type: type, status: "pending", setup_completed: false });
    if (ins.error) return NextResponse.json({ success: false, error: ins.error.message || "Failed to save" }, { status: 500 });

    const resend = new Resend(resendKey);
    const html = `
      <div style="background:#0b0b0f;color:#e5e7eb;font-family:Inter,Arial,sans-serif;padding:24px">
        <div style="max-width:640px;margin:0 auto;background:#12131a;border:1px solid rgba(255,255,255,0.08);border-radius:12px">
          <div style="padding:24px">
            <h2 style="margin:0 0 8px 0;color:#fff;font-size:20px">Welcome to Tuple AI – Free AI Sales Agent</h2>
            <p style="margin:0 0 12px 0">You're set to deploy the ${type === "free" ? "Free" : "Pro"} version.</p>
            <div style="margin-top:12px">
              <div>• GitHub: <a href="https://github.com/" style="color:#60a5fa">Repository</a></div>
              <div>• Video guide: <a href="https://tuple.ai/guide" style="color:#60a5fa">Watch setup</a></div>
              <div>• API checklist: Groq, Supabase, Resend, Apollo, Hunter</div>
              <div>• Next steps: Open the guide and follow the steps</div>
            </div>
            <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">Need help? Reply to this email.</div>
          </div>
        </div>
      </div>`;

    await resend.emails.send({ from: `Tuple AI <noreply@tuple.ai>`, to: email, subject: `Your AI Sales Agent Setup Guide`, html });

    return NextResponse.json({ success: true, message: "Check your email!" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Signup failed" }, { status: 500 });
  }
}