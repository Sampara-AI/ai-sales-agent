"use client";

import { useEffect, useState } from "react";

type AiSettings = {
  brand_name: string;
  brand_website: string;
  brand_one_liner: string;
  tone: string;
  cta_text: string;
  cta_url: string;
  sender_name: string;
  sender_title: string;
  sender_company: string;
  credibility_line: string;
  banned_phrases: string[];
};

export default function AiSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);

  const load = async () => {
    try {
      setError(null);
      setBanner(null);
      setLoading(true);
      const res = await fetch("/api/admin/ai-settings");
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error || "Failed to load settings"));
      setSettings((json?.settings || null) as AiSettings | null);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load settings"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    try {
      if (!settings) return;
      setError(null);
      setBanner(null);
      setSaving(true);
      const res = await fetch("/api/admin/ai-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error || "Save failed"));
      setSettings((json?.settings || settings) as AiSettings);
      setBanner("Saved.");
    } catch (e: any) {
      setError(String(e?.message || "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-slate-600">Loading…</div>;
  if (!settings) return <div className="p-6 text-sm text-slate-600">No settings.</div>;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold text-slate-900">AI Settings</div>
          <div className="mt-1 text-sm text-slate-500">Controls tone, brand positioning, CTA, and banned phrases for outreach generation.</div>
        </div>
        <button onClick={save} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {banner && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{banner}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-800">Brand</div>
          <div className="mt-3 space-y-3">
            <input value={settings.brand_name} onChange={(e) => setSettings((s) => (s ? { ...s, brand_name: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Brand name" />
            <input value={settings.brand_website} onChange={(e) => setSettings((s) => (s ? { ...s, brand_website: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Brand website" />
            <textarea value={settings.brand_one_liner} onChange={(e) => setSettings((s) => (s ? { ...s, brand_one_liner: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" rows={3} placeholder="One-liner value proposition" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-800">Tone & CTA</div>
          <div className="mt-3 space-y-3">
            <textarea value={settings.tone} onChange={(e) => setSettings((s) => (s ? { ...s, tone: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" rows={4} placeholder="Tone instructions" />
            <input value={settings.cta_text} onChange={(e) => setSettings((s) => (s ? { ...s, cta_text: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="CTA text" />
            <input value={settings.cta_url} onChange={(e) => setSettings((s) => (s ? { ...s, cta_url: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="CTA URL" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-800">Sender</div>
          <div className="mt-3 space-y-3">
            <input value={settings.sender_name} onChange={(e) => setSettings((s) => (s ? { ...s, sender_name: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Sender name" />
            <input value={settings.sender_title} onChange={(e) => setSettings((s) => (s ? { ...s, sender_title: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Sender title" />
            <input value={settings.sender_company} onChange={(e) => setSettings((s) => (s ? { ...s, sender_company: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Sender company" />
            <input value={settings.credibility_line} onChange={(e) => setSettings((s) => (s ? { ...s, credibility_line: e.target.value } : s))} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm" placeholder="Credibility line (optional)" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-800">Banned Phrases</div>
          <div className="mt-1 text-xs text-slate-500">Any generated email containing these will be treated as invalid and regenerated.</div>
          <textarea
            value={settings.banned_phrases.join("\n")}
            onChange={(e) => setSettings((s) => (s ? { ...s, banned_phrases: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) } : s))}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
            rows={6}
            placeholder="One phrase per line"
          />
        </div>
      </div>
    </div>
  );
}

