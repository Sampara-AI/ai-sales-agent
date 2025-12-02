"use client";
import { Nunito_Sans } from "next/font/google";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

export default function HunterHelpPage() {
  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-6 text-2xl font-semibold">Hunter – Quick Guide</div>
        <div className="space-y-6 text-sm">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-2 text-lg font-semibold">Local Demo</div>
            <ul className="list-disc space-y-2 pl-5">
              <li>Open Dashboard → Hunting → + Create New Campaign.</li>
              <li>Fill targeting: Titles, Industries, Locations, Company size, Keywords.</li>
              <li>Set limits: Daily prospects, Minimum AI score, Email/day, Follow-ups.</li>
              <li>Click Save as Draft or Activate Campaign. Use Schedule Start to set a future start time.</li>
              <li>On Hunting, click ▶️ Run Now to discover prospects.</li>
              <li>Use Prospects tab to view leads. Supabase table: prospects.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-2 text-lg font-semibold">Production Flow</div>
            <ul className="list-disc space-y-2 pl-5">
              <li>Sign up and verify email, then sign in.</li>
              <li>Create a campaign and activate it.</li>
              <li>Run a hunt, then generate and send emails from Dashboard.</li>
              <li>Track status: discovered, email_ready, replied, meeting_booked.</li>
              <li>Limits: Free 2 hunts/month, Pro 10 hunts/month.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
            <div className="mb-2 text-lg font-semibold">Where Data Lives</div>
            <ul className="list-disc space-y-2 pl-5">
              <li>Campaigns: hunting_campaigns</li>
              <li>Runs: hunting_campaign_runs</li>
              <li>Leads: prospects</li>
              <li>Emails: email_campaigns</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
