import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

type Body = { name?: string; email?: string; preferred_time?: string };

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    const resendKey = process.env.RESEND_API_KEY as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });
    if (!resendKey) return NextResponse.json({ success: false, error: "Missing RESEND_API_KEY" }, { status: 500 });

    const body = (await req.json()) as Body;
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const preferred_time = (body.preferred_time || "").trim();
    const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
    if (!name || !email || !emailRegex.test(email)) return NextResponse.json({ success: false, error: "Invalid form" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const ins = await supabase.from("setup_calls").insert({ name, email, preferred_time, status: "requested" });
    if (ins.error) return NextResponse.json({ success: false, error: ins.error.message || "Failed to save" }, { status: 500 });

    const resend = new Resend(resendKey);
    const notifyTo = process.env.ADMIN_EMAIL || "founders@tupleai.co.in";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif">
        <h3>New Setup Call Request</h3>
        <div>Name: ${name}</div>
        <div>Email: ${email}</div>
        <div>Preferred time: ${preferred_time || "n/a"}</div>
      </div>`;
    await resend.emails.send({ from: `Tuple AI <noreply@tuple.ai>`, to: notifyTo, subject: `Setup Call Requested`, html });

    return NextResponse.json({ success: true, message: "Booked! We’ll confirm by email." });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Setup call failed" }, { status: 500 });
  }
}