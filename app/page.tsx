"use client";
import { useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

type FormData = {
  name: string;
  email: string;
  company: string;
  role: string;
  painPoints: string;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

type AIResult = {
  score: number;
  reasoning: string;
  priority: "high" | "medium" | "low";
};

export default function Home() {
  const router = useRouter();
  const formRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<FormData>({
    name: "",
    email: "",
    company: "",
    role: "",
    painPoints: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);

  const validate = (data: FormData): FormErrors => {
    const e: FormErrors = {};
    if (!data.name.trim()) e.name = "Name is required";
    if (!data.email.trim()) e.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(data.email)) e.email = "Invalid email";
    return e;
  };

  const handleChange = (
    field: keyof FormData,
    value: string
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccessMessage(null);
    setSubmitError(null);
    setAiError(null);
    setAiResult(null);

    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as
      | string
      | undefined;

    if (!url || !anonKey) {
      setSubmitError("Supabase configuration missing. Set required environment variables.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient(url, anonKey);
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        role: form.role.trim(),
        pain_points: form.painPoints.trim(),
      };
      const { error } = await supabase.from("leads").insert(payload);

      if (error) {
        setSubmitError(error.message ?? "Failed to save lead");
        return;
      }

      setSuccessMessage("Thanks! Your info has been captured.");
      setForm({ name: "", email: "", company: "", role: "", painPoints: "" });

      setAiLoading(true);
      try {
        const res = await fetch("/api/score-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAiError(data?.error || "Failed to analyze lead");
        } else {
          const data: AIResult = await res.json();
          setAiResult(data);
        }
      } catch {
        setAiError("Network error while analyzing lead");
      } finally {
        setAiLoading(false);
      }
    } catch (err) {
      setSubmitError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-50 flex items-center justify-center px-6">
      <main className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-8 rounded-2xl border border-white/10 bg-zinc-800 p-6 shadow">
          <div className="text-center">
            <div className="mx-auto w-full">
              <div className="rounded-xl border border-white/15 bg-zinc-900 p-4">
                <div className="text-sm text-zinc-400">Tuple AI - Build AI Capability</div>
                <div className="mt-1 text-xs text-zinc-500">Not Just Buy AI Services</div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="rounded-xl border border-blue-600/30 bg-blue-700/40 px-4 py-4 text-left text-white transition-colors hover:bg-blue-600/60"
              >
                <div className="text-base font-semibold">Assess Enterprise Readiness</div>
                <div className="mt-1 text-sm text-blue-100/90">Custom roadmap for AI implementation</div>
              </button>
              <button
                onClick={() => router.push("/chat")}
                className="rounded-xl border border-white/10 bg-zinc-700/40 px-4 py-4 text-left text-zinc-100 transition-colors hover:bg-zinc-700"
              >
                <div className="text-base font-semibold">Evaluate Team AI Skills</div>
                <div className="mt-1 text-sm text-zinc-300">Discover if upskilling beats hiring</div>
              </button>
            </div>
          </div>
        </div>
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Tell us about your needs</h1>
          <p className="mt-2 text-zinc-400">Share a bit so we can tailor a demo.</p>
        </div>

        {successMessage && (
          <div className="mb-6 rounded-lg border border-green-600/30 bg-green-900/30 p-4 text-green-300">
            {successMessage}
          </div>
        )}
        {submitError && (
          <div className="mb-6 rounded-lg border border-red-600/30 bg-red-900/30 p-4 text-red-300">
            {submitError}
          </div>
        )}

        {aiLoading && (
          <div className="mb-6 rounded-lg border border-blue-600/30 bg-blue-900/30 p-4 text-blue-300">
            AI is analyzing your profile...
          </div>
        )}
        {aiError && (
          <div className="mb-6 rounded-lg border border-red-600/30 bg-red-900/30 p-4 text-red-300">
            {aiError}
          </div>
        )}
        {aiResult && (
          <div className="mb-6 rounded-xl border border-white/10 bg-zinc-800 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xl font-semibold">AI Lead Score: {aiResult.score}</div>
              <span
                className={
                  "inline-flex items-center rounded-full border px-3 py-1 text-sm " +
                  (aiResult.priority === "high"
                    ? "border-green-600/40 bg-green-700/30 text-green-300"
                    : aiResult.priority === "medium"
                    ? "border-yellow-600/40 bg-yellow-700/30 text-yellow-300"
                    : "border-white/10 bg-zinc-700/40 text-zinc-300")
                }
              >
                {aiResult.priority.toUpperCase()}
              </span>
            </div>
            <p className="mt-3 text-zinc-300">{aiResult.reasoning}</p>
          </div>
        )}

        <div ref={formRef} />
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-300">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Doe"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-400">{errors.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="jane@company.com"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-400">{errors.email}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Company</label>
            <input
              type="text"
              value={form.company}
              onChange={(e) => handleChange("company", e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Acme Inc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Role</label>
            <input
              type="text"
              value={form.role}
              onChange={(e) => handleChange("role", e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Head of Sales"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Pain Points</label>
            <textarea
              value={form.painPoints}
              onChange={(e) => handleChange("painPoints", e.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="What are you hoping to solve?"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"></span>
                Submitting...
              </span>
            ) : (
              "Submit"
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
