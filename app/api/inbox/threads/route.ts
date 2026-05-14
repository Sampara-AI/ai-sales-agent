import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createAdminClient } from "@/lib/server/supabase-admin";

export async function GET(req: NextRequest) {
  const internalSecret = String(process.env.INTERNAL_API_KEY || "").trim();
  const internalHeader = String(req.headers.get("x-internal-secret") || "").trim();
  const isInternal = !!internalSecret && internalHeader === internalSecret;

  if (!isInternal) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const threads = await admin
    .from("inbox_threads")
    .select("id,mailbox,external_id,subject,prospect_id,last_message_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (threads.error) return NextResponse.json({ error: threads.error.message }, { status: 500 });

  const ids = ((threads.data || []) as any[]).map((t) => String(t.external_id || "")).filter(Boolean);
  let messages: any[] = [];
  if (ids.length > 0) {
    const msgs = await admin
      .from("inbox_messages")
      .select("id,created_at,mailbox,thread_external_id,external_id,direction,from_email,to_email,subject,snippet,intent,escalated,ai_confidence,ai_summary,ai_next_action,ai_draft_subject,ai_draft_body,knowledge_refs,processed_at")
      .in("thread_external_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    messages = (msgs.data || []) as any[];
  }

  return NextResponse.json({ success: true, threads: threads.data || [], messages });
}

