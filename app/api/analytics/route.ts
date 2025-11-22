import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = { event?: string; email?: string; meta?: Record<string, any> };

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false, error: "Missing Supabase configuration" }, { status: 500 });
    const body = (await req.json()) as Body;
    const event = (body.event || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    if (!event) return NextResponse.json({ success: false, error: "Invalid event" }, { status: 400 });
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const ins = await supabase.from("analytics").insert({ event, email: email || null, meta: body.meta || null, occurred_at: new Date().toISOString() });
    if (ins.error) return NextResponse.json({ success: false, error: ins.error.message || "Failed to save" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Analytics failed" }, { status: 500 });
  }
}