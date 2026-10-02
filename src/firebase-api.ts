import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  db,
  auth,
  authPersistenceReady,
  firebaseAuth,
} from './firebase';

const ADMIN_EMAIL = 'hafzaywb553@gmail.com';
const DEFENSE_TAX_PROFILE_LABEL = 'د ملي دفاع وزارت';
const PRESENCE_TTL_MS = 45_000;

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function now() {
  return new Date().toISOString();
}

function moneyNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function validDate(value: unknown) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text + 'T00:00:00Z'));
}

function isAdminEmail(value: unknown) {
  return normalizeEmail(value) === ADMIN_EMAIL;
}

function currentIdentity() {
  const user = auth.currentUser;
  if (!user) throw new Error('ستاسې حساب نور داخل نه دی.');
  return {
    user,
    uid: user.uid,
    email: normalizeEmail(user.email),
    name: user.displayName || '',
    admin: isAdminEmail(user.email),
  };
}

function withOwner(record: Record<string, unknown>, fallbackEmail = '') {
  return {
    ...record,
    ownerEmail: normalizeEmail(record.ownerEmail) || normalizeEmail(fallbackEmail),
  };
}

async function listCollection(name: string, scoped = true) {
  const ctx = currentIdentity();
  const source = collection(db, name);
  const q = scoped && !ctx.admin ? query(source, where('userId', '==', ctx.uid)) : source;
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function getRecord(name: string, id: string) {
  const snapshot = await getDoc(doc(db, name, id));
  if (!snapshot.exists()) return null;
  return { ...(snapshot.data() as Record<string, unknown>), id: snapshot.id };
}

function canManage(ctx: ReturnType<typeof currentIdentity>, record: Record<string, unknown>) {
  return ctx.admin || String(record.userId || '') === ctx.uid;
}

async function audit(action: string, details: Record<string, unknown> = {}) {
  try {
    const ctx = currentIdentity();
    await addDoc(collection(db, 'audit'), {
      userId: ctx.uid,
      email: ctx.email,
      action,
      details,
      createdAt: now(),
    });
  } catch {
    // Audit logging must not block the primary action.
  }
}

function generalSalaryWithholdingTaxMonthly(amount: number) {
  const taxable = Math.max(0, moneyNumber(amount) || 0);
  if (taxable <= 5000) return 0;
  if (taxable <= 12500) return Math.round((taxable - 5000) * 0.02 * 100) / 100;
  if (taxable <= 100000) return Math.round((150 + (taxable - 12500) * 0.1) * 100) / 100;
  return Math.round((8900 + (taxable - 100000) * 0.2) * 100) / 100;
}

function defenseSalaryTaxInternal(amount: number) {
  const taxable = Math.max(0, moneyNumber(amount) || 0);
  if (taxable <= 10000) return 0;
  if (taxable <= 100000) return Math.round(taxable * 0.1 * 100) / 100;
  return Math.round(taxable * 0.15 * 100) / 100;
}

function salaryTaxByInstitution(amount: number, institution: string) {
  return institution === DEFENSE_TAX_PROFILE_LABEL
    ? defenseSalaryTaxInternal(amount)
    : generalSalaryWithholdingTaxMonthly(amount);
}

function positiveAmount(value: unknown) {
  const amount = moneyNumber(value);
  return amount !== null && amount > 0 ? amount : null;
}

async function addUserRecord(table: string, record: Record<string, unknown>, action: string) {
  const ctx = currentIdentity();
  const stored = {
    ...record,
    userId: ctx.uid,
    ownerEmail: ctx.email,
    createdAt: now(),
  };
  const ref = await addDoc(collection(db, table), stored);
  await audit(action, { id: ref.id });
  return { data: { ok: true, id: ref.id, item: withOwner({ ...stored, id: ref.id }, ctx.email) } };
}

async function scopedPayload(table: string) {
  const ctx = currentIdentity();
  const items = await listCollection(table, true);
  return { data: { items: items.map(x => withOwner(x, ctx.admin ? '' : ctx.email)) } };
}

async function presencePayload() {
  currentIdentity();
  const items = await listCollection('presence', false);
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const latest = new Map<string, Record<string, unknown>>();
  for (const x of items) {
    const seen = Date.parse(String(x.lastSeen || ''));
    if (x.online === false || !Number.isFinite(seen) || seen < cutoff) continue;
    const uid = String(x.userId || '');
    if (!uid) continue;
    const existing = latest.get(uid);
    if (!existing || seen > Date.parse(String(existing.lastSeen || ''))) latest.set(uid, x);
  }
  const users = Array.from(latest.values()).sort(
    (a, b) => Date.parse(String(b.lastSeen || '')) - Date.parse(String(a.lastSeen || ''))
  );
  return { count: users.length, users, ttlSeconds: PRESENCE_TTL_MS / 1000 };
}

async function ledgerPayload() {
  const tx = await listCollection('transactions', true);
  const payroll = await listCollection('payroll', true);
  const items: Array<Record<string, unknown>> = [];

  for (const x of tx) {
    const amount = moneyNumber(x.amount) || 0;
    const ref = `TX-${String(x.id).slice(0, 8)}`;
    const ownerEmail = normalizeEmail(x.ownerEmail);
    if (x.type === 'income') {
      items.push({ id: `${x.id}-d`, sourceId: x.id, date: x.date, reference: ref, account: '1100 - نغدې/بانک', debit: amount, credit: 0, description: x.description, ownerEmail });
      items.push({ id: `${x.id}-c`, sourceId: x.id, date: x.date, reference: ref, account: '4100 - عواید', debit: 0, credit: amount, description: x.description, ownerEmail });
    } else {
      items.push({ id: `${x.id}-d`, sourceId: x.id, date: x.date, reference: ref, account: '5100 - مصارف', debit: amount, credit: 0, description: x.description, ownerEmail });
      items.push({ id: `${x.id}-c`, sourceId: x.id, date: x.date, reference: ref, account: '1100 - نغدې/بانک', debit: 0, credit: amount, description: x.description, ownerEmail });
    }
  }

  for (const x of payroll) {
    const gross = moneyNumber(x.gross) || 0;
    const net = moneyNumber(x.net) || 0;
    const fees = moneyNumber(x.fees) || 0;
    const ref = `PR-${String(x.id).slice(0, 8)}`;
    const month = String(x.month || '');
    const date = /^\d{4}-\d{2}$/.test(month) ? month + '-01' : now().slice(0, 10);
    const ownerEmail = normalizeEmail(x.ownerEmail);
    items.push({ id: `${x.id}-d`, sourceId: x.id, date, reference: ref, account: '6100 - د معاشونو مصارف', debit: gross, credit: 0, description: `معاش - ${month}`, ownerEmail });
    items.push({ id: `${x.id}-c`, sourceId: x.id, date, reference: ref, account: '2100 - د معاشونو وجبات', debit: 0, credit: net, description: `خالص معاش - ${month}`, ownerEmail });
    if (fees > 0) {
      items.push({ id: `${x.id}-f`, sourceId: x.id, date, reference: ref, account: '2200 - د کسراتو وجبات', debit: 0, credit: fees, description: `کسرات/فیسونه - ${month}`, ownerEmail });
    }
  }

  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.reference).localeCompare(String(b.reference)));
  const debitTotal = items.reduce((sum, x) => sum + Number(x.debit || 0), 0);
  const creditTotal = items.reduce((sum, x) => sum + Number(x.credit || 0), 0);
  return {
    data: {
      items,
      balanced: Math.abs(debitTotal - creditTotal) < 0.01,
      debitTotal,
      creditTotal,
    },
  };
}

function parsePath(path: string) {
  const clean = String(path || '').replace(/\/$/, '');
  const match = clean.match(/^\/api\/([^/]+)(?:\/([^/]+))?$/);
  return { resource: match?.[1] || '', id: match?.[2] || '' };
}

async function apiGet(path: string) {
  const { resource, id } = parsePath(path);

  if (resource === 'personnel' || resource === 'payroll' || resource === 'transactions' || resource === 'audit') {
    return scopedPayload(resource);
  }
  if (resource === 'ledger') return ledgerPayload();

  if (resource === 'profile') {
    const ctx = currentIdentity();
    return { data: { userId: ctx.uid, email: ctx.email, name: ctx.name, role: ctx.admin ? 'admin' : 'user' } };
  }

  if (resource === 'presence') return { data: await presencePayload() };

  if (resource === 'admin' && id === 'overview') {
    const ctx = currentIdentity();
    if (!ctx.admin) throw new Error('د مدیر صلاحیت نشته.');
    const [users, personnel, payroll, transactions, auditData, presence] = await Promise.all([
      listCollection('user_profiles', false),
      listCollection('personnel', false),
      listCollection('payroll', false),
      listCollection('transactions', false),
      listCollection('audit', false),
      presencePayload(),
    ]);
    return {
      data: {
        users: users.map(x => ({ ...x, email: normalizeEmail(x.email) })).sort((a, b) => String(a.email).localeCompare(String(b.email))),
        personnel: personnel.map(x => withOwner(x)),
        payroll: payroll.map(x => withOwner(x)),
        transactions: transactions.map(x => withOwner(x)),
        audit: auditData.map(x => withOwner(x)),
        presence,
      },
    };
  }

  throw new Error('ناپېژندل شوې غوښتنه.');
}

async function apiPost(path: string, body: Record<string, unknown> = {}) {
  const { resource } = parsePath(path);

  if (resource === 'profile') {
    const ctx = currentIdentity();
    const profile = {
      userId: ctx.uid,
      email: ctx.email,
      name: ctx.name,
      role: ctx.admin ? 'admin' : 'user',
      updatedAt: now(),
    };
    await setDoc(doc(db, 'user_profiles', ctx.uid), profile, { merge: true });
    return { data: { ok: true, id: ctx.uid, profile } };
  }

  if (resource === 'personnel') {
    const required = ['name', 'employeeNo', 'rank', 'position'];
    if (required.some(k => !String(body[k] ?? '').trim())) throw new Error('د کارکوونکي اړین معلومات سم نه دي.');
    if ((moneyNumber(body.baseSalary) ?? -1) < 0) throw new Error('اساسي معاش معتبر نه دی.');
    return addUserRecord('personnel', {
      name: String(body.name).trim(),
      employeeNo: String(body.employeeNo).trim(),
      rank: String(body.rank || ''),
      position: String(body.position || ''),
      baseSalary: moneyNumber(body.baseSalary) || 0,
      recurringAllowance: moneyNumber(body.recurringAllowance) || 0,
      extraordinaryAllowance: moneyNumber(body.extraordinaryAllowance) || 0,
      fees: moneyNumber(body.fees) || 0,
    }, 'create_personnel');
  }

  if (resource === 'payroll') {
    const ctx = currentIdentity();
    const personId = String(body.personId || '').trim();
    const month = String(body.month || '').trim();
    const person = await getRecord('personnel', personId);
    if (!person || (!ctx.admin && String(person.userId || '') !== ctx.uid)) throw new Error('اړوند کارکوونکی ونه موندل شو.');
    if (!/^1405-\d{2}$/.test(month)) throw new Error('د معاش میاشت باید د ۱۴۰۵ لمریز کال وي.');

    const existingPayroll = await listCollection('payroll', true);
    if (existingPayroll.some(x => String(x.personId) === personId && String(x.month) === month)) {
      throw new Error('د همدې کارکوونکي لپاره دا میاشت مخکې ثبت شوې ده.');
    }

    const baseSalary = moneyNumber(person.baseSalary) || 0;
    const recurringAllowance = moneyNumber(person.recurringAllowance) || 0;
    const extraordinaryAllowance = moneyNumber(body.extraordinaryAllowance) || 0;
    const otherDeductions = moneyNumber(body.otherDeductions) || 0;
    const institution = String(body.institution || DEFENSE_TAX_PROFILE_LABEL);
    const gross = Math.round((baseSalary + recurringAllowance + extraordinaryAllowance + Number.EPSILON) * 100) / 100;
    const taxableIncome = baseSalary;
    const taxAmount = salaryTaxByInstitution(taxableIncome, institution);
    const totalDeductions = Math.round((taxAmount + otherDeductions + Number.EPSILON) * 100) / 100;
    const net = Math.round((gross - totalDeductions + Number.EPSILON) * 100) / 100;
    if (net < 0) throw new Error('ټول کسرات له ناخالص معاش څخه زیات کېدای نه شي.');

    return addUserRecord('payroll', {
      personId,
      institution,
      month,
      baseSalary,
      recurringAllowance,
      extraordinaryAllowance,
      otherDeductions,
      taxableIncome,
      taxAmount,
      totalDeductions,
      fees: totalDeductions,
      gross,
      net,
    }, 'create_payroll');
  }

  if (resource === 'transactions') {
    const description = String(body.description || '').trim();
    const type = String(body.type || '');
    const amount = positiveAmount(body.amount);
    const category = String(body.category || '').trim();
    const date = String(body.date || '').trim();
    if (!description || (type !== 'income' && type !== 'expense') || amount === null || !validDate(date)) {
      throw new Error('تشریح، ډول، مثبت مقدار او سمه نېټه اړین دي.');
    }
    return addUserRecord('transactions', {
      description,
      type,
      amount,
      category,
      date,
      note: String(body.note || ''),
      referenceNo: String(body.referenceNo || '').trim(),
    }, 'create_transaction');
  }

  if (resource === 'presence') {
    const ctx = currentIdentity();
    const sessionId = String(body.sessionId || ctx.uid);
    await setDoc(doc(db, 'presence', ctx.uid), {
      userId: ctx.uid,
      email: ctx.email,
      name: ctx.name,
      sessionId,
      online: true,
      lastSeen: now(),
    }, { merge: true });
    return { data: await presencePayload() };
  }

  // Kept as a no-op compatibility endpoint so the main application contract remains unchanged.
  if (resource === 'subscriptions') return { data: { ok: true } };

  throw new Error('ناپېژندل شوې غوښتنه.');
}

async function apiPut(path: string, body: Record<string, unknown> = {}) {
  const { resource, id } = parsePath(path);
  const ctx = currentIdentity();
  if (!id) throw new Error('ثبت پېژندونکی ونه موندل شو.');

  if (resource === 'personnel') {
    const existing = await getRecord('personnel', id);
    if (!existing || !canManage(ctx, existing)) throw new Error('د کارکوونکي د سمون صلاحیت نشته.');

    const record = {
      ...existing,
      name: String(body.name ?? existing.name).trim(),
      employeeNo: String(body.employeeNo ?? existing.employeeNo).trim(),
      rank: String(body.rank ?? existing.rank),
      position: String(body.position ?? existing.position),
      baseSalary: moneyNumber(body.baseSalary ?? existing.baseSalary) || 0,
      recurringAllowance: moneyNumber(body.recurringAllowance ?? existing.recurringAllowance) || 0,
      extraordinaryAllowance: moneyNumber(body.extraordinaryAllowance ?? existing.extraordinaryAllowance) || 0,
      fees: moneyNumber(body.fees ?? existing.fees) || 0,
      updatedAt: now(),
    };

    await updateDoc(doc(db, 'personnel', id), record);
    await audit('update_personnel', { id });
    return { data: { ok: true, item: withOwner({ ...record, id }, String(existing.ownerEmail || '')) } };
  }

  if (resource === 'payroll') {
    const existing = await getRecord('payroll', id);
    if (!existing || !canManage(ctx, existing)) throw new Error('د معاش د سمون صلاحیت نشته.');

    const personId = String(body.personId || existing.personId);
    const month = String(body.month || existing.month);
    const person = await getRecord('personnel', personId);
    if (!person || (!ctx.admin && String(person.userId || '') !== ctx.uid)) throw new Error('اړوند کارکوونکی ونه موندل شو.');
    if (!/^1405-\d{2}$/.test(month)) throw new Error('د معاش میاشت باید د ۱۴۰۵ لمریز کال وي.');

    const baseSalary = moneyNumber(person.baseSalary) || 0;
    const recurringAllowance = moneyNumber(person.recurringAllowance) || 0;
    const extraordinaryAllowance = moneyNumber(body.extraordinaryAllowance ?? existing.extraordinaryAllowance) || 0;
    const otherDeductions = moneyNumber(body.otherDeductions ?? existing.otherDeductions) || 0;
    const institution = String(body.institution || existing.institution || DEFENSE_TAX_PROFILE_LABEL);
    const others = await listCollection('payroll', true);
    if (others.some(x => String(x.id) !== id && String(x.personId) === personId && String(x.month) === month)) {
      throw new Error('د همدې کارکوونکي لپاره دا میاشت مخکې ثبت شوې ده.');
    }

    const gross = Math.round((baseSalary + recurringAllowance + extraordinaryAllowance + Number.EPSILON) * 100) / 100;
    const taxableIncome = baseSalary;
    const taxAmount = salaryTaxByInstitution(taxableIncome, institution);
    const totalDeductions = Math.round((taxAmount + otherDeductions + Number.EPSILON) * 100) / 100;
    const net = Math.round((gross - totalDeductions + Number.EPSILON) * 100) / 100;
    if (net < 0) throw new Error('ټول کسرات له ناخالص معاش څخه زیات کېدای نه شي.');

    const record = {
      ...existing,
      personId,
      month,
      institution,
      baseSalary,
      recurringAllowance,
      extraordinaryAllowance,
      otherDeductions,
      taxableIncome,
      taxAmount,
      totalDeductions,
      fees: totalDeductions,
      gross,
      net,
      updatedAt: now(),
    };

    await updateDoc(doc(db, 'payroll', id), record);
    await audit('update_payroll', { id });
    return { data: { ok: true, item: withOwner({ ...record, id }, String(existing.ownerEmail || '')) } };
  }

  if (resource === 'transactions') {
    const existing = await getRecord('transactions', id);
    if (!existing || !canManage(ctx, existing)) throw new Error('د مالي ثبت د سمون صلاحیت نشته.');

    const amount = positiveAmount(body.amount ?? existing.amount);
    const type = String(body.type ?? existing.type);
    const date = String(body.date ?? existing.date);
    const description = String(body.description ?? existing.description).trim();
    if (!description || (type !== 'income' && type !== 'expense') || amount === null || !validDate(date)) {
      throw new Error('مالي معلومات سمې کړئ.');
    }

    const record = {
      ...existing,
      description,
      type,
      amount,
      category: String(body.category ?? existing.category ?? '').trim(),
      date,
      note: String(body.note ?? existing.note ?? ''),
      referenceNo: String(body.referenceNo ?? existing.referenceNo ?? '').trim(),
      updatedAt: now(),
    };

    await updateDoc(doc(db, 'transactions', id), record);
    await audit('update_transaction', { id });
    return { data: { ok: true, item: withOwner({ ...record, id }, String(existing.ownerEmail || '')) } };
  }

  throw new Error('ناپېژندل شوې غوښتنه.');
}

async function apiDelete(path: string) {
  const { resource, id } = parsePath(path);
  const ctx = currentIdentity();
  if (!id) throw new Error('ثبت پېژندونکی ونه موندل شو.');

  if (resource === 'personnel') {
    const existing = await getRecord('personnel', id);
    if (!existing || !canManage(ctx, existing)) throw new Error('د کارکوونکي د حذف صلاحیت نشته.');

    const relatedPayroll = (await listCollection('payroll', true)).filter(x => String(x.personId) === id);
    for (const item of relatedPayroll) {
      await deleteDoc(doc(db, 'payroll', String(item.id)));
    }
    await deleteDoc(doc(db, 'personnel', id));
    await audit('delete_personnel', { id, payrollCount: relatedPayroll.length });
    return { data: { ok: true } };
  }

  if (resource === 'payroll' || resource === 'transactions') {
    const existing = await getRecord(resource, id);
    if (!existing || !canManage(ctx, existing)) throw new Error('د حذف صلاحیت نشته.');

    await deleteDoc(doc(db, resource, id));
    await audit(resource === 'payroll' ? 'delete_payroll' : 'delete_transaction', { id });
    return { data: { ok: true } };
  }

  throw new Error('ناپېژندل شوې غوښتنه.');
}

export const api = {
  async get(path: string) {
    await authPersistenceReady;
    return apiGet(path);
  },
  async post(path: string, body: Record<string, unknown> = {}) {
    await authPersistenceReady;
    return apiPost(path, body);
  },
  async put(path: string, body: Record<string, unknown> = {}) {
    await authPersistenceReady;
    return apiPut(path, body);
  },
  async delete(path: string) {
    await authPersistenceReady;
    return apiDelete(path);
  },
};

export const authApi = {
  getUser: firebaseAuth.getUser,
  signIn: firebaseAuth.signIn,
  signOut: firebaseAuth.signOut,
  onAuthStateChanged: firebaseAuth.onAuthStateChanged,
};
