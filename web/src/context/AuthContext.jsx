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

// Multi-tab sign-in. Every tab shares one saved session (localStorage). When
// another tab signs in as a different account, this tab's requests would go
// out as that account while its screen still shows the old one — so this
// tab reloads into the new account's home and says why.
const ACCOUNT_SWITCHED_MESSAGE = "You signed in as another account in another tab.";
const SWITCH_NOTICE_KEY = "agrishare_account_switched";

// The user id in a saved Supabase session value (JSON), or null.
function sessionUserId(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
  } catch {
    return null;
  }
}

function readSwitchNotice() {
  try {
    return sessionStorage.getItem(SWITCH_NOTICE_KEY) ? ACCOUNT_SWITCHED_MESSAGE : null;
  } catch {
    return null;
  }
}

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
  // "You signed in as another account in another tab." after the reload.
  const [notice, setNotice] = useState(readSwitchNotice);
  const userRef = useRef(null);
  const manualSignOut = useRef(false);
  const otherTabSignOut = useRef(false);
  const switching = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const clearNotice = useCallback(() => setNotice(null), []);

  // The notice is shown once.
  useEffect(() => {
    try {
      sessionStorage.removeItem(SWITCH_NOTICE_KEY);
    } catch {
      // Private window: nothing was saved.
    }
  }, []);

  // Another tab is now signed in as a different account: reload this tab
  // into that account's home (a full reload, so no screen or cached list
  // from the old account is left behind).
  const followAccountSwitch = useCallback(() => {
    if (switching.current) return;
    switching.current = true;
    try {
      sessionStorage.setItem(SWITCH_NOTICE_KEY, "1");
    } catch {
      // Private window: the reload still happens, without the notice.
    }
    window.location.assign("/");
  }, []);

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

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // All tabs share one stored session. If another tab signs in as a
      // different account (e.g. FA President while this tab shows MAO
      // Admin), this tab's requests already go out as that account — follow
      // it, instead of the server refusing actions the screen still offers.
      if (event !== "SIGNED_OUT") {
        if (session?.user && userRef.current && session.user.id !== userRef.current.id) {
          // Deferred: supabase-js warns against calling back into itself
          // inside this callback.
          setTimeout(followAccountSwitch, 0);
        }
        return;
      }
      // Not from Log Out in this tab: Log Out in another tab, or the session
      // ended on its own (expired, revoked, refresh token gone). The storage
      // listener below marks the first; give it a moment to arrive.
      const wasSignedIn = !!userRef.current;
      const fromHere = manualSignOut.current;
      manualSignOut.current = false;
      setUser(null);
      if (!fromHere && wasSignedIn) {
        setTimeout(() => setSignOutReason((prev) => prev ?? (otherTabSignOut.current ? "other-tab" : "expired")), 150);
      }
    });

    // The shared session changed in another tab (storage events only fire in
    // the other tabs): signed out there, signed in as someone else, or signed
    // in while this tab was on the login page.
    const storageKey = supabase.auth.storageKey;
    function onStorage(e) {
      if (e.storageArea !== localStorage) return;
      if (!(e.key === storageKey || /^sb-[\w-]+-auth-token$/.test(e.key ?? ""))) return;
      const nextId = sessionUserId(e.newValue);
      const current = userRef.current;
      if (!nextId) {
        if (current) {
          otherTabSignOut.current = true;
          setSignOutReason("other-tab");
          setUser(null);
        }
        return;
      }
      if (current && nextId !== current.id) followAccountSwitch();
      else if (!current) {
        // Signed in from another tab: come in too.
        otherTabSignOut.current = false;
        setSignOutReason(null);
        restoreSession();
      }
    }
    window.addEventListener("storage", onStorage);

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
      window.removeEventListener("storage", onStorage);
    };
  }, [restoreSession, sessionExpired, followAccountSwitch]);

  async function retryRestore() {
    setInitializing(true);
    setBootError(null);
    await restoreSession();
    setInitializing(false);
  }

  async function login(email, password) {
    setSignOutReason(null);
    otherTabSignOut.current = false;
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
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, initializing, signOutReason, bootError, retryRestore, login, logout, notice, clearNotice }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
