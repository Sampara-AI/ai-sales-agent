"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

type Assessment = any;

const Gauge = ({ value }: { value: number }) => {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      <svg className="h-40 w-40" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={radius} stroke="#1f2937" strokeWidth="12" fill="none" />
        <circle cx="80" cy="80" r={radius} stroke="#2563eb" strokeWidth="12" fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 80 80)" />
      </svg>
      <div className="absolute text-2xl font-bold">{clamped}/100</div>
    </div>
  );
};

export default function EnterpriseReportPage() {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string>("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("enterprise_assessment_result_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        setAssessment(parsed?.data || null);
        if (parsed?.serverReport) setAnalysis(parsed.serverReport);
      }
    } catch {}
    try {
      const params = new URLSearchParams(window.location.search);
      const c = params.get("company");
      if (c) setCompany(c);
    } catch {}
  }, []);

    const scores = useMemo(() => {
      const a = assessment || {};
      const strategic = (() => {
        let s = 0;
        s += a.objective ? 20 : 0;
        s += a.maturity ? ({ "Exploring (no AI)": 10, "Experimenting (1-2 pilots)": 40, "Implementing (3-5 projects)": 60, "Scaling (across units)": 80, "Leading (AI-first)": 95 } as any)[a.maturity] || 0 : 0;
        s += a.investment ? ({ "<$100K": 10, "$100K-$500K": 30, "$500K-$2M": 50, "$2M-$10M": 70, ">$10M": 90, "Not Determined": 20 } as any)[a.investment] || 0 : 0;
        return Math.min(100, Math.round(s / 2));
      })();
      const infrastructure = (() => {
        let s = 0;
        s += a.cloud ? ({ "On-premise only": 10, "Hybrid cloud": 50, "Multi-cloud": 70, "Cloud-native modern stack": 90 } as any)[a.cloud] || 0 : 0;
        s += a.dataInfra ? ({ "Siloed databases": 15, "Basic warehouse": 40, "Modern data lake": 70, "Real-time platform with MLops": 90 } as any)[a.dataInfra] || 0 : 0;
        s += Array.isArray(a.tooling) ? Math.min(40, a.tooling.length * 8) : 0;
        s += a.api ? ({ "Limited": 10, "Basic REST": 40, "Modern architecture": 70, "Event-driven real-time": 85 } as any)[a.api] || 0 : 0;
        return Math.min(100, Math.round(s / 3));
      })();
      const dataMaturity = (() => {
        let s = 0;
        s += a.dataQuality ? ({ "Poor/hard access": 10, "Decent/moderate": 40, "Good/accessible": 70, "Excellent/self-service": 90 } as any)[a.dataQuality] || 0 : 0;
        s += a.governance ? ({ "No formal": 10, "Basic policies": 40, "Comprehensive framework": 70, "Automated with compliance": 90 } as any)[a.governance] || 0 : 0;
        s += Array.isArray(a.privacy) ? Math.min(40, a.privacy.length * 8) : 0;
        s += a.dataVolume ? ({ "Limited structured": 25, "Substantial structured": 50, "Multi-modal": 70, "Real-time + historical": 85 } as any)[a.dataVolume] || 0 : 0;
        return Math.min(100, Math.round(s / 3));
      })();
      const teamCapability = (() => {
        let s = 0;
        s += a.teamSize ? ({ "No dedicated team": 10, "1-3 people": 30, "4-10": 50, "11-25": 70, "25+": 85, "Distributed across org": 75 } as any)[a.teamSize] || 0 : 0;
        s += Array.isArray(a.skillGaps) ? Math.max(0, 40 - a.skillGaps.length * 5) : 40;
        s += a.execLiteracy ? ({ "Low awareness": 10, "Basic understanding": 40, "Good grasp": 70, "Deep technical and strategic understanding": 90 } as any)[a.execLiteracy] || 0 : 0;
        s += a.changeReadiness ? ({ "Significant resistance": 10, "Some concerns": 40, "Cautiously optimistic": 65, "Strong enthusiasm": 85 } as any)[a.changeReadiness] || 0 : 0;
        return Math.min(100, Math.round(s / 3));
      })();
      const roiPotential = (() => {
        let s = 0;
        s += Array.isArray(a.useCases) ? Math.min(50, a.useCases.length * 10) : 0;
        s += a.roiTimeline ? ({ "<6 months": 90, "6-12 months": 75, "1-2 years": 60, "2-3 years": 45, ">3 years": 30 } as any)[a.roiTimeline] || 0 : 0;
        s += Array.isArray(a.challenges) ? Math.max(0, 40 - a.challenges.length * 5) : 40;
        return Math.min(100, Math.round(s / 3));
      })();
      const overall = Math.round((strategic + infrastructure + dataMaturity + teamCapability + roiPotential) / 5);
      return { strategic, infrastructure, dataMaturity, teamCapability, roiPotential, overall };
    }, [assessment]);

  useEffect(() => {
    if (analysis) return;
    const a = assessment || {};
    const lines: string[] = [];
    lines.push(`# Executive Summary`);
    lines.push(`Overall Readiness Score: ${scores.overall}/100.`);
    lines.push(`Maturity: ${scores.overall < 30 ? "Early" : scores.overall < 70 ? "Developing" : "Advanced"}.`);
    lines.push(``);
    lines.push(`## Key Findings`);
    lines.push(`- Strategic Alignment: ${scores.strategic}/100`);
    lines.push(`- Infrastructure: ${scores.infrastructure}/100`);
    lines.push(`- Data Maturity: ${scores.dataMaturity}/100`);
    lines.push(`- Team Capability: ${scores.teamCapability}/100`);
    lines.push(`- ROI Potential: ${scores.roiPotential}/100`);
    lines.push(``);
    lines.push(`## Recommendations`);
    lines.push(`1. Prioritize ${scores.infrastructure < 60 ? "cloud modernization and MLOps" : scores.dataMaturity < 60 ? "data governance and self-service" : "scaling AI use cases with measurable ROI"}.`);
    lines.push(`2. Address skill gaps in ${Array.isArray(a.skillGaps) && a.skillGaps.length ? a.skillGaps[0] : "core AI roles"}.`);
    lines.push(`3. Define a 12-month roadmap aligned to ${a.objective || "top business objectives"}.`);
    setAnalysis(lines.join("\n"));
  }, [assessment, scores, analysis]);

  const maturityColor = scores.overall < 30 ? "bg-red-700/40 text-red-300" : scores.overall < 70 ? "bg-yellow-700/40 text-yellow-300" : "bg-green-700/40 text-green-300";

  const radarData = [
    { category: "Strategic Alignment", score: scores.strategic },
    { category: "Infrastructure", score: scores.infrastructure },
    { category: "Data Maturity", score: scores.dataMaturity },
    { category: "Team Capability", score: scores.teamCapability },
    { category: "ROI Potential", score: scores.roiPotential },
  ];

  const onDownload = async () => {
    if (!containerRef.current) return;
    try {
      const html2pdf = (await import("html2pdf.js")).default as any;
      const opt = { margin: 0.5, filename: "Enterprise_AI_Readiness_Report.pdf", image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: "in", format: "letter", orientation: "portrait" } } as any;
      html2pdf().set(opt).from(containerRef.current).save();
    } catch {
      try { window.print(); } catch {}
    }
  };

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState(assessment?.email || "");
  const [sendSubject, setSendSubject] = useState("AI Readiness Report");
  const [sendName, setSendName] = useState("");
  const [sendFrom, setSendFrom] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => {
    setSendTo(assessment?.email || "");
  }, [assessment]);
  const sendReport = async () => {
    setSendError(null);
    if (!sendTo || !sendName || !sendFrom) { setSendError("Enter recipient, your name, and email"); return; }
    const textBody = analysis + "\n\nScore: " + scores.overall + "/100";
    const mailto = `mailto:${encodeURIComponent(sendTo)}?subject=${encodeURIComponent(sendSubject)}&body=${encodeURIComponent(textBody)}`;
    window.location.href = mailto;
    setSendOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-zinc-50">
      <div ref={containerRef} className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">Enterprise AI Readiness Assessment</div>
            {company && <div className="mt-1 text-sm text-zinc-400">{company}</div>}
          </div>
          <div className={`rounded-full px-3 py-1 text-sm ${maturityColor}`}>{scores.overall < 30 ? "Early" : scores.overall < 70 ? "Developing" : "Advanced"}</div>
        </div>

        <div className="mb-10 flex flex-col items-center justify-center sm:flex-row sm:items-end sm:justify-between">
          <Gauge value={scores.overall} />
          <div className="mt-6 sm:mt-0">
            <div className="text-4xl font-bold">{scores.overall}/100</div>
          </div>
        </div>

        <div className="mb-10">
          <div className="hidden rounded-2xl border border-white/10 bg-zinc-900 p-4 sm:block">
            <div className="mb-3 text-sm text-zinc-300">Category Scores</div>
            <div className="h-64">
              <ResponsiveContainer>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="category" tick={{ fill: "#d1d5db", fontSize: 12 }} />
                  <Radar name="Score" dataKey="score" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="sm:hidden rounded-2xl border border-white/10 bg-zinc-900 p-4">
            <div className="mb-3 text-sm text-zinc-300">Category Scores</div>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={radarData}>
                  <XAxis dataKey="category" tick={{ fill: "#d1d5db", fontSize: 11 }} interval={0} angle={-30} height={60} />
                  <YAxis tick={{ fill: "#d1d5db", fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="score" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mb-10 rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <div className="mb-4 text-xl font-semibold">Detailed Analysis</div>
          <div className="prose prose-invert max-w-none">
            <ReactMarkdown
              components={{
                h2: ({ children }) => <h2 className="mt-4 mb-2 text-2xl font-bold">{children}</h2>,
                h3: ({ children }) => <h3 className="mt-3 mb-2 text-xl font-semibold">{children}</h3>,
                p: ({ children }) => <p className="leading-7 text-zinc-200">{children}</p>,
                ul: ({ children }) => <ul className="ml-5 list-disc space-y-1 text-zinc-200">{children}</ul>,
                ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1 text-zinc-200">{children}</ol>,
                li: ({ children }) => <li className="text-zinc-200">{children}</li>,
                code: ({ children }) => <code className="rounded bg-zinc-700 px-1 py-0.5 text-zinc-100">{children}</code>,
                hr: () => <hr className="my-4 border-white/10" />,
              }}
            >
              {analysis}
            </ReactMarkdown>
          </div>
        </div>

        <div className="mb-10 flex flex-wrap items-center gap-3">
          <a href="/book?type=enterprise" className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500">📅 Book 30-Min Strategy Call</a>
          <button onClick={onDownload} className="rounded-lg bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-700">📄 Download Full Report (PDF)</button>
          <button onClick={() => setSendOpen(true)} className="rounded-lg bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-700">📧 Email Report to Team</button>
        </div>

        {sendOpen && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6">
              <div className="mb-3 text-lg font-semibold">Email Report</div>
              {sendError && <div className="mb-2 rounded border border-red-600/30 bg-red-900/30 p-2 text-sm text-red-300">{sendError}</div>}
              <div className="space-y-3">
                <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="Recipient email" className="w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" />
                <input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} placeholder="Subject" className="w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" />
                <input value={sendName} onChange={(e) => setSendName(e.target.value)} placeholder="Your name" className="w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" />
                <input value={sendFrom} onChange={(e) => setSendFrom(e.target.value)} placeholder="Your email" className="w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-sm" />
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={() => setSendOpen(false)} className="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-100">Cancel</button>
                <button onClick={sendReport} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">Send</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
