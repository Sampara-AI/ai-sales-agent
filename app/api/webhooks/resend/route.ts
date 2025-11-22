import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: any;
};

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ success: false }, { status: 500 });
    const body = (await req.json()) as ResendEvent;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const tags = body?.data?.tags || [];
    const tagMap: Record<string, string> = {};
    for (const t of tags) tagMap[t.name] = t.value;
    const prospectId = tagMap["prospect_id"];
    const emailDraftId = tagMap["email_draft_id"];

    if (body.type === "email.opened") {
      if (prospectId) await supabase.from("email_campaigns").update({ opened_at: new Date().toISOString(), status: "opened" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
      await supabase.from("prospects").update({ email_opened: true }).eq("id", prospectId);
    } else if (body.type === "email.clicked") {
      if (prospectId) await supabase.from("email_campaigns").update({ clicked_at: new Date().toISOString(), status: "clicked" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
      await supabase.from("prospects").update({ email_clicked: true }).eq("id", prospectId);
    } else if (body.type === "email.bounced") {
      if (prospectId) await supabase.from("email_campaigns").update({ bounced: true, status: "bounced" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
    } else if (body.type === "email.replied") {
      if (prospectId) {
        await supabase.from("email_campaigns").update({ replied_at: new Date().toISOString(), status: "replied" }).eq("prospect_id", prospectId).order("sent_at", { ascending: false }).limit(1);
        await supabase.from("prospects").update({ replied: true }).eq("id", prospectId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("resend webhook error", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}