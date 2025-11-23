"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Objective = "Cost Reduction" | "Revenue Growth" | "Customer Experience" | "Operational Efficiency" | "Innovation" | "Competitive Advantage";
type Maturity = "Exploring (no AI)" | "Experimenting (1-2 pilots)" | "Implementing (3-5 projects)" | "Scaling (across units)" | "Leading (AI-first)";
type Investment = "<$100K" | "$100K-$500K" | "$500K-$2M" | "$2M-$10M" | ">$10M" | "Not Determined";
type Cloud = "On-premise only" | "Hybrid cloud" | "Multi-cloud" | "Cloud-native modern stack";
type DataInfra = "Siloed databases" | "Basic warehouse" | "Modern data lake" | "Real-time platform with MLops";
type ApiCap = "Limited" | "Basic REST" | "Modern architecture" | "Event-driven real-time";
type DataQuality = "Poor/hard access" | "Decent/moderate" | "Good/accessible" | "Excellent/self-service";
type Governance = "No formal" | "Basic policies" | "Comprehensive framework" | "Automated with compliance";

type ToolingOption = "None" | "TensorFlow/PyTorch" | "Cloud AI services" | "Custom ML platform" | "MLOps pipeline" | "Vector databases" | "LLM infrastructure";
type PrivacyOption = "GDPR" | "HIPAA" | "SOC2" | "AI ethics framework" | "Model explainability" | "Bias mitigation";
type TeamSize = "No dedicated team" | "1-3 people" | "4-10" | "11-25" | "25+" | "Distributed across org";
type SkillGap = "ML Engineers" | "Data Scientists" | "MLOps Engineers" | "AI Architects" | "Data Engineers" | "Product Managers (AI)" | "AI Ethics/Governance" | "Domain experts with AI";
type ExecLiteracy = "Low awareness" | "Basic understanding" | "Good grasp" | "Deep technical and strategic understanding";
type ChangeReadiness = "Significant resistance" | "Some concerns" | "Cautiously optimistic" | "Strong enthusiasm";
type UseCase = "Customer service automation" | "Predictive analytics" | "Process automation" | "Personalization" | "Fraud detection" | "Quality control" | "Supply chain" | "Risk management" | "Other";
type RoiTimeline = "<6 months" | "6-12 months" | "1-2 years" | "2-3 years" | ">3 years";
type Challenge = "Budget" | "Lack of talent" | "Data quality" | "Integration complexity" | "Regulatory" | "Executive buy-in" | "Proving ROI" | "Change management" | "Security";

type Assessment = {
  fullName?: string;
  company?: string;
  objective?: Objective;
  maturity?: Maturity;
  investment?: Investment;
  cloud?: Cloud;
  dataInfra?: DataInfra;
  tooling: ToolingOption[];
  api?: ApiCap;
  dataQuality?: DataQuality;
  governance?: Governance;
  privacy: PrivacyOption[];
  dataVolume?: "Limited structured" | "Substantial structured" | "Multi-modal" | "Real-time + historical";
  teamSize?: TeamSize;
  skillGaps: SkillGap[];
  execLiteracy?: ExecLiteracy;
  changeReadiness?: ChangeReadiness;
  useCases: UseCase[];
  roiTimeline?: RoiTimeline;
  challenges: Challenge[];
  email?: string;
};

const toolingOptions: ToolingOption[] = [
  "None",
  "TensorFlow/PyTorch",
  "Cloud AI services",
  "Custom ML platform",
  "MLOps pipeline",
  "Vector databases",
  "LLM infrastructure",
];

const privacyOptions: PrivacyOption[] = [
  "GDPR",
  "HIPAA",
  "SOC2",
  "AI ethics framework",
  "Model explainability",
  "Bias mitigation",
];

const skillGapOptions: SkillGap[] = [
  "ML Engineers",
  "Data Scientists",
  "MLOps Engineers",
  "AI Architects",
  "Data Engineers",
  "Product Managers (AI)",
  "AI Ethics/Governance",
  "Domain experts with AI",
];

const useCaseOptions: UseCase[] = [
  "Customer service automation",
  "Predictive analytics",
  "Process automation",
  "Personalization",
  "Fraud detection",
  "Quality control",
  "Supply chain",
  "Risk management",
  "Other",
];

const challengeOptions: Challenge[] = [
  "Budget",
  "Lack of talent",
  "Data quality",
  "Integration complexity",
  "Regulatory",
  "Executive buy-in",
  "Proving ROI",
  "Change management",
  "Security",
];

const LS_KEY = "enterprise_assessment_v1";

export default function EnterpriseAssessmentPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [data, setData] = useState<Assessment>({ tooling: [], privacy: [], skillGaps: [], useCases: [], challenges: [] });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data) setData({ ...parsed.data, tooling: parsed.data.tooling || [], privacy: parsed.data.privacy || [] });
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

  const totalSteps = 6;
  const progress = Math.round((step / totalSteps) * 100);

  const onNext = () => {
    const v = validateSection(step);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(totalSteps, s + 1));
  };

  const IntroDetails = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Full name</div>
        <input
          value={data.fullName || ""}
          onChange={(e) => setData((d) => ({ ...d, fullName: e.target.value }))}
          className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm"
          placeholder="Jane Smith"
        />
        {errors.fullName && <p className="mt-1 text-xs text-red-400">{errors.fullName}</p>}
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-300">Company</div>
        <input
          value={data.company || ""}
          onChange={(e) => setData((d) => ({ ...d, company: e.target.value }))}
          className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm"
          placeholder="Acme Corp"
        />
        {errors.company && <p className="mt-1 text-xs text-red-400">{errors.company}</p>}
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-300">Work email</div>
        <input
          type="email"
          value={data.email || ""}
          onChange={(e) => setData((d) => ({ ...d, email: e.target.value }))}
          className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm"
          placeholder="you@company.com"
        />
        {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
      </div>
    </div>
  );

  const onPrev = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

  const validateSection = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 1) {
      const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
      if (!data.fullName) e.fullName = "Enter your full name";
      if (!data.company) e.company = "Enter your company";
      if (!data.email || !emailRegex.test(data.email)) e.email = "Enter a valid email";
    } else if (s === 2) {
      if (!data.objective) e.objective = "Select an objective";
      if (!data.maturity) e.maturity = "Select maturity";
      if (!data.investment) e.investment = "Select investment";
    } else if (s === 3) {
      if (!data.cloud) e.cloud = "Select cloud maturity";
      if (!data.dataInfra) e.dataInfra = "Select data infrastructure";
      if (!data.api) e.api = "Select API capability";
      if (!data.tooling?.length) e.tooling = "Choose at least one tooling option";
    } else if (s === 4) {
      if (!data.dataQuality) e.dataQuality = "Select data quality";
      if (!data.governance) e.governance = "Select governance";
      if (!data.privacy?.length) e.privacy = "Select at least one privacy/compliance option";
      if (!data.dataVolume) e.dataVolume = "Select data volume/variety";
    } else if (s === 5) {
      if (!data.teamSize) e.teamSize = "Select team size";
      if (!data.skillGaps?.length) e.skillGaps = "Select at least one skill gap";
      if (!data.execLiteracy) e.execLiteracy = "Select executive AI literacy";
      if (!data.changeReadiness) e.changeReadiness = "Select change readiness";
    } else if (s === 6) {
      if (!data.useCases?.length) e.useCases = "Select at least one use case";
      if (!data.roiTimeline) e.roiTimeline = "Select ROI timeline";
      if (!data.challenges?.length) e.challenges = "Select at least one challenge";
      const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;
      if (!data.email || !emailRegex.test(data.email)) e.email = "Enter a valid email";
    }
    return e;
  };

  const SectionOne = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Primary business objective for AI?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Cost Reduction","Revenue Growth","Customer Experience","Operational Efficiency","Innovation","Competitive Advantage"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="objective" checked={data.objective === o} onChange={() => setData((d) => ({ ...d, objective: o as Objective }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.objective && <p className="mt-1 text-xs text-red-400">{errors.objective}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Current AI maturity level?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Exploring (no AI)","Experimenting (1-2 pilots)","Implementing (3-5 projects)","Scaling (across units)","Leading (AI-first)"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="maturity" checked={data.maturity === o} onChange={() => setData((d) => ({ ...d, maturity: o as Maturity }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.maturity && <p className="mt-1 text-xs text-red-400">{errors.maturity}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Planned AI investment (12 months)?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["<$100K","$100K-$500K","$500K-$2M","$2M-$10M",">$10M","Not Determined"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="investment" checked={data.investment === o} onChange={() => setData((d) => ({ ...d, investment: o as Investment }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.investment && <p className="mt-1 text-xs text-red-400">{errors.investment}</p>}
      </div>
    </div>
  );

  const SectionTwo = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Cloud infrastructure maturity?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["On-premise only","Hybrid cloud","Multi-cloud","Cloud-native modern stack"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="cloud" checked={data.cloud === o} onChange={() => setData((d) => ({ ...d, cloud: o as Cloud }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.cloud && <p className="mt-1 text-xs text-red-400">{errors.cloud}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Data infrastructure readiness?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Siloed databases","Basic warehouse","Modern data lake","Real-time platform with MLops"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="dataInfra" checked={data.dataInfra === o} onChange={() => setData((d) => ({ ...d, dataInfra: o as DataInfra }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.dataInfra && <p className="mt-1 text-xs text-red-400">{errors.dataInfra}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Current ML/AI tooling?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {toolingOptions.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="checkbox" checked={data.tooling.includes(o)} onChange={(e) => {
                const checked = e.target.checked;
                setData((d) => ({ ...d, tooling: checked ? Array.from(new Set([...(d.tooling||[]), o])) : (d.tooling||[]).filter((x) => x !== o) }));
              }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.tooling && <p className="mt-1 text-xs text-red-400">{errors.tooling}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">API capabilities?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Limited","Basic REST","Modern architecture","Event-driven real-time"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="api" checked={data.api === o} onChange={() => setData((d) => ({ ...d, api: o as ApiCap }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.api && <p className="mt-1 text-xs text-red-400">{errors.api}</p>}
      </div>
    </div>
  );

  const SectionThree = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Data quality/accessibility?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Poor/hard access","Decent/moderate","Good/accessible","Excellent/self-service"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="dataQuality" checked={data.dataQuality === o} onChange={() => setData((d) => ({ ...d, dataQuality: o as DataQuality }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.dataQuality && <p className="mt-1 text-xs text-red-400">{errors.dataQuality}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Data governance?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["No formal","Basic policies","Comprehensive framework","Automated with compliance"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="governance" checked={data.governance === o} onChange={() => setData((d) => ({ ...d, governance: o as Governance }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.governance && <p className="mt-1 text-xs text-red-400">{errors.governance}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Privacy/compliance?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {privacyOptions.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="checkbox" checked={data.privacy.includes(o)} onChange={(e) => {
                const checked = e.target.checked;
                setData((d) => ({ ...d, privacy: checked ? Array.from(new Set([...(d.privacy||[]), o])) : (d.privacy||[]).filter((x) => x !== o) }));
              }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.privacy && <p className="mt-1 text-xs text-red-400">{errors.privacy}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Data volume/variety?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Limited structured","Substantial structured","Multi-modal","Real-time + historical"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="dataVolume" checked={data.dataVolume === o} onChange={() => setData((d) => ({ ...d, dataVolume: o as any }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.dataVolume && <p className="mt-1 text-xs text-red-400">{errors.dataVolume}</p>}
      </div>
    </div>
  );

  const SectionFour = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Current AI/ML team size?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["No dedicated team","1-3 people","4-10","11-25","25+","Distributed across org"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="teamSize" checked={data.teamSize === o} onChange={() => setData((d) => ({ ...d, teamSize: o as TeamSize }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.teamSize && <p className="mt-1 text-xs text-red-400">{errors.teamSize}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Key skill gaps?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {skillGapOptions.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="checkbox" checked={data.skillGaps.includes(o)} onChange={(e) => {
                const checked = e.target.checked;
                setData((d) => ({ ...d, skillGaps: checked ? Array.from(new Set([...(d.skillGaps||[]), o])) : (d.skillGaps||[]).filter((x) => x !== o) }));
              }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.skillGaps && <p className="mt-1 text-xs text-red-400">{errors.skillGaps}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Executive AI literacy?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Low awareness","Basic understanding","Good grasp","Deep technical and strategic understanding"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="execLiteracy" checked={data.execLiteracy === o} onChange={() => setData((d) => ({ ...d, execLiteracy: o as ExecLiteracy }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.execLiteracy && <p className="mt-1 text-xs text-red-400">{errors.execLiteracy}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Change management readiness?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["Significant resistance","Some concerns","Cautiously optimistic","Strong enthusiasm"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="changeReadiness" checked={data.changeReadiness === o} onChange={() => setData((d) => ({ ...d, changeReadiness: o as ChangeReadiness }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.changeReadiness && <p className="mt-1 text-xs text-red-400">{errors.changeReadiness}</p>}
      </div>
    </div>
  );

  const SectionFive = () => (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-medium text-zinc-300">Most promising AI use cases?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {useCaseOptions.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="checkbox" checked={data.useCases.includes(o)} onChange={(e) => {
                const checked = e.target.checked;
                setData((d) => ({ ...d, useCases: checked ? Array.from(new Set([...(d.useCases||[]), o])) : (d.useCases||[]).filter((x) => x !== o) }));
              }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.useCases && <p className="mt-1 text-xs text-red-400">{errors.useCases}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Expected ROI timeline?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {["<6 months","6-12 months","1-2 years","2-3 years",">3 years"].map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="radio" name="roiTimeline" checked={data.roiTimeline === o} onChange={() => setData((d) => ({ ...d, roiTimeline: o as RoiTimeline }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.roiTimeline && <p className="mt-1 text-xs text-red-400">{errors.roiTimeline}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Biggest challenges?</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {challengeOptions.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm">
              <input type="checkbox" checked={data.challenges.includes(o)} onChange={(e) => {
                const checked = e.target.checked;
                setData((d) => ({ ...d, challenges: checked ? Array.from(new Set([...(d.challenges||[]), o])) : (d.challenges||[]).filter((x) => x !== o) }));
              }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {errors.challenges && <p className="mt-1 text-xs text-red-400">{errors.challenges}</p>}
      </div>

      <div>
        <div className="text-sm font-medium text-zinc-300">Where should we send your report?</div>
        <input
          type="email"
          value={data.email || ""}
          onChange={(e) => setData((d) => ({ ...d, email: e.target.value }))}
          className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          placeholder="you@company.com"
        />
        {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
      </div>

      <div className="mt-4">
        <button
          onClick={() => {
            const v = validateSection(5);
            if (Object.keys(v).length > 0) { setErrors(v); return; }
            localStorage.setItem("enterprise_assessment_result_v1", JSON.stringify({ data }));
            router.push("/assess/enterprise/report");
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
        >
          Generate Assessment Report
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-zinc-50 px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Enterprise AI Readiness Assessment</div>
            <div className="mt-1 text-sm text-zinc-400">Estimated time: 15-20 minutes to complete</div>
          </div>
          <div className="text-xs text-zinc-400">Saving {saving ? "…" : ""}</div>
        </div>
        <div className="mb-4">
          <div className="text-sm text-zinc-400">Section {step} of {totalSteps}</div>
          <div className="mt-2 h-2 w-full rounded-full bg-zinc-800">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${progress}%` }}></div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
          {step === 1 && <IntroDetails />}
          {step === 2 && <SectionOne />}
          {step === 3 && <SectionTwo />}
          {step === 4 && <SectionThree />}
          {step === 5 && <SectionFour />}
          {step === 6 && <SectionFive />}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button onClick={onPrev} disabled={step === 1} className="rounded-lg border border-white/10 bg-zinc-800 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">Previous</button>
          <div className="flex items-center gap-2">
            <button onClick={onNext} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}