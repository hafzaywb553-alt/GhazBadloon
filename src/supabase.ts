import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ztpiplhnmwuglinxfwmy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4acpIzuY6goZ4u5JJVnbMg_U1vXZ76u';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
function endpoint(path: string) { return SUPABASE_URL + '/functions/v1/finance-api' + path.replace(/^\/api/, ''); }
async function request(path: string, method = 'GET', body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token;
  const response = await fetch(endpoint(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const err: any = new Error(payload?.message || 'د سرور غوښتنه ناکامه شوه.'); err.status = response.status; throw err; }
  return { data: payload };
}
export const api = {
  get: (path: string) => request(path, 'GET'),
  post: (path: string, body?: unknown) => request(path, 'POST', body),
  put: (path: string, body?: unknown) => request(path, 'PUT', body),
  delete: (path: string) => request(path, 'DELETE'),
};
export const auth = {
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email || '', name: String(data.user.user_metadata?.name || data.user.user_metadata?.full_name || '') };
  },
  async signIn(emailInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!email) throw Object.assign(new Error('ایمیل داخل نه شو.'), { code: 'email_required' });
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) {
      throw Object.assign(new Error(error.message), {
        code: error.code || 'auth_error',
        status: error.status,
      });
    }
    return { user: null, email };
  },
  onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
    return supabase.auth.onAuthStateChange(callback);
  },
  async signOut() { await supabase.auth.signOut(); },
};
