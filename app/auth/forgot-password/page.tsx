"use client";
import { useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/client";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const onSubmit = async () => {
    setError(null);
    setOk(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) { setError(error.message); return; }
    setOk("Reset link sent");
  };
  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}> 
      <div className="mx-auto w-full max-w-md rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
        <div className="text-lg font-semibold">Reset Password</div>
        {error && <div className="mt-3 rounded border border-red-600/30 bg-red-900/30 p-2 text-sm text-red-300">{error}</div>}
        {ok && <div className="mt-3 rounded border border-green-600/30 bg-green-900/30 p-2 text-sm text-green-300">{ok}</div>}
        <div className="mt-4 space-y-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
          <button onClick={onSubmit} disabled={loading} className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-60">{loading ? "…" : "Send Reset Link"}</button>
          <div className="text-xs"><a href="/auth/login" className="text-blue-300">Back to Sign In</a></div>
        </div>
      </div>
    </div>
  );
}