// Source mirror for the deployed Supabase Edge Function "auth-api".
// The live function is deployed separately in the Supabase project.
// It exists here so the GhazBadloon repository keeps the authentication source alongside the frontend.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_ACCESS = "ghazbadloon-client-2026";
const ADMIN_EMAIL = "hafzaywb553@gmail.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-access",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function out(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function emailOf(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}
function makePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-app-access") !== APP_ACCESS) return out({ message: "Unauthorized." }, 401);
  if (req.method !== "POST") return out({ message: "Only POST is supported." }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return out({ message: "ناسمه غوښتنه." }, 400); }

  const path = new URL(req.url).pathname.replace(/^\/functions\/v1\/auth-api\/?/, "").replace(/^\/+|\/+$/g, "");

  if (path === "register") {
    const email = emailOf(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return out({ message: "معتبر ایمیل ولیکئ.", code: "invalid_email" }, 400);
    if (password.length < 6 || password.length > 128) return out({ message: "PIN/رمز باید لږ تر لږه ۶ کرکټرونه وي.", code: "invalid_password" }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) {
      const exists = /already|exists|registered/i.test(error.message);
      return out({ message: exists ? "دا ایمیل مخکې حساب لري. د ننوتلو برخه وکاروئ." : error.message, code: exists ? "user_exists" : "create_failed" }, exists ? 409 : 400);
    }
    return out({ ok: true, user: { id: data.user?.id, email: data.user?.email } });
  }

  if (path === "bootstrap-admin") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return out({ message: error.message }, 500);
    const user = data.users.find((u) => emailOf(u.email) === ADMIN_EMAIL);
    if (!user) return out({ message: "Admin account not found.", code: "admin_missing" }, 404);
    if (user.user_metadata?.password_bootstrapped === true) {
      return out({ message: "Admin bootstrap already completed.", code: "already_bootstrapped" }, 410);
    }
    const temporaryPassword = makePassword();
    const updated = await admin.auth.admin.updateUserById(user.id, {
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { ...(user.user_metadata || {}), password_bootstrapped: true },
    });
    if (updated.error) return out({ message: updated.error.message }, 500);
    return out({ ok: true, action: "updated", temporaryPassword });
  }

  return out({ message: "ناسمه auth-api لاره.", code: "not_found" }, 404);
});
