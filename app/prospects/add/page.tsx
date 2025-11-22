"use client";
import { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type FormData = {
  name: string;
  title: string;
  company: string;
  companySize: "1-50" | "51-200" | "201-1000" | "1000+" | "";
  industry: "Technology" | "SaaS" | "Fintech" | "Healthcare" | "Manufacturing" | "Other" | "";
  linkedinUrl: string;
  email: string;
  recentActivity: string;
  notes: string;
};

type Errors = Partial<Record<keyof FormData, string>>;

export default function AddProspectPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) return createClient(url, anonKey);
    return null;
  }, []);

  const [form, setForm] = useState<FormData>({
    name: "",
    title: "",
    company: "",
    companySize: "",
    industry: "",
    linkedinUrl: "",
    email: "",
    recentActivity: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (data: FormData): Errors => {
    const e: Errors = {};
    if (!data.name.trim()) e.name = "Name is required";
    if (!data.company.trim()) e.company = "Company is required";
    return e;
  };

  const handleChange = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccess(null);
    setSubmitError(null);
    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    if (!supabase) {
      setSubmitError("Supabase configuration missing");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        title: form.title.trim() || null,
        company: form.company.trim(),
        company_size: form.companySize || null,
        industry: form.industry || null,
        linkedin_url: form.linkedinUrl.trim() || null,
        email: form.email.trim() || null,
        recent_activity: form.recentActivity.trim() || null,
        notes: form.notes.trim() || null,
        status: "discovered",
        source: "manual",
      };
      const { error } = await supabase.from("prospects").insert(payload);
      if (error) {
        setSubmitError(error.message ?? "Failed to save prospect");
        return;
      }
      setSuccess("Prospect added successfully.");
      setForm({
        name: "",
        title: "",
        company: "",
        companySize: "",
        industry: "",
        linkedinUrl: "",
        email: "",
        recentActivity: "",
        notes: "",
      });
    } catch (err) {
      setSubmitError("Unexpected error while saving");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-50 px-6 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Add Prospect</h1>
          <p className="mt-2 text-zinc-400">Quickly add prospects while we build automation.</p>
        </div>

        {success && (
          <div className="mb-6 rounded-lg border border-green-600/30 bg-green-900/30 p-4 text-green-300">
            {success}
            <div className="mt-3 flex gap-3">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setSuccess(null);
                }}
                className="inline-flex items-center rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-700"
              >
                Add another
              </a>
              <a
                href="/prospects"
                className="inline-flex items-center rounded-lg border border-white/10 bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500"
              >
                View all prospects
              </a>
            </div>
          </div>
        )}
        {submitError && (
          <div className="mb-6 rounded-lg border border-red-600/30 bg-red-900/30 p-4 text-red-300">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-300">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleChange("name", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="Jane Doe"
              />
              {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="VP of Engineering"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300">Company *</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => handleChange("company", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="Acme Corp"
              />
              {errors.company && <p className="mt-1 text-sm text-red-400">{errors.company}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300">Company Size</label>
              <select
                value={form.companySize}
                onChange={(e) => handleChange("companySize", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select</option>
                <option value="1-50">1-50</option>
                <option value="51-200">51-200</option>
                <option value="201-1000">201-1000</option>
                <option value="1000+">1000+</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300">Industry</label>
              <select
                value={form.industry}
                onChange={(e) => handleChange("industry", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select</option>
                <option value="Technology">Technology</option>
                <option value="SaaS">SaaS</option>
                <option value="Fintech">Fintech</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Manufacturing">Manufacturing</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300">LinkedIn URL</label>
              <input
                type="url"
                value={form.linkedinUrl}
                onChange={(e) => handleChange("linkedinUrl", e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="https://linkedin.com/in/janedoe"
              />
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
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Recent Activity</label>
            <textarea
              value={form.recentActivity}
              onChange={(e) => handleChange("recentActivity", e.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Paste their recent LinkedIn post or news"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-zinc-800 p-3 text-zinc-50 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional context"
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
                Saving...
              </span>
            ) : (
              "Save Prospect"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}