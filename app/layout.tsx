import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import AuthProvider from "@/lib/auth/auth-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tuple AI Sales Agent",
  description: "Deploy a $0/month AI sales agent with free-tier APIs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0a0f] text-zinc-50`}>
        <div className="min-h-screen flex flex-col">
          <header className="z-20 w-full border-b border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
              <Link href="/" className="flex items-center gap-3">
                <Image src="/logo.png" alt="Tuple AI" width={32} height={32} className="h-8 w-8 rounded-lg border border-white/10 object-cover" />
                <span className="text-sm font-semibold tracking-wide">Tuple AI</span>
              </Link>
              <div className="hidden items-center gap-4 sm:flex">
                <Link href="/assess/enterprise" className="text-xs text-zinc-300">Assess</Link>
                <Link href="/prospects/discover" className="text-xs text-zinc-300">Discover</Link>
                <Link href="/dashboard" className="text-xs text-zinc-300">Dashboard</Link>
              </div>
            </div>
          </header>
          <main className="flex-1">
            <AuthProvider>
              {children}
            </AuthProvider>
          </main>
          <footer className="mt-12 border-t border-white/10 bg-white/5 py-6 backdrop-blur-xl">
            <div className="mx-auto max-w-7xl px-6 text-xs text-zinc-300">
              <div>Powered by Tuple AI</div>
              <div className="mt-1">© {new Date().getFullYear()} Tuple AI. All rights reserved.</div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
