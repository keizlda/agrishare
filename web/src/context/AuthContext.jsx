import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { friendlyError, isNetworkError, isSessionError } from "../lib/friendlyError.js";

const AuthContext = createContext(null);

// DB role enum -> UI display role. Every page's role checks (Topbar,
// AppLayout, Farmers/Distributions/Requests "isMAO" checks) compare against
// these exact strings, so the mapping happens once, here, at the auth boundary.
const ROLE_LABELS = {
  mao_admin: "MAO Admin",
  fa_president: "FA President",
};

// What each role is called on screen. `role` stays the short key that the
// role checks compare against; only roleLabel is ever displayed.
const ROLE_DISPLAY = {
  "MAO Admin": "MAO Admin",
  "FA President": "Farmers' Association President",
};

const ROLE_PROFILES = {
  "MAO Admin": { office: "Municipality of Agriculture Office - Labangan" },
  "FA President": { office: "Farmers' Association - Barangay Langapud" },
};

const NO_ACCESS = "This account does not have access to the AgriShare web console.";

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
    throw new Error(NO_ACCESS);
  }

  return {
    id: authUser.id,
    email: authUser.email,
    name: profile.full_name,
    role,
    roleLabel: ROLE_DISPLAY[role] ?? role,
    office: ROLE_PROFILES[role]?.office ?? "",
  };
}

// The stored session itself is the problem (not a staff account, no
// profile, session no longer accepted) — as opposed to no connection or a
// server hiccup, where the session should be kept for a retry.
function isAccessProblem(err) {
  return err?.message === NO_ACCESS || err?.code === "PGRST116" || isSessionError(err);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  // Set when the app signed the user out on its own (the session ended);
  // Login explains it.
  const [signOutReason, setSignOutReason] = useState(null);
  // The app opened with a saved session but the profile couldn't be loaded
  // (no connection, server problem): AppLayout shows this with Try again
  // instead of logging the user out.
  const [bootError, setBootError] = useState(null);
  const userRef = useRef(null);
  const manualSignOut = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const restoreSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      setUser(await loadProfile(session.user));
      setBootError(null);
    } catch (err) {
      if (isAccessProblem(err)) {
        manualSignOut.current = true;
        await supabase.auth.signOut();
      } else {
        setBootError(friendlyError(err, "AgriShare couldn't load your account. Please try again."));
      }
    }
  }, []);

  const sessionExpired = useCallback(async () => {
    if (!userRef.current) return;
    setSignOutReason("expired");
    setUser(null);
    manualSignOut.current = true;
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    restoreSession().finally(() => {
      if (!cancelled) setInitializing(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      // Not from Log Out: the session ended on its own (expired, revoked,
      // refresh token gone).
      if (!manualSignOut.current && userRef.current) setSignOutReason("expired");
      manualSignOut.current = false;
      setUser(null);
    });

    // friendlyError asks for this when a request was refused in a way that
    // could mean the session is gone. Only an answer from the server that
    // there's no valid session counts — not being offline.
    async function checkSession() {
      if (!userRef.current) return;
      const { data, error } = await supabase.auth.getUser();
      if (!data?.user && !isNetworkError(error)) sessionExpired();
    }
    window.addEventListener("agri:session-check", checkSession);

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      window.removeEventListener("agri:session-check", checkSession);
    };
  }, [restoreSession, sessionExpired]);

  async function retryRestore() {
    setInitializing(true);
    setBootError(null);
    await restoreSession();
    setInitializing(false);
  }

  async function login(email, password) {
    setSignOutReason(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    try {
      const profile = await loadProfile(data.user);
      setUser(profile);
      return profile;
    } catch (err) {
      // Don't leave a farmer (or broken) account signed in behind the
      // "no access" message.
      manualSignOut.current = true;
      await supabase.auth.signOut();
      throw err;
    }
  }

  async function logout() {
    manualSignOut.current = true;
    setSignOutReason(null);
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, initializing, signOutReason, bootError, retryRestore, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
