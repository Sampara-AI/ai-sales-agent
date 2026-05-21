import { Nunito_Sans } from "next/font/google";
import { createAdminClient } from "@/lib/server/supabase-admin";
import GuidedWorkflowClient from "./GuidedWorkflowClient";

export const dynamic = "force-dynamic";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type StepKey = "upload" | "enrich" | "generate" | "review" | "approve" | "send";

export default async function HuntingDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const admin = createAdminClient();
  const campaignsRes = await admin.from("hunting_campaigns").select("id,name,created_at").order("created_at", { ascending: false });
  const campaigns = (campaignsRes.data || []) as Array<{ id: string; name: string | null }>;

  const selectedCampaignIdRaw = typeof searchParams?.campaign === "string" ? searchParams?.campaign : "";
  const campaignId = selectedCampaignIdRaw.trim() || String(campaigns?.[0]?.id || "").trim();

  const stepRaw = typeof searchParams?.step === "string" ? searchParams?.step : "";
  const step = String(stepRaw || "upload").trim().toLowerCase() as StepKey;
  const initialStep: StepKey =
    step === "upload" || step === "enrich" || step === "generate" || step === "review" || step === "approve" || step === "send" ? step : "upload";

  if (!campaignId) {
    return (
      <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">No campaigns found.</div>
        </div>
      </div>
    );
  }

  const prospectsRes = await admin
    .from("prospects")
    .select("id,created_at,name,title,company,email,domain,status,recent_activity,last_email_sent")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(250);
  const initialProspects = (prospectsRes.data || []) as any[];

  const ids = initialProspects.map((p) => String(p.id || "")).filter(Boolean);
  const draftsRes =
    ids.length > 0
      ? await admin
          .from("email_drafts")
          .select("id,prospect_id,subject_lines,body,status,created_at")
          .in("prospect_id", ids)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(500)
      : ({ data: [], error: null } as any);
  const draftsByProspect: Record<string, any> = {};
  for (const d of (draftsRes.data || []) as any[]) {
    const pid = String(d.prospect_id || "").trim();
    if (!pid) continue;
    if (!draftsByProspect[pid]) draftsByProspect[pid] = d;
  }
  const initialDrafts = Object.values(draftsByProspect);

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <GuidedWorkflowClient
          campaigns={campaigns}
          initialCampaignId={campaignId}
          initialProspects={initialProspects}
          initialDrafts={initialDrafts as any}
          initialStep={initialStep}
        />
      </div>
    </div>
  );
}
