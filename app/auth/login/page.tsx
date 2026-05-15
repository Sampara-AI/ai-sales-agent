import { Nunito_Sans } from "next/font/google";

const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["300", "400", "600", "700", "800"] });

export default function LoginPage() {
  return (
    <div className={`${nunito.className} min-h-screen bg-slate-50 text-slate-900`}>
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold">Evaluator Access</div>
          <div className="mt-4">
            <a href="/dashboard/hunting" className="block w-full rounded-xl bg-slate-900 px-4 py-2 text-center text-sm text-white">
              Launch Platform
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
