"use client";
import { Nunito_Sans } from "next/font/google";
import { useEffect, useState } from "react";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

const LS_KEY = "skills_assessment_v1";

export default function SkillsAssessmentPage() {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("Data Scientist");
  const [teamSize, setTeamSize] = useState("1-3");
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data) {
          setFullName(parsed.data.fullName || "");
          setEmail(parsed.data.email || "");
          setCompany(parsed.data.company || "");
          setRole(parsed.data.role || "Data Scientist");
          setTeamSize(parsed.data.teamSize || "1-3");
          setTools(parsed.data.tools || []);
        }
        if (parsed?.step) setStep(parsed.step);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      setSaving(true);
      const data = { fullName, email, company, role, teamSize, tools };
      localStorage.setItem(LS_KEY, JSON.stringify({ step, data }));
    } finally {
      setSaving(false);
    }
  }, [step, fullName, email, company, role, teamSize, tools]);

  const toggleTool = (t: string, checked: boolean) => {
    setTools((arr) => (checked ? Array.from(new Set([...arr, t])) : arr.filter((x) => x !== t)));
  };

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 1) {
      const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
      if (!fullName) e.fullName = "Enter your full name";
      if (!company) e.company = "Enter your company";
      if (!email || !emailRegex.test(email)) e.email = "Enter a valid email";
    } else if (s === 2) {
      if (!role) e.role = "Select a role";
      if (!teamSize) e.teamSize = "Select a team size";
    }
    return e;
  };

  const onNext = async () => {
    const v = validate(step);
    if (Object.keys(v).length > 0) { setErrors(v); return; }
    setErrors({});
    if (step === 2) {
      try {
        const payload = { type: "skills", data: { fullName, email, company, role, teamSize, tools } };
        const res = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const js = await res.json();
        if (js?.success && js?.report) setReport(js.report);
      } catch {}
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const onPrev = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Evaluate Team AI Skills</div>
            <div className="mt-1 text-sm text-zinc-400">Quick assessment</div>
          </div>
          <div className="text-xs text-zinc-400">Saving {saving ? "…" : ""}</div>
        </div>
        <div className="mb-4">
          <div className="text-sm text-zinc-400">Section {step} of 2</div>
          <div className="mt-2 h-2 w-full rounded-full bg-zinc-800">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.round((step/2)*100)}%` }}></div>
          </div>
        </div>
        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Full name</div>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" placeholder="Jane Smith" />
                {errors.fullName && <p className="mt-1 text-xs text-red-400">{errors.fullName}</p>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Company</div>
                <input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" placeholder="Acme Corp" />
                {errors.company && <p className="mt-1 text-xs text-red-400">{errors.company}</p>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Work email</div>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" placeholder="you@company.com" />
                {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-zinc-300">Primary Role</div>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
                  {["Data Scientist","ML Engineer","MLOps","Software Engineer","Product","Other"].map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
                {errors.role && <p className="mt-1 text-xs text-red-400">{errors.role}</p>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Team Size</div>
                <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
                  {["1-3","4-10","11-25","25+","Distributed across org"].map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
                {errors.teamSize && <p className="mt-1 text-xs text-red-400">{errors.teamSize}</p>}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Current Tooling</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {["TensorFlow","PyTorch","Cloud AI","Custom ML platform","Vector DB","LLM infra"].map((t) => (
                    <label key={t} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
                      <input type="checkbox" checked={tools.includes(t)} onChange={(e) => toggleTool(t, e.target.checked)} />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <div className="text-sm text-zinc-300">AI Skills Assessment Insights</div>
              <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4 text-sm">
                {report ? (
                  <pre className="whitespace-pre-wrap text-zinc-200">{report}</pre>
                ) : (
                  <div className="text-zinc-400">No insights available. Please try again.</div>
                )}
              </div>
            </div>
          )}
        </div>
          <div className="mt-6 flex items-center justify-between">
            <button onClick={onPrev} disabled={step === 1} className="rounded-lg border border-white/10 bg-zinc-800 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">Previous</button>
            <div className="flex items-center gap-2">
            <button onClick={onNext} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">{step === 1 ? "Start Assessment" : step === 2 ? "Finish" : "Done"}</button>
            </div>
          </div>
      </div>
    </div>
  );
}
  const [report, setReport] = useState<string>("");