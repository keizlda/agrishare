import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getMyFarmerProfile } from "../lib/api/farmer";

const AuthContext = createContext(null);

// Supabase Auth is email-based, but farmers log in with just the last 6
// digits of their RSBSA number (the sequence group of RR-PP-MM-BBB-NNNNNN —
// paper FR 3.2.1). Every farmer account's real auth email is
// `{last6}@farmers.agrishare.ph`, computed the same way here and in
// manage-farmer-account (backend/supabase/functions), never shown to the
// farmer. Accepts either the last 6 digits directly or a full/partial RSBSA
// number pasted in — only the last 6 digits ever matter.
function rsbsaToSyntheticEmail(rsbsaNo) {
  const last6 = rsbsaNo.replace(/\D/g, "").slice(-6);
  return `${last6}@farmers.agrishare.ph`;
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

    // MAO Admin / FA President accounts also live in auth.users, but this
    // app is farmer-only (paper scope) — reject them here with a clear
    // message instead of letting getMyFarmerProfile fail on the missing
    // farmers row with a generic "no rows" error.
    const { data: account, error: roleErr } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    if (roleErr || account?.role !== "farmer") {
      await supabase.auth.signOut();
      throw new Error("Please use the web system.");
    }

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

  // Lets the profile screen push a fresh avatar URL into shared state right
  // after an upload/remove, so Home/Profile both reflect it without a full
  // re-fetch of the farmer profile.
  function updateAvatarUrl(url) {
    setFarmer((prev) => (prev ? { ...prev, avatarUrl: url } : prev));
  }

  // Pull-to-refresh on the Profile tab — re-reads the farmer row (plus its
  // address/parcel/crop/avatar joins) in case anything changed server-side.
  async function refreshFarmer() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const profile = await getMyFarmerProfile(session.user.id);
    setFarmer(profile);
  }

  return (
    <AuthContext.Provider
      value={{ farmer, isAuthenticated: !!farmer, initializing, login, logout, logoutEverywhere, updateAvatarUrl, refreshFarmer }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
