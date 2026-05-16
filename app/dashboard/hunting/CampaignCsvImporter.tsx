"use client";

import { useMemo, useState } from "react";

export default function CampaignCsvImporter({ campaignId }: { campaignId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useMemo(() => ".csv,text/csv", []);

  const upload = async () => {
    try {
      setError(null);
      if (!file) {
        setError("Choose a CSV file first");
        return;
      }
      setBusy(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/import`, { method: "POST", body: fd, headers: { accept: "application/json" } });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(json?.error || "Import failed"));
      const imported = typeof json?.imported === "number" ? json.imported : 0;
      const skipped = typeof json?.skipped_duplicates === "number" ? json.skipped_duplicates : 0;
      window.location.href = `/dashboard/hunting?campaign=${encodeURIComponent(campaignId)}&import=${encodeURIComponent(String(imported))}&skipped=${encodeURIComponent(String(skipped))}#process-${encodeURIComponent(campaignId)}`;
    } catch (e: any) {
      setError(String(e?.message || "Import failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700">Import CSV</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={accept}
          onChange={(e) => setFile(e.currentTarget.files?.[0] || null)}
          className="text-sm"
        />
        <button
          type="button"
          onClick={upload}
          disabled={busy}
          className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-amber-700">{error}</div>}
      <div className="mt-2 text-xs text-slate-500">Headers supported: domain,email,name,title,company,industry,linkedin_url,notes</div>
    </div>
  );
}

