import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCnnY5byLaGtqonN60Fp8QdEkdA5rGqblA',
  authDomain: 'tasfiasystem.firebaseapp.com',
  projectId: 'tasfiasystem',
  storageBucket: 'tasfiasystem.firebasestorage.app',
  messagingSenderId: '224725945329',
  appId: '1:224725945329:web:4839131316cb579df61250',
  measurementId: 'G-SEMQJD0P5C',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

/** Firebase must retain the signed-in session across browser/TWA restarts. */
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence);

export type AppUser = {
  userId: string;
  email: string;
  name: string;
};

function mapUser(user: User | null): AppUser | null {
  if (!user) return null;
  return {
    userId: user.uid,
    email: user.email || '',
    name: user.displayName || '',
  };
}

function waitForInitialAuthState(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function finishEmailLinkIfNeeded(): Promise<AppUser | null> {
  await authPersistenceReady;
  if (!isSignInWithEmailLink(auth, window.location.href)) {
    return mapUser(auth.currentUser);
  }

  let email = localStorage.getItem('finance_pending_signin_email') || '';
  if (!email) {
    email = window.prompt('د ایمیل لینک د بشپړولو لپاره خپل ایمیل بیا ولیکئ:') || '';
  }
  email = email.trim().toLowerCase();
  if (!email) throw new Error('د ایمیل پته اړینه ده.');

  const result = await signInWithEmailLink(auth, email, window.location.href);
  localStorage.removeItem('finance_pending_signin_email');
  window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
  return mapUser(result.user);
}

export const firebaseAuth = {
  async getUser(): Promise<AppUser | null> {
    await authPersistenceReady;

    if (isSignInWithEmailLink(auth, window.location.href)) {
      return finishEmailLinkIfNeeded();
    }

    const current = await waitForInitialAuthState();
    return mapUser(current);
  },

  async signIn(): Promise<{ user: AppUser | null; pendingEmail?: string }> {
    await authPersistenceReady;

    const entered = window.prompt(
      'د لومړي ځل ننوتلو لپاره خپل ایمیل ولیکئ.\n\nد Google حساب لپاره GOOGLE ولیکئ.'
    );
    const value = String(entered || '').trim();
    if (!value) throw new Error('د ننوتلو لپاره ایمیل اړین دی.');

    if (value.toLowerCase() === 'google') {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      return { user: mapUser(result.user) };
    }

    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('سم ایمیل ولیکئ.');
    }

    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem('finance_pending_signin_email', email);
    return { user: null, pendingEmail: email };
  },

  async signOut() {
    await signOut(auth);
  },

  onAuthStateChanged(callback: (user: AppUser | null) => void) {
    return onAuthStateChanged(auth, user => callback(mapUser(user)));
  },
};

export {
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
};
