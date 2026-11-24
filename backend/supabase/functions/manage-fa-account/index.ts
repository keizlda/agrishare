// Creates a Farmers' Association President's web account (Settings →
// Farmers' Association Presidents), or gives an existing one a new temporary
// password.
//
// Runs with the service role key (auto-injected by Supabase into every
// deployed Edge Function), so it can call auth.admin.*; every action first
// verifies the caller is a signed-in mao_admin. The role and the barangay go
// in app_metadata, which only the server can set (the database's new-user
// trigger reads them from there), so an account's role can never come from
// what someone signs up with.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// 12 characters from an alphabet without look-alikes (no 0/O, 1/l/I).
function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Missing Authorization header." }, 401);
    const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerData?.user) return jsonResponse({ error: "Invalid session." }, 401);
    const { data: caller, error: callerProfileErr } = await admin.from("profiles").select("role").eq("id", callerData.user.id).single();
    if (callerProfileErr || !caller) {
      return jsonResponse({ error: `Couldn't verify your account role: ${callerProfileErr?.message ?? "no profile found for this account"}.` }, 500);
    }
    if (caller.role !== "mao_admin") {
      return jsonResponse({ error: "Only the MAO Admin can manage Farmers' Association President accounts." }, 403);
    }

    const body = await req.json();

    if (body.action === "create") {
      const fullName = String(body.fullName ?? "").trim().replace(/\s+/g, " ");
      const email = String(body.email ?? "").trim().toLowerCase();
      const contactNo = String(body.contactNo ?? "").trim() || null;
      const barangayId = Number(body.barangayId);
      if (!fullName) return jsonResponse({ error: "Enter the full name." }, 400);
      if (!EMAIL.test(email)) return jsonResponse({ error: "Enter a valid email address." }, 400);
      const { data: brgy } = await admin.from("barangays").select("id, name").eq("id", barangayId).eq("is_active", true).maybeSingle();
      if (!brgy) return jsonResponse({ error: "Choose the barangay from the list." }, 400);

      const password = temporaryPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, contact_no: contactNo },
        app_metadata: { role: "fa_president", barangay_id: brgy.id },
      });
      if (createErr || !created?.user) {
        const taken = /already|registered|exists/i.test(createErr?.message ?? "");
        return jsonResponse({ error: taken ? "An account with this email already exists." : createErr?.message ?? "Couldn't create the account." }, taken ? 409 : 500);
      }
      // A temporary password: they're asked to change it.
      await admin.from("profiles").update({ must_change_password: true }).eq("id", created.user.id);
      await admin.from("audit_logs").insert({
        actor_id: callerData.user.id, user_role: "mao_admin", table_name: "profiles", action: "insert", record_id: created.user.id,
        summary: `Farmers' Association President account created: ${fullName} (Barangay ${brgy.name})`,
        changes: { new: { full_name: fullName, email, barangay_id: brgy.id } }, details: { id: created.user.id }, barangay_id: brgy.id,
      });
      return jsonResponse({ userId: created.user.id, email, password, barangay: brgy.name });
    }

    if (body.action === "reset-password") {
      const userId = String(body.userId ?? "");
      const { data: profile } = await admin.from("profiles").select("id, role, full_name").eq("id", userId).maybeSingle();
      if (!profile || profile.role !== "fa_president") return jsonResponse({ error: "That Farmers' Association President account wasn't found." }, 404);
      const password = temporaryPassword();
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (pwErr) return jsonResponse({ error: pwErr.message }, 500);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return jsonResponse({ password });
    }

    return jsonResponse({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error("manage-fa-account", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
