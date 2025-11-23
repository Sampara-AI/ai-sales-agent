"use client";
import { useEffect, useMemo, useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type Step = 1 | 2 | 3 | 4 | 5;

type CampaignData = {
  name?: string;
  description?: string;
  titles: string[];
  industries: string[];
  locations: string[];
  sizeMin: number;
  sizeMax: number;
  keywords: string[];
  excludeCompanies: string[];
  dailyProspectLimit: number;
  minAiScore: number;
  emailDailyLimit: number;
  sendWeekends: boolean;
  enableFollowups: boolean;
  followupDays: number[];
  maxFollowups: number;
  scheduleStart?: string;
};

const defaultTitles = ["CTO","VP Engineering","Head of AI","Director of AI/ML","Chief Data Officer"];
const industryOptions = ["SaaS","Fintech","Healthcare","E-commerce","Manufacturing","Technology","Consulting","Other"];
const locationOptions = ["United States","United Kingdom","Canada","India","Australia","Germany","France","Singapore","Remote/Global"];

const LS_KEY = "campaign_create_v1";

export default function CreateCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [searchLocation, setSearchLocation] = useState("");
  const [data, setData] = useState<CampaignData>({
    titles: defaultTitles,
    industries: [],
    locations: [],
    sizeMin: 1,
    sizeMax: 50000,
    keywords: [],
    excludeCompanies: [],
    dailyProspectLimit: 20,
    minAiScore: 70,
    emailDailyLimit: 10,
    sendWeekends: false,
    enableFollowups: true,
    followupDays: [3,7,14],
    maxFollowups: 3,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data) setData(parsed.data);
        if (parsed?.step) setStep(parsed.step);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      setSaving(true);
      localStorage.setItem(LS_KEY, JSON.stringify({ step, data }));
    } finally {
      setSaving(false);
    }
  }, [step, data]);

  const totalSteps = 5;
  const progress = Math.round((step / totalSteps) * 100);

  const addTag = (key: keyof CampaignData, value: string) => {
    const v = value.trim();
    if (!v) return;
    setData((d) => ({ ...d, [key]: Array.from(new Set([...(d[key] as string[]), v])) }));
  };
  const removeTag = (key: keyof CampaignData, value: string) => {
    setData((d) => ({ ...d, [key]: (d[key] as string[]).filter((x) => x !== value) }));
  };

  const validate = (s: Step) => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!data.name || !data.name.trim()) e.name = "Enter a name";
    } else if (s === 2) {
      if (!data.titles.length) e.titles = "Add at least one job title";
      if (!data.industries.length) e.industries = "Choose at least one industry";
      if (!data.locations.length) e.locations = "Choose at least one location";
      if (data.sizeMin < 1 || data.sizeMax < data.sizeMin) e.size = "Check company size range";
    } else if (s === 3) {
      if (data.dailyProspectLimit < 5 || data.dailyProspectLimit > 100) e.dailyProspectLimit = "Set between 5-100";
      if (data.minAiScore < 0 || data.minAiScore > 100) e.minAiScore = "Set 0-100";
    } else if (s === 4) {
      if (data.emailDailyLimit < 1) e.emailDailyLimit = "Set a positive limit";
      if (data.enableFollowups) {
        if (!data.followupDays.length) e.followupDays = "Add follow-up days";
        if (data.maxFollowups < 1) e.maxFollowups = "Set max follow-ups";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const breadthScore = useMemo(() => {
    const t = data.titles.length || 1;
    const i = data.industries.length || 1;
    const l = data.locations.length || 1;
    const k = data.keywords.length || 1;
    const combos = t * i * l;
    let estimate = combos * Math.max(1, k) * 2;
    if (estimate > 1500) estimate = 1500;
    return Math.round(estimate);
  }, [data.titles, data.industries, data.locations, data.keywords]);

  const dayEstimate = useMemo(() => {
    return Math.min(breadthScore, data.dailyProspectLimit);
  }, [breadthScore, data.dailyProspectLimit]);

  const warning = useMemo(() => {
    if (breadthScore >= 1000) return "⚠️ This may find 1000+ prospects/day. Consider narrowing.";
    if (breadthScore < 5) return "⚠️ This may find <5 prospects/day. Consider broadening.";
    return "";
  }, [breadthScore]);

  const onNext = () => {
    if (!validate(step)) return;
    setStep((s) => Math.min(5, s + 1) as Step);
  };
  const onPrev = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1) as Step);
  };

  const saveCampaign = async (status: "draft" | "active" | "scheduled") => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anon) return;
    const s = createClient(url, anon);
    const payload: any = {
      name: data.name,
      description: data.description || "",
      titles: data.titles,
      industries: data.industries,
      locations: data.locations,
      size_min: data.sizeMin,
      size_max: data.sizeMax,
      keywords: data.keywords,
      exclude_companies: data.excludeCompanies,
      daily_prospect_limit: data.dailyProspectLimit,
      min_ai_score: data.minAiScore,
      email_daily_limit: data.emailDailyLimit,
      send_weekends: data.sendWeekends,
      enable_followups: data.enableFollowups,
      followup_days: data.followupDays,
      max_followups: data.maxFollowups,
      status,
      schedule_start: status === "scheduled" ? data.scheduleStart || null : null,
    };
    const res = await s.from("hunting_campaigns").insert(payload).select("id").single();
    if (!res.error && res.data?.id) {
      localStorage.removeItem(LS_KEY);
      router.push("/dashboard/hunting");
    }
  };

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}> 
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Create Hunting Campaign</div>
            <div className="mt-1 text-sm text-zinc-400">Step {step} of {totalSteps}</div>
          </div>
          <div className="text-xs text-zinc-400">Saving {saving ? "…" : ""}</div>
        </div>
        <div className="mb-4 h-2 w-full rounded-full bg-zinc-800">
          <div className="h-2 rounded-full bg-blue-600" style={{ width: `${progress}%` }}></div>
        </div>

        <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Campaign Name</div>
                <input value={data.name || ""} onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))} placeholder="e.g., SaaS CTOs - North America" className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                {errors.name && <div className="mt-1 text-xs text-red-400">{errors.name}</div>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Description</div>
                <textarea value={data.description || ""} onChange={(e) => setData((d) => ({ ...d, description: e.target.value }))} placeholder="What's this campaign targeting?" className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" rows={3} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Job Titles</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.titles.map((t) => (
                    <span key={t} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">
                      {t}
                      <button className="text-zinc-300" onClick={() => removeTag("titles", t)}>×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input id="titleInput" placeholder="Add custom title" className="flex-1 rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                  <button onClick={() => { const el = document.getElementById("titleInput") as HTMLInputElement | null; if (el) { addTag("titles", el.value); el.value = ""; } }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Add</button>
                </div>
                {errors.titles && <div className="mt-1 text-xs text-red-400">{errors.titles}</div>}
              </div>

              <div>
                <div className="text-sm font-medium text-zinc-300">Industries</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {industryOptions.map((o) => (
                    <label key={o} className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 p-2 text-xs">
                      <input type="checkbox" checked={data.industries.includes(o)} onChange={(e) => setData((d) => ({ ...d, industries: e.target.checked ? Array.from(new Set([...(d.industries||[]), o])) : (d.industries||[]).filter((x) => x !== o) }))} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
                {errors.industries && <div className="mt-1 text-xs text-red-400">{errors.industries}</div>}
              </div>

              <div>
                <div className="text-sm font-medium text-zinc-300">Locations</div>
                <input value={searchLocation} onChange={(e) => setSearchLocation(e.target.value)} placeholder="Search location" className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {locationOptions.filter((o) => o.toLowerCase().includes(searchLocation.toLowerCase())).map((o) => (
                    <label key={o} className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 p-2 text-xs">
                      <input type="checkbox" checked={data.locations.includes(o)} onChange={(e) => setData((d) => ({ ...d, locations: e.target.checked ? Array.from(new Set([...(d.locations||[]), o])) : (d.locations||[]).filter((x) => x !== o) }))} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input id="locInput" placeholder="Add custom location" className="flex-1 rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                  <button onClick={() => { const el = document.getElementById("locInput") as HTMLInputElement | null; if (el) { addTag("locations", el.value); el.value = ""; } }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Add</button>
                </div>
                {errors.locations && <div className="mt-1 text-xs text-red-400">{errors.locations}</div>}
              </div>

              <div>
                <div className="text-sm font-medium text-zinc-300">Company Size</div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-zinc-300">Min</div>
                    <input type="range" min={1} max={50000} value={data.sizeMin} onChange={(e) => setData((d) => ({ ...d, sizeMin: Number(e.target.value) }))} className="w-full" />
                    <div className="mt-1 text-xs text-zinc-400">{data.sizeMin} employees</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-300">Max</div>
                    <input type="range" min={data.sizeMin} max={50000} value={data.sizeMax} onChange={(e) => setData((d) => ({ ...d, sizeMax: Number(e.target.value) }))} className="w-full" />
                    <div className="mt-1 text-xs text-zinc-400">{data.sizeMax} employees</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-xs text-zinc-500"><span>Startup</span><span>SMB</span><span>Mid-Market</span><span>Enterprise</span></div>
                {errors.size && <div className="mt-1 text-xs text-red-400">{errors.size}</div>}
              </div>

              <div>
                <div className="text-sm font-medium text-zinc-300">Keywords</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.keywords.map((t) => (
                    <span key={t} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">
                      {t}
                      <button className="text-zinc-300" onClick={() => removeTag("keywords", t)}>×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input id="kwInput" placeholder="e.g., hiring AI engineers" className="flex-1 rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                  <button onClick={() => { const el = document.getElementById("kwInput") as HTMLInputElement | null; if (el) { addTag("keywords", el.value); el.value = ""; } }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Add</button>
                </div>
                <div className="mt-1 text-xs text-zinc-400">Used to find relevant prospects on LinkedIn/Apollo</div>
              </div>

              <div>
                <div className="text-sm font-medium text-zinc-300">Exclude Companies</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {data.excludeCompanies.map((t) => (
                    <span key={t} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">
                      {t}
                      <button className="text-zinc-300" onClick={() => removeTag("excludeCompanies", t)}>×</button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input id="exInput" placeholder="Companies to skip" className="flex-1 rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                  <button onClick={() => { const el = document.getElementById("exInput") as HTMLInputElement | null; if (el) { addTag("excludeCompanies", el.value); el.value = ""; } }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Add</button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Daily Prospect Limit</div>
                <input type="range" min={5} max={100} value={data.dailyProspectLimit} onChange={(e) => setData((d) => ({ ...d, dailyProspectLimit: Number(e.target.value) }))} className="mt-2 w-full" />
                <div className="mt-1 text-xs text-zinc-400">{data.dailyProspectLimit} per day</div>
                {errors.dailyProspectLimit && <div className="mt-1 text-xs text-red-400">{errors.dailyProspectLimit}</div>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Minimum AI Score</div>
                <input type="range" min={0} max={100} value={data.minAiScore} onChange={(e) => setData((d) => ({ ...d, minAiScore: Number(e.target.value) }))} className="mt-2 w-full" />
                <div className="mt-1 text-xs text-zinc-400">{data.minAiScore} • {data.minAiScore < 40 ? "Low" : data.minAiScore < 70 ? "Medium" : "High Priority"}</div>
                {errors.minAiScore && <div className="mt-1 text-xs text-red-400">{errors.minAiScore}</div>}
              </div>
              <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-sm backdrop-blur-xl">This will find ~{dayEstimate} prospects/day based on your criteria.{warning ? ` ${warning}` : ""}</div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Daily Email Limit</div>
                <input type="number" min={1} value={data.emailDailyLimit} onChange={(e) => setData((d) => ({ ...d, emailDailyLimit: Number(e.target.value) }))} className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                <div className="mt-1 text-xs text-zinc-400">Max emails per day</div>
                {errors.emailDailyLimit && <div className="mt-1 text-xs text-red-400">{errors.emailDailyLimit}</div>}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm">Send on Weekends?</div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input type="checkbox" className="peer sr-only" checked={data.sendWeekends} onChange={(e) => setData((d) => ({ ...d, sendWeekends: e.target.checked }))} />
                  <div className="peer h-6 w-10 rounded-full bg-zinc-700 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:bg-blue-600 peer-checked:after:translate-x-4"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm">Enable Auto Follow-ups?</div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input type="checkbox" className="peer sr-only" checked={data.enableFollowups} onChange={(e) => setData((d) => ({ ...d, enableFollowups: e.target.checked }))} />
                  <div className="peer h-6 w-10 rounded-full bg-zinc-700 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:bg-blue-600 peer-checked:after:translate-x-4"></div>
                </label>
              </div>
              {data.enableFollowups && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-zinc-300">Follow-up 1: After days</div>
                      <input type="number" min={1} value={data.followupDays[0] || 3} onChange={(e) => setData((d) => ({ ...d, followupDays: [Number(e.target.value), d.followupDays[1] || 7, d.followupDays[2] || 14] }))} className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                    </div>
                    <div>
                      <div className="text-xs text-zinc-300">Follow-up 2: After days</div>
                      <input type="number" min={1} value={data.followupDays[1] || 7} onChange={(e) => setData((d) => ({ ...d, followupDays: [d.followupDays[0] || 3, Number(e.target.value), d.followupDays[2] || 14] }))} className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                    </div>
                    <div>
                      <div className="text-xs text-zinc-300">Follow-up 3: After days</div>
                      <input type="number" min={1} value={data.followupDays[2] || 14} onChange={(e) => setData((d) => ({ ...d, followupDays: [d.followupDays[0] || 3, d.followupDays[1] || 7, Number(e.target.value)] }))} className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                    </div>
                    <div>
                      <div className="text-xs text-zinc-300">Max follow-ups</div>
                      <input type="number" min={1} value={data.maxFollowups} onChange={(e) => setData((d) => ({ ...d, maxFollowups: Number(e.target.value) }))} className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                    </div>
                  </div>
                  {errors.followupDays && <div className="text-xs text-red-400">{errors.followupDays}</div>}
                  {errors.maxFollowups && <div className="text-xs text-red-400">{errors.maxFollowups}</div>}
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm">
                <div className="text-lg font-semibold">Review</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>Name: {data.name}</div>
                  <div>Daily prospects: {data.dailyProspectLimit}</div>
                  <div>Min AI score: {data.minAiScore}</div>
                  <div>Email/day: {data.emailDailyLimit}</div>
                  <div>Titles: {data.titles.join(", ")}</div>
                  <div>Industries: {data.industries.join(", ")}</div>
                  <div>Locations: {data.locations.join(", ")}</div>
                  <div>Company size: {data.sizeMin}–{data.sizeMax}</div>
                  <div>Keywords: {data.keywords.join(", ")}</div>
                  <div>Exclude: {data.excludeCompanies.join(", ")}</div>
                  <div>Send weekends: {data.sendWeekends ? "Yes" : "No"}</div>
                  <div>Follow-ups: {data.enableFollowups ? `${data.followupDays.join(", ")} (max ${data.maxFollowups})` : "Disabled"}</div>
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Schedule Start</div>
                <input type="datetime-local" value={data.scheduleStart || ""} onChange={(e) => setData((d) => ({ ...d, scheduleStart: e.target.value }))} className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button onClick={onPrev} disabled={step === 1} className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">Previous</button>
          <div className="flex items-center gap-2">
            {step < 5 && <button onClick={onNext} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Next</button>}
            {step === 5 && (
              <>
                <button onClick={() => saveCampaign("draft")} className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm">Save as Draft</button>
                <button onClick={() => saveCampaign("active")} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">Activate Campaign</button>
                <button onClick={() => saveCampaign("scheduled")} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white">Schedule Start</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}