// Creates/updates/resets/deletes a farmer's mobile login account.
//
// Runs with the service role key (auto-injected by Supabase into every
// deployed Edge Function), so it can call auth.admin.* — that key must never
// reach web/mobile code, which is exactly why this exists as a function
// instead of a client-side call. Every action first verifies the caller is a
// signed-in mao_admin.
//
// Login ID = the last 6 digits of the RSBSA number (the sequence group of
// RR-PP-MM-BBB-NNNNNN). Auth email = `${last6}@farmers.agrishare.ph`, never
// shown to the farmer — the app always presents just the 6-digit login ID.
import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_DOMAIN = "farmers.agrishare.ph";
const DEFAULT_PASSWORD = "password123";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function loginIdFromRsbsa(rsbsaNo: string): string {
  const digits = rsbsaNo.replace(/\D/g, "");
  return digits.slice(-6);
}

function emailFromLoginId(loginId: string): string {
  return `${loginId}@${EMAIL_DOMAIN}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // Caller identity: verify the JWT and that the account is mao_admin.
    // Every action here is a privileged write, so this check runs once,
    // up front, before any action-specific logic.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Missing Authorization header." }, 401);

    const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerData?.user) return jsonResponse({ error: "Invalid session." }, 401);

    const { data: callerProfile, error: callerProfileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .single();
    if (callerProfileErr || callerProfile?.role !== "mao_admin") {
      return jsonResponse({ error: "Only MAO Admin can manage farmer accounts." }, 403);
    }

    const body = await req.json();
    const action = body.action as string;

    // ------------------------------------------------------------------
    // Finds which OTHER farmer (if any) already owns this login ID, so the
    // UI can name them in the conflict error. Used both as its own action
    // (pre-save check from the form) and defensively inside create/update.
    // ------------------------------------------------------------------
    async function findLoginIdConflict(loginId: string, excludeFarmerId?: number) {
      // rsbsa_digits ending in loginId — since the format is enforced as
      // 2-2-2-3-6 (15 digits), the last 6 digits are always the sequence
      // group, so a suffix match is exactly "same login ID". Deleted
      // farmers don't count — the whole point of the partial unique index
      // is that their old login ID becomes available again.
      let query = admin
        .from("farmers")
        .select("farmer_id, first_name, surname")
        .like("rsbsa_digits", `%${loginId}`)
        .is("deleted_at", null);
      if (excludeFarmerId != null) query = query.neq("farmer_id", excludeFarmerId);
      const { data, error } = await query;
      if (error) throw error;
      const conflict = (data ?? [])[0];
      return conflict ? { farmerId: conflict.farmer_id, name: `${conflict.first_name} ${conflict.surname}` } : null;
    }

    if (action === "check-login-id") {
      const loginId = loginIdFromRsbsa(body.rsbsaNo);
      const conflict = await findLoginIdConflict(loginId, body.excludeFarmerId ?? undefined);
      return jsonResponse({ loginId, available: !conflict, conflictWith: conflict?.name ?? null });
    }

    if (action === "create") {
      const { farmerId, rsbsaNo, fullName, contactNo } = body;
      const loginId = loginIdFromRsbsa(rsbsaNo);

      const conflict = await findLoginIdConflict(loginId, farmerId);
      if (conflict) {
        return jsonResponse(
          { error: `Login ID ${loginId} is already used by ${conflict.name}. Check the RSBSA number.` },
          409,
        );
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailFromLoginId(loginId),
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { role: "farmer", full_name: fullName, contact_no: contactNo ?? null },
      });
      if (createErr || !created?.user) {
        return jsonResponse({ error: createErr?.message ?? "Couldn't create the login account." }, 500);
      }

      // handle_new_user (DB trigger) has already inserted the profiles row
      // by the time createUser() resolves. Link it to the farmer record.
      const { error: linkErr } = await admin.from("farmers").update({ profile_id: created.user.id }).eq("farmer_id", farmerId);
      if (linkErr) {
        // Compensate: an orphaned auth account with no linked farmer is
        // worse than no account at all.
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return jsonResponse({ error: `Account created but couldn't be linked: ${linkErr.message}` }, 500);
      }

      return jsonResponse({ loginId, password: DEFAULT_PASSWORD, profileId: created.user.id });
    }

    if (action === "update-rsbsa") {
      const { farmerId, newRsbsaNo } = body;
      const loginId = loginIdFromRsbsa(newRsbsaNo);

      const conflict = await findLoginIdConflict(loginId, farmerId);
      if (conflict) {
        return jsonResponse(
          { error: `Login ID ${loginId} is already used by ${conflict.name}. Check the RSBSA number.` },
          409,
        );
      }

      const { data: farmer, error: farmerErr } = await admin.from("farmers").select("profile_id").eq("farmer_id", farmerId).single();
      if (farmerErr || !farmer) return jsonResponse({ error: "Farmer not found." }, 404);

      if (!farmer.profile_id) {
        // No account yet (this farmer's RSBSA was invalid until now) —
        // caller should use "create" instead.
        return jsonResponse({ error: "This farmer has no account yet — use create instead." }, 409);
      }

      const { error: updateErr } = await admin.auth.admin.updateUserById(farmer.profile_id, { email: emailFromLoginId(loginId) });
      if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

      return jsonResponse({ loginId });
    }

    if (action === "reset-password") {
      const { farmerId } = body;
      const { data: farmer, error: farmerErr } = await admin.from("farmers").select("profile_id, rsbsa_no").eq("farmer_id", farmerId).single();
      if (farmerErr || !farmer) return jsonResponse({ error: "Farmer not found." }, 404);
      if (!farmer.profile_id) return jsonResponse({ error: "This farmer has no account yet." }, 409);

      const { error: pwErr } = await admin.auth.admin.updateUserById(farmer.profile_id, { password: DEFAULT_PASSWORD });
      if (pwErr) return jsonResponse({ error: pwErr.message }, 500);

      const { error: flagErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", farmer.profile_id);
      if (flagErr) return jsonResponse({ error: flagErr.message }, 500);

      return jsonResponse({ loginId: loginIdFromRsbsa(farmer.rsbsa_no), password: DEFAULT_PASSWORD });
    }

    if (action === "delete") {
      // Soft-deletes the farmer record and disables their login account
      // together, in this one server-side call: distribution_claims/
      // requests/crop_validations all reference farmer_id with no cascade
      // (distribution history must survive a farmer being removed), so the
      // row is never actually deleted — just marked, alongside banning the
      // auth account so they can't log in to the mobile app. The plain
      // UPDATE below still fires the farmers table's existing audit
      // trigger, so this shows up in audit_logs like any other change.
      const { farmerId } = body;
      const { data: farmer, error: farmerErr } = await admin
        .from("farmers")
        .select("profile_id, deleted_at")
        .eq("farmer_id", farmerId)
        .single();
      if (farmerErr || !farmer) return jsonResponse({ error: "Farmer not found." }, 404);
      if (farmer.deleted_at) return jsonResponse({ error: "This farmer has already been deleted." }, 409);

      const { error: softDeleteErr } = await admin
        .from("farmers")
        .update({ deleted_at: new Date().toISOString(), deleted_by: callerData.user.id })
        .eq("farmer_id", farmerId);
      if (softDeleteErr) return jsonResponse({ error: softDeleteErr.message }, 500);

      if (farmer.profile_id) {
        // Ban rather than hard-delete: audit_logs/distribution_claims rows
        // still reference this profile id as an actor, and profiles.id has
        // no cascade-safe way to null those out without losing history.
        const { error: banErr } = await admin.auth.admin.updateUserById(farmer.profile_id, { ban_duration: "876000h" }); // ~100 years
        if (banErr) {
          // The farmer is already marked deleted at this point — surface
          // the account-disable failure rather than pretending it worked,
          // but don't undo the soft delete over it.
          return jsonResponse({ error: `Farmer removed, but their login account couldn't be disabled: ${banErr.message}` }, 500);
        }
      }

      return jsonResponse({ ok: true });
    }

    if (action === "backfill") {
      const { data: farmers, error: farmersErr } = await admin
        .from("farmers")
        .select("farmer_id, profile_id, rsbsa_no, first_name, surname, contact_no")
        .is("deleted_at", null);
      if (farmersErr) return jsonResponse({ error: farmersErr.message }, 500);

      const rsbsaPattern = /^\d{2}-\d{2}-\d{2}-\d{3}-\d{6}$/;
      const report = { created: [] as string[], migratedEmail: [] as string[], skippedInvalid: [] as string[], skippedConflict: [] as string[] };

      for (const f of farmers ?? []) {
        if (!rsbsaPattern.test(f.rsbsa_no)) {
          report.skippedInvalid.push(`${f.first_name} ${f.surname} (${f.rsbsa_no})`);
          continue;
        }
        const loginId = loginIdFromRsbsa(f.rsbsa_no);
        const conflict = await findLoginIdConflict(loginId, f.farmer_id);
        if (conflict) {
          report.skippedConflict.push(`${f.first_name} ${f.surname} (${f.rsbsa_no}) — conflicts with ${conflict.name}`);
          continue;
        }

        if (f.profile_id) {
          // Already has an account — migrate it to the new email scheme so
          // the last-6-digit mobile login works for it too.
          const { error } = await admin.auth.admin.updateUserById(f.profile_id, { email: emailFromLoginId(loginId) });
          if (!error) report.migratedEmail.push(`${f.first_name} ${f.surname} (${loginId})`);
          continue;
        }

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: emailFromLoginId(loginId),
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { role: "farmer", full_name: `${f.first_name} ${f.surname}`, contact_no: f.contact_no ?? null },
        });
        if (createErr || !created?.user) continue;

        await admin.from("farmers").update({ profile_id: created.user.id }).eq("farmer_id", f.farmer_id);
        report.created.push(`${f.first_name} ${f.surname} (${loginId})`);
      }

      return jsonResponse(report);
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
