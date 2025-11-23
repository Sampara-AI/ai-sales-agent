"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter, useSearchParams } from "next/navigation";

type Profile = { id: string; user_id: string; name?: string | null; role?: string | null; company?: string | null } | null;

type AuthCtx = {
  user: any;
  profile: Profile;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (name: string, email: string, password: string, company?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const u = data?.session?.user || null;
      if (!mounted) return;
      setUser(u);
      if (u) {
        const pr = await supabase.from("profiles").select("id,user_id,name,role,company,onboarding_completed").eq("user_id", u.id).single();
        setProfile((pr.data as any) || null);
        const next = search?.get("next");
        if ((pr.data as any)?.onboarding_completed === false) {
          router.replace("/onboarding");
        } else if (next) {
          router.replace(next);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
      const u = sess?.user || null;
      setUser(u);
      if (u) {
        const pr = await supabase.from("profiles").select("id,user_id,name,role,company,onboarding_completed").eq("user_id", u.id).single();
        setProfile((pr.data as any) || null);
        const next = search?.get("next");
        if ((pr.data as any)?.onboarding_completed === false) {
          router.replace("/onboarding");
        } else {
          router.replace(next || "/dashboard");
        }
      } else {
        setProfile(null);
      }
    });
    return () => { sub?.subscription.unsubscribe(); mounted = false; };
  }, [supabase]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };
  const signUp = async (name: string, email: string, password: string, company?: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, company } } });
    if (error) return { error: error.message };
    const u = data.user;
    if (u) {
      await supabase.from("profiles").upsert({ user_id: u.id, name, company, role: "user", onboarding_completed: false }, { onConflict: "user_id" });
    }
    return {};
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    router.replace("/");
  };

  const isAdmin = !!profile && (profile as any)?.role === "admin";

  return (
    <Ctx.Provider value={{ user, profile, loading, signIn, signUp, signOut, isAdmin }}>{children}</Ctx.Provider>
  );
}