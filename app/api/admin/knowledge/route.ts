import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { isAdminUser } from "@/lib/auth/admin-check";
import { createAdminClient } from "@/lib/server/supabase-admin";
import OpenAI from "openai";

function chunkText(input: string) {
  const text = String(input || "").replace(/\r/g, "").trim();
  if (!text) return [];
  const maxLen = 1100;
  const overlap = 200;
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + "\n\n" + p).length <= maxLen) {
      buf = buf ? `${buf}\n\n${p}` : p;
      continue;
    }
    if (buf) chunks.push(buf);
    if (p.length <= maxLen) {
      buf = p;
      continue;
    }
    let i = 0;
    while (i < p.length) {
      const slice = p.slice(i, i + maxLen);
      chunks.push(slice);
      i += Math.max(1, maxLen - overlap);
    }
    buf = "";
  }
  if (buf) chunks.push(buf);
  return chunks.slice(0, 500);
}

async function extractTextFromFile(file: File) {
  const name = String(file.name || "");
  const ct = String((file as any).type || "").toLowerCase();
  const isPdf = ct.includes("pdf") || name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return await file.text();

  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const mod: any = await import("pdf-parse").catch(() => null);
  if (!mod) throw new Error("Missing pdf-parse dependency");
  const pdfParse = mod.default || mod;
  const parsed = await pdfParse(buf);
  return String(parsed?.text || "").trim();
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
  const res = await admin.from("knowledge_documents").select("id,created_at,name,source,content_type,status").order("created_at", { ascending: false }).limit(50);
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ success: true, documents: res.data || [] });
}

export async function POST(req: NextRequest) {
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html");
  if (!demoMode) {
    const sessionClient = createRouteHandlerClient({ cookies });
    const { data: userData } = await sessionClient.auth.getUser();
    const user = userData.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ok = await isAdminUser(sessionClient as any, user.id);
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: "Missing OPENAI_API_KEY (required for embeddings)" }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const source = String(form.get("source") || "").trim() || null;
  if (!file || !(file instanceof File)) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  let text = "";
  try {
    text = await extractTextFromFile(file);
  } catch (e: any) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: e?.message || "Failed to parse document" }, { status: 400 });
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: "No text extracted from document" }, { status: 400 });
  }

  const admin = createAdminClient();
  const docIns = await admin
    .from("knowledge_documents")
    .insert({ name: file.name || "document", source, content_type: (file as any).type || null, content_text: text })
    .select("id")
    .single();
  if (docIns.error) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: docIns.error.message }, { status: 500 });
  }
  const documentId = String((docIns.data as any)?.id || "");

  const openai = new OpenAI({ apiKey });
  const emb = await openai.embeddings.create({ model: "text-embedding-3-small", input: chunks });
  const vectors = (emb.data || []).map((d: any) => d.embedding);
  if (vectors.length !== chunks.length) return NextResponse.json({ error: "Embedding generation failed" }, { status: 502 });

  const rows = chunks.map((content, idx) => ({
    document_id: documentId,
    chunk_index: idx,
    content,
    embedding: `[${(vectors[idx] as number[]).join(",")}]`,
  }));
  const ins = await admin.from("knowledge_chunks").insert(rows);
  if (ins.error) {
    if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  if (wantsHtml) return NextResponse.redirect(new URL(`/admin#knowledge`, req.url), 303);
  return NextResponse.json({ success: true, document_id: documentId, chunks: chunks.length });
}
