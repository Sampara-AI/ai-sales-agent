"use client";
import { useEffect, useRef, useState } from "react";
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
  const [depLoading, setDepLoading] = useState(false);
  const [depError, setDepError] = useState<string | null>(null);
  const [depSuccess, setDepSuccess] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [callForm, setCallForm] = useState({ name: "", email: "", preferred_time: "" });
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [callSuccess, setCallSuccess] = useState<string | null>(null);

  const track = async (event: string, meta?: Record<string, any>) => {
    try { await fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, email, meta }) }); } catch {}
  };

  const submitSignup = async (type: "free" | "paid") => {
    setDepError(null); setDepSuccess(null);
    const valid = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
    if (!valid) { setDepError("Enter a valid email"); return; }
    setDepLoading(true);
    try {
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, deployment_type: type }) });
      const data = await res.json();
      if (!res.ok || !data.success) { setDepError(data?.error || "Failed"); } else { setDepSuccess("✓ Check your email!"); setEmail(""); }
      await track(type === "free" ? "signup_free" : "signup_paid");
    } catch {
      setDepError("Network error");
    } finally {
      setDepLoading(false);
    }
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
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}> 
      <section ref={heroRef} className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-purple-950 to-blue-950" />
        <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl" style={{ transform: `translate(${parallax.x}px, ${parallax.y}px)` }} />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" style={{ transform: `translate(${-parallax.x}px, ${-parallax.y}px)` }} />
        <div className="relative mx-auto max-w-6xl px-6 py-28 text-center">
          <h1 className="text-4xl sm:text-6xl md:text-[72px] font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 via-white to-zinc-200">
            AI Sales Agent That Costs $0/Month
          </h1>
          <p className="mt-6 text-xl sm:text-2xl md:text-[32px] font-light text-zinc-300">
            Replace your SDR team. One-time setup. Runs forever on free APIs.
          </p>
          <p className="mt-3 text-base md:text-[18px] text-zinc-400">
            Minimum Cost. Maximum Value. Full Control.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <button onClick={() => router.push("/auth/signup")} className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 backdrop-blur-xl transition-all hover:scale-[1.02] hover:bg-white/15">
              🚀 Get Started
            </button>
            <button onClick={() => setModalOpen(true)} className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3 backdrop-blur-xl transition-all hover:scale-[1.02] hover:bg-white/15">
              💎 See Paid Comparison
            </button>
          </div>
          <div className="mt-12 mx-auto max-w-3xl rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm sm:text-base">
              <div className="text-zinc-200">$240K/year SDR team → $0/month AI agent</div>
              <div className="hidden sm:block h-px bg-white/20" />
              <div className="text-zinc-300">Setup time: 1 hour | Runs on: Free tier APIs</div>
            </div>
          </div>

          <div className="mt-8 mx-auto max-w-xl rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
            <div className="text-sm text-zinc-300">Get Setup Guide</div>
            <div className="mt-3 flex gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="flex-1 rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-sm text-zinc-50 outline-none backdrop-blur-xl focus:border-blue-500" />
              <button disabled={depLoading} onClick={() => submitSignup("free")} className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white backdrop-blur-xl transition hover:bg-white/15 disabled:opacity-60">{depLoading ? "..." : "Get Instant Access"}</button>
            </div>
            {depError && <div className="mt-2 rounded-lg border border-red-600/30 bg-red-900/30 p-2 text-xs text-red-300">{depError}</div>}
            {depSuccess && <div className="mt-2 rounded-lg border border-green-600/30 bg-green-900/30 p-2 text-xs text-green-300">{depSuccess}</div>}
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl">
            <div className="text-sm text-zinc-400">🛠️ ONE-TIME SETUP</div>
            <div className="mt-1 text-xl font-semibold">Do It Yourself (1 Hour)</div>
            <div className="mt-4 space-y-1 text-zinc-200">
              <div>✓ Complete GitHub code</div>
              <div>✓ Step-by-step video guide</div>
              <div>✓ API setup instructions</div>
              <div>✓ Free forever</div>
            </div>
            <div className="mt-5 space-y-1 text-zinc-300">
              <div>• 5 free API accounts (we show you)</div>
              <div>• Vercel account (free)</div>
              <div>• 1 hour of time</div>
            </div>
            <div className="mt-4 text-sm text-zinc-400">Perfect for: Developers, technical founders</div>
            <button onClick={() => router.push("/assess/enterprise")} className="mt-6 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-xl transition hover:bg-white/15">🚀 Access Setup Guide</button>
            <div className="mt-2 text-center text-xs text-zinc-400">"Deploy in 60 minutes"</div>
          </div>
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl">
            <div className="text-sm text-zinc-400">⚡ DONE-FOR-YOU</div>
            <div className="mt-1 text-xl font-semibold">We Set It Up ($297 one-time)</div>
            <div className="mt-4 space-y-1 text-zinc-200">
              <div>✓ We configure everything</div>
              <div>✓ Custom domain setup</div>
              <div>✓ 1-hour training call</div>
              <div>✓ 30-day support</div>
            </div>
            <div className="mt-5 space-y-1 text-zinc-300">
              <div>• Your API keys (we guide you)</div>
              <div>• 30-min onboarding call</div>
              <div>• That's it!</div>
            </div>
            <div className="mt-4 text-sm text-zinc-400">Perfect for: Non-technical founders, busy teams</div>
            <button onClick={() => { setCallOpen(true); track("book_setup_call_click"); }} className="mt-6 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-xl transition hover:bg-white/15">💎 Book Setup Call</button>
            <div className="mt-2 text-center text-xs text-zinc-400">"Live in 24 hours"</div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-6 py-6">
        <div className="mx-auto rounded-2xl border border-white/20 bg-white/10 p-4 text-center text-sm text-zinc-300 backdrop-blur-xl">
          <div>🔒 You own everything. Your data, your APIs, your infrastructure.</div>
          <div className="mt-1">🎓 Built on 6 patents in enterprise AI architecture</div>
          <div className="mt-1">⚡ 50+ founders already deployed</div>
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
            <div key={item.q} className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
              <button onClick={() => setFaqOpen((f) => ({ ...f, [idx]: !f[idx] }))} className="flex w-full items-center justify-between text-left">
                <span className="text-sm font-medium text-zinc-100">{item.q}</span>
                <span className="text-zinc-300">{faqOpen[idx] ? "−" : "+"}</span>
              </button>
              <div className={`grid transition-all duration-200 ${faqOpen[idx] ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden text-sm text-zinc-300">
                  {item.a}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl scale-100 rounded-3xl border border-white/20 bg-white/10 p-6 text-zinc-100 backdrop-blur-xl shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xl font-semibold">Free vs Paid APIs: The Real Numbers</div>
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1">Close</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-300">
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
                    <tr key={row[0]} className="border-t border-white/10">
                      <td className="p-2">{row[0]}</td>
                      <td className="p-2">{row[1]}</td>
                      <td className="p-2">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-3 text-center text-sm text-zinc-300">
              🎯 Recommendation: Start free, scale when you need
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={async () => { setModalOpen(false); await track("modal_start_free"); router.push("/auth/signup"); }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2">Start With Free</button>
              <button onClick={async () => { setModalOpen(false); await track("modal_go_pro"); router.push("/prospects/discover"); }} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2">Go Pro Immediately</button>
          </div>
        </div>
      </div>
      )}

      <section className="relative mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-white/20 bg-white/10 p-8 text-center backdrop-blur-xl">
          <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Ready to Replace Your Sales Team?</div>
          <div className="mt-2 text-zinc-300">Choose your path. Both work. Both are yours forever.</div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button onClick={async () => { await track("cta_deploy_free"); router.push("/auth/signup"); }} className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3">Deploy Free Version</button>
            <button onClick={() => { setCallOpen(true); track("cta_get_setup"); }} className="rounded-2xl border border-white/20 bg-white/10 px-6 py-3">Get Professional Setup</button>
          </div>
          <div className="mt-3 text-sm text-zinc-400">Questions? <a href="mailto:founders@tupleai.co.in" className="underline">founders@tupleai.co.in</a></div>
        </div>
      </section>

      {callOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-6 text-zinc-100 backdrop-blur-xl shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xl font-semibold">Book Setup Call</div>
              <button onClick={() => setCallOpen(false)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1">Close</button>
            </div>
            <div className="space-y-3">
              <input value={callForm.name} onChange={(e) => setCallForm((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-sm" />
              <input value={callForm.email} onChange={(e) => setCallForm((f) => ({ ...f, email: e.target.value }))} placeholder="Your email" className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-sm" />
              <input value={callForm.preferred_time} onChange={(e) => setCallForm((f) => ({ ...f, preferred_time: e.target.value }))} placeholder="Preferred time" className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-sm" />
            </div>
            {callError && <div className="mt-2 rounded-lg border border-red-600/30 bg-red-900/30 p-2 text-xs text-red-300">{callError}</div>}
            {callSuccess && <div className="mt-2 rounded-lg border border-green-600/30 bg-green-900/30 p-2 text-xs text-green-300">{callSuccess}</div>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={submitSetupCall} disabled={callLoading} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 disabled:opacity-60">{callLoading ? "..." : "Request Call"}</button>
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
            <div key={c.title} className="rounded-3xl border border-white/20 bg-gradient-to-br from-zinc-900/80 to-zinc-800/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-black/50">
              <div className="text-3xl">{c.icon}</div>
              <div className="mt-3 text-xl font-semibold">{c.title}</div>
              <div className="mt-2 space-y-1 text-zinc-300">
                {c.lines.map((l) => (<div key={l}>{l}</div>))}
              </div>
              <div className="mt-4 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-zinc-200">
                {c.badge}
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
            <div key={s.t} className="relative rounded-2xl border border-white/20 bg-white/10 p-5 text-center backdrop-blur-xl">
              <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500" />
              <div className="text-lg font-semibold">Step {i + 1} — {s.t}</div>
              <div className="mt-1 text-zinc-300">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <div className="text-3xl font-bold">Free vs Paid: Choose Your Path</div>
          <div className="mt-2 text-zinc-300">Both work. Paid is more robust.</div>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl">
            <div className="text-lg font-semibold">FREE FOREVER</div>
            <div className="text-sm text-zinc-300">Use Free APIs</div>
            <div className="mt-4 space-y-2 text-zinc-200">
              <div>✅ Groq (14K req/day)</div>
              <div>✅ Supabase (500MB)</div>
              <div>✅ Resend (100/day)</div>
              <div>✅ Apollo (50/month)</div>
            </div>
            <div className="mt-4 text-sm text-zinc-300">Good for: Testing, small volume (&lt;100 leads/month)</div>
            <div className="mt-2 text-sm text-zinc-300">Cost: $0/month</div>
            <button onClick={() => router.push("/assess/enterprise")} className="mt-6 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-xl transition hover:bg-white/15">Get Free Setup</button>
          </div>
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl">
            <div className="text-lg font-semibold">RECOMMENDED</div>
            <div className="text-sm text-zinc-300">Paid APIs</div>
            <div className="mt-4 space-y-2 text-zinc-200">
              <div>✅ Any AI (unlimited)</div>
              <div>✅ Supabase Pro (8GB)</div>
              <div>✅ Resend (10K/day)</div>
              <div>✅ Apollo (unlimited)</div>
            </div>
            <div className="mt-4 text-sm text-zinc-300">Good for: Production, scale (1000+ leads/mo)</div>
            <div className="mt-2 text-sm text-zinc-300">Cost: ~$50-200/month</div>
            <button onClick={() => router.push("/prospects/discover")} className="mt-6 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-xl transition hover:bg-white/15">Get Pro Setup</button>
          </div>
        </div>
        <div className="mt-6 mx-auto max-w-3xl rounded-2xl border border-white/20 bg-white/10 p-4 text-center text-sm text-zinc-300 backdrop-blur-xl">
          💡 Pro Tip: Start free, upgrade when you hit limits. Takes 5 mins to switch.
        </div>
      </section>
    </div>
  );
}
