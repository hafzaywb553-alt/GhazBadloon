import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ztpiplhnmwuglinxfwmy.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4acpIzuY6goZ4u5JJVnbMg_U1vXZ76u';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function endpoint(path: string) {
  return SUPABASE_URL + '/functions/v1/finance-api' + path.replace(/^\/api/, '');
}

async function request(path: string, method = 'GET', body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token;
  const response = await fetch(endpoint(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err: any = new Error(payload?.message || 'د سرور غوښتنه ناکامه شوه.');
    err.status = response.status;
    throw err;
  }
  return { data: payload };
}

async function authApi(path: string, body: unknown) {
  const response = await fetch(SUPABASE_URL + '/functions/v1/auth-api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-access': 'ghazbadloon-client-2026' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err: any = new Error(payload?.message || 'د حساب غوښتنه ناکامه شوه.');
    err.status = response.status;
    err.code = payload?.code;
    throw err;
  }
  return payload;
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
    return {
      userId: data.user.id,
      email: data.user.email || '',
      name: String(data.user.user_metadata?.name || data.user.user_metadata?.full_name || ''),
    };
  },
  async signIn(emailInput: string, password: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    const secret = String(password || '');
    if (!email || !secret) throw new Error('د حساب داخلي اعتبار بشپړ نه شو.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: secret });
    if (error || !data.user) {
      throw Object.assign(new Error(error?.message || 'د حساب ننوتل ناکام شول.'), {
        code: error?.code || 'auth_error',
        status: error?.status,
      });
    }
    return {
      user: {
        userId: data.user.id,
        email: data.user.email || '',
        name: String(data.user.user_metadata?.name || data.user.user_metadata?.full_name || ''),
      },
    };
  },
  async register(emailInput: string, password: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    return authApi('/register', { email, password });
  },
  async bootstrapAdmin() {
    return authApi('/bootstrap-admin', {});
  },
  onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
    return supabase.auth.onAuthStateChange(callback);
  },
  async signOut() {
    await supabase.auth.signOut();
  },
};
