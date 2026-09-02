import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getMyFarmerProfile } from "../lib/api/farmer";

const AuthContext = createContext(null);

// Supabase Auth is email-based, but farmers log in with their RSBSA number
// (paper FR 3.2.1). Every farmer account was seeded with a synthetic email
// derived the same way: strip everything but digits/letters from the RSBSA
// number and append @farmer.agrishare.local — see backend/scripts/seed.mjs.
function rsbsaToSyntheticEmail(rsbsaNo) {
  return `${rsbsaNo.replace(/[^a-z0-9]/gi, "")}@farmer.agrishare.local`;
}

export function AuthProvider({ children }) {
  const [farmer, setFarmer] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const profile = await getMyFarmerProfile(session.user.id);
        if (!cancelled) setFarmer(profile);
      } catch {
        await supabase.auth.signOut();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setFarmer(null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function login(rsbsaNo, password) {
    const email = rsbsaToSyntheticEmail(rsbsaNo);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await getMyFarmerProfile(data.user.id);
    setFarmer(profile);
    return profile;
  }

  async function logout() {
    await supabase.auth.signOut();
    setFarmer(null);
  }

  // Explicit global scope — invalidates every refresh token for this user,
  // not just this device's. Distinct from logout() so "Log Out" and "Log
  // Out of All Devices" are honest about what each one actually does.
  async function logoutEverywhere() {
    await supabase.auth.signOut({ scope: "global" });
    setFarmer(null);
  }

  return (
    <AuthContext.Provider value={{ farmer, isAuthenticated: !!farmer, initializing, login, logout, logoutEverywhere }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
