"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nunito_Sans } from "next/font/google";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800" ] });

export default function Home() {
  const router = useRouter();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  type FaqItem = { q: string; a: string };
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});
  const [email, setEmail] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [callForm, setCallForm] = useState({ name: "", email: "", preferred_time: "" });
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [callSuccess, setCallSuccess] = useState<string | null>(null);

  const track = async (event: string, meta?: Record<string, any>) => {
    try { await fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, email, meta }) }); } catch {}
  };

  

  const submitSetupCall = async () => {
    setCallError(null); setCallSuccess(null);
    const valid = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(callForm.email) && callForm.name.trim().length > 0;
    if (!valid) { setCallError("Fill all required fields"); return; }
    setCallLoading(true);
    try {
      const res = await fetch("/api/setup-call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(callForm) });
      const data = await res.json();
      if (!res.ok || !data.success) { setCallError(data?.error || "Failed"); } else { setCallSuccess("Booked! We’ll confirm by email."); setCallForm({ name: "", email: "", preferred_time: "" }); }
      await track("setup_call_requested", { preferred_time: callForm.preferred_time });
    } catch {
      setCallError("Network error");
    } finally {
      setCallLoading(false);
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 10;
      const y = (e.clientY / window.innerHeight - 0.5) * 10;
      setParallax({ x, y });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <section ref={heroRef} className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-slate-50 to-slate-50" />
        <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-slate-900/5 blur-3xl" style={{ transform: `translate(${parallax.x}px, ${parallax.y}px)` }} />
        <div className="pointer-events-none absolute -bottom-24 -right-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" style={{ transform: `translate(${-parallax.x}px, ${-parallax.y}px)` }} />
        <div className="relative mx-auto max-w-6xl px-6 py-28 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-6xl md:text-[64px]">
            AI Sales Agent That Costs $0/Month
          </h1>
          <p className="mt-6 text-lg text-slate-700 sm:text-xl md:text-2xl">
            Replace your SDR team. One-time setup. Runs forever on free APIs.
          </p>
          <p className="mt-3 text-sm text-slate-500 md:text-base">
            Minimum cost. Maximum value. Full control.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <button onClick={() => router.push("/auth/signup")} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800">
              Get Started
            </button>
            <button onClick={() => setModalOpen(true)} className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
              See Comparison
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <Link href="/assess/enterprise" className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
              Assess Enterprise AI Readiness
            </Link>
            <Link href="/assess/skills" className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
              Evaluate Team AI Skills
            </Link>
          </div>
          <div className="mt-12 mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
              <div className="text-slate-800">$240K/year SDR team → $0/month AI agent</div>
              <div className="hidden sm:block h-px bg-slate-200" />
              <div className="text-slate-600">Setup time: 1 hour | Runs on: Free tier APIs</div>
            </div>
          </div>

          
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Enterprise</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">Assess AI Readiness</div>
            <div className="mt-2 text-sm text-slate-600">A structured roadmap for architecture, ROI, integration strategy, and risk.</div>
            <Link href="/assess/enterprise" className="mt-6 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800">Start Assessment</Link>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">Team</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">Evaluate AI Capabilities</div>
            <div className="mt-2 text-sm text-slate-600">Understand skills gaps, tooling maturity, and a practical upskilling plan.</div>
            <Link href="/assess/skills" className="mt-6 inline-block rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50">Start Skills Review</Link>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-medium text-slate-500">ONE-TIME SETUP</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">Do It Yourself</div>
            <div className="mt-4 space-y-1 text-sm text-slate-700">
              <div>Complete GitHub code</div>
              <div>Step-by-step guidance</div>
              <div>API setup checklist</div>
              <div>Free forever</div>
            </div>
            <div className="mt-5 space-y-1 text-sm text-slate-600">
              <div>Free API accounts (guided)</div>
              <div>Vercel (free)</div>
              <div>1 hour of time</div>
            </div>
            <div className="mt-4 text-sm text-slate-500">Best for: Technical founders</div>
            <button onClick={() => router.push("/assess/enterprise")} className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">Access Setup Guide</button>
            <div className="mt-2 text-center text-xs text-slate-500">Deploy in ~60 minutes</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-medium text-slate-500">DONE-FOR-YOU</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">We Set It Up</div>
            <div className="mt-4 space-y-1 text-sm text-slate-700">
              <div>We configure everything</div>
              <div>Custom domain setup</div>
              <div>1-hour training call</div>
              <div>Support during rollout</div>
            </div>
            <div className="mt-5 space-y-1 text-sm text-slate-600">
              <div>Your API keys (guided)</div>
              <div>Onboarding call</div>
              <div>Operator walkthrough</div>
            </div>
            <div className="mt-4 text-sm text-slate-500">Best for: Busy teams</div>
            <button onClick={() => { setCallOpen(true); track("book_setup_call_click"); }} className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Book Setup Call</button>
            <div className="mt-2 text-center text-xs text-slate-500">Live in ~24 hours</div>
          </div>
        </div>
      </section>
      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Get started</div>
          <div className="mt-2 text-sm text-slate-600">Enter your work email to begin.</div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="flex-1 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
            <button onClick={() => router.push("/auth/signup?from=landing")} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Continue</button>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-6">
        <div className="mx-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-700">
          <div>You own everything: data, APIs, infrastructure.</div>
          <div className="mt-1">Built on 6 patents in enterprise AI architecture.</div>
          <div className="mt-1">Designed for operational clarity and control.</div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="text-center text-2xl font-semibold">FAQ</div>
        <div className="mt-6 space-y-4">
          {([
            { q: "Do I need to code?", a: "No. Copy-paste commands we give you. Video shows every step." },
            { q: "What if I hit API limits?", a: "Upgrade just that API. System keeps working. No downtime." },
            { q: "Can I use my own AI model?", a: "Yes! Works with Ollama, local models, any API-compatible LLM." },
            { q: "What's the catch?", a: "No catch. We believe in minimum cost, maximum value. You own it all." },
          ] as FaqItem[]).map((item, idx) => (
            <div key={item.q} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <button onClick={() => setFaqOpen((f) => ({ ...f, [idx]: !f[idx] }))} className="flex w-full items-center justify-between text-left">
                <span className="text-sm font-medium text-slate-900">{item.q}</span>
                <span className="text-slate-500">{faqOpen[idx] ? "−" : "+"}</span>
              </button>
              <div className={`grid transition-all duration-200 ${faqOpen[idx] ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden text-sm text-slate-600">
                  {item.a}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="w-full max-w-3xl scale-100 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xl font-semibold">Free vs Paid APIs: The Real Numbers</div>
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">Close</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-600">
                    <th className="p-2 text-left">Feature</th>
                    <th className="p-2 text-left">Free Tier</th>
                    <th className="p-2 text-left">Paid Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Volume", "100 leads/day", "Unlimited"],
                    ["Speed", "Fast", "Faster"],
                    ["Support", "Community", "Priority"],
                    ["Cost", "$0/month", "$50-200/month"],
                    ["Limits", "Hit after 3K leads", "No limits"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-t border-slate-100">
                      <td className="p-2">{row[0]}</td>
                      <td className="p-2">{row[1]}</td>
                      <td className="p-2">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-700">
              Recommendation: start free, scale when you need.
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={async () => { setModalOpen(false); await track("modal_start_free"); router.push("/auth/signup"); }} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">Start With Free</button>
              <button onClick={async () => { setModalOpen(false); await track("modal_go_pro"); router.push("/prospects/discover"); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Go Pro</button>
          </div>
        </div>
      </div>
      )}

      <section className="relative mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-3xl font-semibold text-slate-900">Ready to Replace Your Sales Team?</div>
          <div className="mt-2 text-slate-600">Choose your path. Both work. Both are yours forever.</div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button onClick={async () => { await track("cta_deploy_free"); router.push("/auth/signup"); }} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white">Deploy Free Version</button>
            <button onClick={() => { setCallOpen(true); track("cta_get_setup"); }} className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Get Professional Setup</button>
          </div>
          <div className="mt-3 text-sm text-slate-500">Questions? <a href="mailto:founders@tupleai.co.in" className="underline">founders@tupleai.co.in</a></div>
        </div>
      </section>

      {callOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xl font-semibold">Book Setup Call</div>
              <button onClick={() => setCallOpen(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">Close</button>
            </div>
            <div className="space-y-3">
              <input value={callForm.name} onChange={(e) => setCallForm((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm" />
              <input value={callForm.email} onChange={(e) => setCallForm((f) => ({ ...f, email: e.target.value }))} placeholder="Your email" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm" />
              <input value={callForm.preferred_time} onChange={(e) => setCallForm((f) => ({ ...f, preferred_time: e.target.value }))} placeholder="Preferred time" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm" />
            </div>
            {callError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{callError}</div>}
            {callSuccess && <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-800">{callSuccess}</div>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={submitSetupCall} disabled={callLoading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">{callLoading ? "..." : "Request Call"}</button>
            </div>
          </div>
        </div>
      )}
      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {[
            { icon: "🎯", title: "Smart Lead Hunting", lines: ["Finds decision-makers on LinkedIn, Apollo, GitHub", "AI scores each lead 0-100"], badge: "Fully Automated" },
            { icon: "✉️", title: "Personalized Outreach", lines: ["Writes custom emails for each prospect", "Intelligent follow-up sequences"], badge: "25% Response Rate" },
            { icon: "📅", title: "Auto Booking", lines: ["Meetings appear in your calendar", "No human intervention needed"], badge: "24/7 Active" },
          ].map((c) => (
            <div key={c.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-medium text-slate-500">{c.badge}</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{c.title}</div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                {c.lines.map((l) => (<div key={l}>{l}</div>))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="text-center text-2xl font-semibold">How It Works</div>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-4">
          {[
            { t: "Setup", d: "Add keys, choose defaults" },
            { t: "Connect", d: "Link APIs and data" },
            { t: "Launch", d: "Start prospecting" },
            { t: "Profit", d: "Meetings book themselves" },
          ].map((s, i) => (
            <div key={s.t} className="relative rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
              <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-slate-900" />
              <div className="text-lg font-semibold">Step {i + 1} — {s.t}</div>
              <div className="mt-1 text-sm text-slate-600">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <div className="text-3xl font-bold">Free vs Paid: Choose Your Path</div>
          <div className="mt-2 text-slate-600">Both work. Paid is more robust.</div>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold">FREE FOREVER</div>
            <div className="text-sm text-slate-600">Use free tiers</div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div>✅ Groq (14K req/day)</div>
              <div>✅ Supabase (500MB)</div>
              <div>✅ Resend (100/day)</div>
              <div>✅ Apollo (50/month)</div>
            </div>
            <div className="mt-4 text-sm text-slate-600">Good for: Testing, small volume (&lt;100 leads/month)</div>
            <div className="mt-2 text-sm text-slate-600">Cost: $0/month</div>
            <button onClick={() => router.push("/assess/enterprise")} className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800">Get Free Setup</button>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold">RECOMMENDED</div>
            <div className="text-sm text-slate-600">Paid providers</div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <div>✅ Any AI (unlimited)</div>
              <div>✅ Supabase Pro (8GB)</div>
              <div>✅ Resend (10K/day)</div>
              <div>✅ Apollo (unlimited)</div>
            </div>
            <div className="mt-4 text-sm text-slate-600">Good for: Production, scale (1000+ leads/mo)</div>
            <div className="mt-2 text-sm text-slate-600">Cost: ~$50-200/month</div>
            <button onClick={() => router.push("/prospects/discover")} className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Get Pro Setup</button>
          </div>
        </div>
        <div className="mt-6 mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-700">
          Pro tip: start free, upgrade when you hit limits. It takes minutes to switch.
        </div>
      </section>
    </div>
  );
}
