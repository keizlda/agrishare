import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

const AuthContext = createContext(null);

// DB role enum -> UI display role. Every page's role checks (Topbar,
// AppLayout, Farmers/Distributions/Requests "isMAO" checks) compare against
// these exact strings, so the mapping happens once, here, at the auth boundary.
const ROLE_LABELS = {
  mao_admin: "MAO Admin",
  fa_president: "FA President",
};

const ROLE_PROFILES = {
  "MAO Admin": { office: "Municipality of Agriculture Office - Labangan" },
  "FA President": { office: "Farmers' Association - Barangay Langapud" },
};

async function loadProfile(authUser) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, full_name, contact_no")
    .eq("id", authUser.id)
    .single();
  if (error) throw error;

  const role = ROLE_LABELS[profile.role];
  if (!role) {
    // Farmer accounts (mobile-only) shouldn't be able to use the web console.
    throw new Error("This account does not have access to the AgriShare web console.");
  }

  return {
    id: authUser.id,
    email: authUser.email,
    name: profile.full_name,
    role,
    office: ROLE_PROFILES[role]?.office ?? "",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const profile = await loadProfile(session.user);
        if (!cancelled) setUser(profile);
      } catch {
        await supabase.auth.signOut();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await loadProfile(data.user);
    setUser(profile);
    return profile;
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, initializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
