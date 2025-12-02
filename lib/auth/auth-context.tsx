"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  if (process.env.NODE_ENV === "development") {
    const devUser = { id: "dev", email: "dev@local.com" } as any;
    const devProfile: Profile = { id: "dev", email: "dev@local.com", full_name: "Developer", company: "Local", role: "admin", subscription_status: "free", onboarding_completed: true };
    const mock: AuthContextType = {
      user: devUser,
      profile: devProfile,
      loading: false,
      isAdmin: true,
      signIn: async () => ({}),
      signUp: async () => ({}),
      signOut: async () => {},
    };
    return <Ctx.Provider value={mock}>{children}</Ctx.Provider>;
  }

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const u = data?.session?.user || null;
      if (!mounted) return;
      setUser(u);
      if (u) {
        const pr = await supabase.from("profiles").select("id,email,full_name,company,role,subscription_status,onboarding_completed").eq("user_id", u.id).single();
        setProfile((pr.data as any) || null);
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
        const pr = await supabase.from("profiles").select("id,email,full_name,company,role,subscription_status,onboarding_completed").eq("user_id", u.id).single();
        setProfile((pr.data as any) || null);
      } else {
        setProfile(null);
      }
    });
    return () => { sub?.subscription.unsubscribe(); mounted = false; };
  }, [supabase]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };
  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) return { error: error.message };
    const u = data.user;
    if (u) {
      await supabase.from("profiles").upsert({ user_id: u.id, email, full_name: fullName, company: null, role: "user", subscription_status: "free", onboarding_completed: false }, { onConflict: "user_id" });
    }
    return {};
  };
  const signOut = async () => {
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
