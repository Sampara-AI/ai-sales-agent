"use client";
import { useState, Suspense } from "react";
import { Nunito_Sans } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import AuthProvider, { useAuth } from "@/lib/auth/auth-context";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { signIn } = useAuth();
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    const next = search?.get("next") || "/dashboard/hunting";
    if (demoMode) {
      if (typeof window !== "undefined") window.location.assign(next);
      return;
    }
    if (!demoMode) {
      const res = await signIn(email, password);
      setLoading(false);
      if (res.error) { setError(res.error); return; }
    }
    router.replace(next);
  };
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-lg font-semibold">{demoMode ? "Evaluator Access" : "Sign In"}</div>
      {error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
      <div className="mt-4 space-y-3">
        {!demoMode && (
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
        )}
        {!demoMode && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900" />
        )}
        <button onClick={onSubmit} disabled={loading} className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">{loading ? "…" : (demoMode ? "Enter Demo" : "Sign In")}</button>
        {!demoMode && (
          <div className="flex items-center justify-between text-xs">
            <a href="/auth/signup" className="text-slate-700 underline">Create account</a>
            <a href="/auth/forgot-password" className="text-slate-700 underline">Forgot password?</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <AuthProvider>
          <Suspense>
            <LoginForm />
          </Suspense>
        </AuthProvider>
      </div>
    </div>
  );
}
