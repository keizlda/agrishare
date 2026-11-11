import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getMyFarmerProfile } from "../lib/api/farmer";
import { friendlyError, isNetworkError, isSessionError, setSessionCheck } from "../lib/friendlyError";

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

// A deleted farmer's account is disabled ("banned") by manage-farmer-account.
const DEACTIVATED =
  "This account is no longer active. Please contact your Farmers' Association President or the Municipal Agriculture Office.";
const NOT_A_FARMER = "This app is for farmers. Please use the AgriShare web system.";

export function AuthProvider({ children }) {
  const [farmer, setFarmer] = useState(null);
  const [initializing, setInitializing] = useState(true);
  // Set when the app signed the farmer out on its own (the session ended);
  // the Login screen explains it.
  const [signOutReason, setSignOutReason] = useState(null);
  // Opened with a saved session but the profile couldn't load (no
  // connection, server problem): RootNavigator shows this with Try again
  // instead of logging the farmer out.
  const [bootError, setBootError] = useState(null);
  const farmerRef = useRef(null);
  const manualSignOut = useRef(false);

  useEffect(() => {
    farmerRef.current = farmer;
  }, [farmer]);

  const restoreSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      setFarmer(await getMyFarmerProfile(session.user.id));
      setBootError(null);
    } catch (err) {
      if (isNetworkError(err) || !(err?.code === "PGRST116" || isSessionError(err))) {
        setBootError(friendlyError(err, "AgriShare couldn't load your account. Please try again."));
      } else {
        manualSignOut.current = true;
        await supabase.auth.signOut();
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    restoreSession().finally(() => {
      if (!cancelled) setInitializing(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      // Not from Log Out: the session ended on its own.
      if (!manualSignOut.current && farmerRef.current) setSignOutReason("expired");
      manualSignOut.current = false;
      setFarmer(null);
    });

    // friendlyError asks for this when a request was refused in a way that
    // could mean the session is gone. Only the server saying there's no
    // valid session counts — not being offline.
    setSessionCheck(async () => {
      if (!farmerRef.current) return;
      const { data, error } = await supabase.auth.getUser();
      if (data?.user || isNetworkError(error)) return;
      setSignOutReason("expired");
      setFarmer(null);
      manualSignOut.current = true;
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      setSessionCheck(null);
    };
  }, [restoreSession]);

  async function retryRestore() {
    setInitializing(true);
    setBootError(null);
    await restoreSession();
    setInitializing(false);
  }

  async function login(rsbsaNo, password) {
    setSignOutReason(null);
    const email = rsbsaToSyntheticEmail(rsbsaNo);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error?.code === "user_banned" || /banned/i.test(error?.message ?? "")) throw new Error(DEACTIVATED);
    if (error) throw error;

    // MAO Admin / FA President accounts also live in auth.users, but this
    // app is farmer-only (paper scope) — reject them here with a clear
    // message instead of letting getMyFarmerProfile fail on the missing
    // farmers row with a generic "no rows" error.
    try {
      const { data: account, error: roleErr } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
      if (roleErr) throw roleErr;
      if (account?.role !== "farmer") throw new Error(NOT_A_FARMER);
      const profile = await getMyFarmerProfile(data.user.id);
      setFarmer(profile);
      return profile;
    } catch (err) {
      manualSignOut.current = true;
      await supabase.auth.signOut();
      throw err;
    }
  }

  async function logout() {
    manualSignOut.current = true;
    setSignOutReason(null);
    await supabase.auth.signOut();
    setFarmer(null);
  }

  // Explicit global scope — invalidates every refresh token for this user,
  // not just this device's. Distinct from logout() so "Log Out" and "Log
  // Out of All Devices" are honest about what each one actually does.
  async function logoutEverywhere() {
    manualSignOut.current = true;
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
      value={{
        farmer,
        isAuthenticated: !!farmer,
        initializing,
        signOutReason,
        bootError,
        retryRestore,
        login,
        logout,
        logoutEverywhere,
        updateAvatarUrl,
        refreshFarmer,
      }}
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
