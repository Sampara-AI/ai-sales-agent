"use client";

import { useRouter } from "next/navigation";
import { Nunito_Sans } from "next/font/google";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

export default function Home() {
  const router = useRouter();

  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
        <button
          type="button"
          onClick={() => router.push("/auth/signup")}
          className="rounded-xl bg-slate-900 px-8 py-4 text-base font-semibold text-white transition hover:bg-slate-800"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
