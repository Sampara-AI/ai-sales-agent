"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  role: string;
  subscription_status: string;
  onboarding_completed: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthContextType | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthContext missing provider");
  return v;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const demoMode = String(process.env.NEXT_PUBLIC_DEMO_MODE || "").toLowerCase() === "true";
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (demoMode) {
      setUser({ id: "demo-user" } as unknown as User);
      setProfile({
        id: "demo-profile",
        email: "demo@local",
        full_name: "Demo",
        company: null,
        role: "admin",
        subscription_status: "free",
        onboarding_completed: true,
      });
      setLoading(false);
      return;
    }
    let mounted = true;
    const init = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const u = data?.session?.user || null;
        if (!mounted) return;
        setUser(u);
        if (u) {
          try {
            const pr = await supabase
              .from("profiles")
              .select("id,email,full_name,company,role,subscription_status,onboarding_completed")
              .eq("user_id", u.id)
              .single();
            setProfile((pr.data as unknown as Profile | null) || null);
          } catch {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      } catch {
        if (!mounted) return;
        setUser(null);
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
      try {
        const u = sess?.user || null;
        setUser(u);
        if (u) {
          try {
            const pr = await supabase
              .from("profiles")
              .select("id,email,full_name,company,role,subscription_status,onboarding_completed")
              .eq("user_id", u.id)
              .single();
            setProfile((pr.data as unknown as Profile | null) || null);
          } catch {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      } catch {
        setUser(null);
        setProfile(null);
      }
    });
    return () => { sub?.subscription.unsubscribe(); mounted = false; };
  }, [supabase, demoMode]);

  const signIn = async (email: string, password: string) => {
    if (demoMode) return {};
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };
  const signUp = async (email: string, password: string, fullName: string) => {
    if (demoMode) return {};
    if (String(process.env.NEXT_PUBLIC_DISABLE_SIGNUP || "").toLowerCase() === "true") {
      return { error: "Sign-up is disabled. Ask your admin for an invite." };
    }
    const redirectTo = (typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL) || undefined;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: redirectTo } });
    if (error) return { error: error.message };
    const u = data.user;
    if (u) {
      const isAdminEmail = String(email).toLowerCase() === "sri@tupleai.co.in";
      await supabase.from("profiles").upsert({ user_id: u.id, email, full_name: fullName, company: null, role: isAdminEmail ? "admin" : "user", subscription_status: "free", onboarding_completed: false }, { onConflict: "user_id" });
    }
    return {};
  };
  const signOut = async () => {
    if (demoMode) {
      router.replace("/dashboard");
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    router.replace("/");
  };

  const isAdmin = (profile?.role || "") === "admin";

  return (
    <Ctx.Provider value={{ user, profile, loading, signIn, signUp, signOut, isAdmin }}>{children}</Ctx.Provider>
  );
}
