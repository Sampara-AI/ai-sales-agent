"use client";
import { useEffect, useMemo, useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

type Choice = "diy" | "dfy" | "explore";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("Founder");
  const [choice, setChoice] = useState<Choice>("diy");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const LS = "onboarding_v1";

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      if (!data.user) { router.replace("/auth/login?next=/onboarding"); return; }
      const pr = await supabase.from("profiles").select("name,email,company,role,onboarding_completed").eq("user_id", data.user.id).single();
      const p = pr.data as any;
      if (p?.onboarding_completed === true) { router.replace("/dashboard"); return; }
      setName(p?.name || "");
      setEmail(data.user.email || p?.email || "");
      setCompany(p?.company || "");
      setRole(p?.role || "Founder");
      const saved = typeof window !== "undefined" ? localStorage.getItem(LS) : null;
      if (saved) {
        try { const s = JSON.parse(saved); setStep(s.step || 1); setCompany(s.company || ""); setRole(s.role || "Founder"); setChoice(s.choice || "diy"); } catch {}
      }
      setLoading(false);
    };
    init();
  }, [supabase]);

  const persist = async (patch: any) => {
    const s = { step, company, role, choice, ...patch };
    localStorage.setItem(LS, JSON.stringify(s));
    await supabase.from("profiles").update({ company: s.company, role: s.role }).eq("user_id", (await supabase.auth.getUser()).data.user?.id);
  };

  const skip = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("profiles").update({ onboarding_completed: true }).eq("user_id", data.user.id);
    localStorage.removeItem(LS);
    router.replace("/dashboard");
  };

  const nextStep = async () => { const ns = Math.min(4, step + 1); setStep(ns); await persist({ step: ns }); };
  const prevStep = async () => { const ps = Math.max(1, step - 1); setStep(ps); await persist({ step: ps }); };

  const submitDFY = async () => {
    try {
      const { data } = await supabase.auth.getUser(); if (!data.user) return;
      await supabase.from("setup_calls").insert({ name, email, company, status: "pending" });
      await persist({});
      nextStep();
    } catch (e: any) { setError(e?.message || "Failed to save setup request"); }
  };

  const finish = async () => {
    const { data } = await supabase.auth.getUser(); if (!data.user) return;
    await supabase.from("profiles").update({ onboarding_completed: true }).eq("user_id", data.user.id);
    localStorage.removeItem(LS);
    router.replace("/dashboard");
  };

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto max-w-3xl px-6 py-10">
        {error && <div className="mb-4 rounded-lg border border-red-600/30 bg-red-900/30 p-3 text-red-300 text-sm">{error}</div>}
        <div className="mb-4 flex items-center justify-between text-xs text-zinc-400">
          <div>Step {step} / 4</div>
          <button onClick={skip} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">Skip onboarding</button>
        </div>
        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
          {step === 1 && (
            <div>
              <div className="text-xl font-semibold">Welcome to Tuple AI! Let's get you set up.</div>
              <div className="mt-4 space-y-3">
                <input value={company} onChange={async (e) => { setCompany(e.target.value); await persist({ company: e.target.value }); }} placeholder="Company name" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                <select value={role} onChange={async (e) => { setRole(e.target.value); await persist({ role: e.target.value }); }} className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm">
                  {['Founder','Sales','Marketing','Other'].map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button onClick={nextStep} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Continue</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="text-xl font-semibold">What do you need?</div>
              <div className="mt-4 space-y-2">
                {[
                  { k: "diy", t: "Set up my own AI sales agent (Free)" },
                  { k: "dfy", t: "Have Tuple AI set it up for me ($297)" },
                  { k: "explore", t: "Just exploring for now" },
                ].map((opt) => (
                  <label key={opt.k} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="choice" checked={choice === opt.k} onChange={async () => { setChoice(opt.k as Choice); await persist({ choice: opt.k }); }} />
                    <span>{opt.t}</span>
                  </label>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={prevStep} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Back</button>
                <button onClick={nextStep} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Continue</button>
              </div>
            </div>
          )}

          {step === 3 && choice === "diy" && (
            <div>
              <div className="text-xl font-semibold">Great! Here's what you'll need:</div>
              <div className="mt-4 space-y-2 text-sm text-zinc-300">
                <div>• Groq API key</div>
                <div>• Supabase project</div>
                <div>• Resend email key</div>
                <div>• Apollo key (optional)</div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a href="/assess/enterprise" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Start Setup Guide</a>
                <a href="https://www.youtube.com" target="_blank" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Watch Video Tutorial</a>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={prevStep} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Back</button>
                <button onClick={nextStep} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Continue</button>
              </div>
            </div>
          )}

          {step === 3 && choice === "dfy" && (
            <div>
              <div className="text-xl font-semibold">Perfect! Let's schedule your setup call.</div>
              <div className="mt-4 space-y-3">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full Name" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
              </div>
              <div className="mt-4">
                <button onClick={submitDFY} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Save & Continue</button>
              </div>
              <div className="mt-2 text-xs text-zinc-400">We'll reach out to schedule a time.</div>
              <div className="mt-6">
                <button onClick={prevStep} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Back</button>
              </div>
            </div>
          )}

          {step === 3 && choice === "explore" && (
            <div>
              <div className="text-xl font-semibold">No problem! Here's what you can do:</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a href="/assess/enterprise" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Take Enterprise Assessment</a>
                <a href="/docs" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Browse Documentation</a>
                <a href="https://youtu.be" target="_blank" className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Watch Demo</a>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={prevStep} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm">Back</button>
                <button onClick={nextStep} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Continue</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className="text-xl font-semibold">You're all set!</div>
              <div className="mt-2 text-sm text-zinc-300">We'll take you to your dashboard. You can always revisit onboarding later.</div>
              <div className="mt-6">
                <button onClick={finish} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">Finish</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}