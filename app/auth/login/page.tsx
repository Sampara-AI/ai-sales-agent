"use client";
import { useState } from "react";
import { Nunito_Sans } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import AuthProvider, { useAuth } from "@/lib/auth/auth-context";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    const res = await signIn(email, password);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    const next = search?.get("next");
    router.replace(next || "/dashboard");
  };
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl">
      <div className="text-lg font-semibold">Sign In</div>
      {error && <div className="mt-3 rounded border border-red-600/30 bg-red-900/30 p-2 text-sm text-red-300">{error}</div>}
      <div className="mt-4 space-y-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-white/20 bg-white/10 p-3 text-sm" />
        <button onClick={onSubmit} disabled={loading} className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-60">{loading ? "…" : "Sign In"}</button>
        <div className="flex items-center justify-between text-xs">
          <a href="/auth/signup" className="text-blue-300">Create account</a>
          <a href="/auth/forgot-password" className="text-blue-300">Forgot password?</a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className={`${nunito.className} min-h-screen bg-[#0a0a0f] text-zinc-50`}> 
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      </div>
    </div>
  );
}