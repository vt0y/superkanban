import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Locale, SiteRole, ThemeMode, UserProfile } from '@/types';
import { isAllowedEmail } from '@/config/auth-domains';
import { database, withId } from './helpers';

export { isAllowedEmail };

export async function ensureUserProfile(user: User): Promise<void> {
  if (!isAllowedEmail(user.email)) {
    throw new Error('DOMAIN_NOT_ALLOWED');
  }
  const sessionKey = `profile-ensured:${user.uid}`;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) {
      return;
    }
  } catch {
    // Storage access might be restricted; continue
  }

  const ref = doc(database(), 'users', user.uid);
  const existing = await getDoc(ref);
  const base = {
    displayName: user.displayName || user.email?.split('@')[0] || 'User',
    email: user.email || '',
    photoURL: user.photoURL || '',
    updatedAt: serverTimestamp(),
  };
  if (existing.exists()) {
    if (existing.data().accountStatus === 'suspended') return;
    await setDoc(ref, base, { merge: true });
  }
  else await setDoc(ref, { ...base, locale: 'th', theme: 'system', createdAt: serverTimestamp() });

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(sessionKey, '1');
    }
  } catch {
    // Ignore storage errors
  }
}

export function authProfileFields(user: User) {
  return {
    displayName: user.displayName || user.email?.split('@')[0] || 'User',
    email: user.email || '',
    photoURL: user.photoURL || '',
  };
}

export function profileAuthChanged(profile: Partial<UserProfile>, user: User): boolean {
  const auth = authProfileFields(user);
  return profile.displayName !== auth.displayName || profile.email !== auth.email || profile.photoURL !== auth.photoURL;
}

/** Uses the profile listener's initial snapshot to ensure the document, avoiding a separate getDoc. */
export function subscribeEnsuredProfile(
  user: User,
  callback: (profile: UserProfile) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isAllowedEmail(user.email)) throw new Error('DOMAIN_NOT_ALLOWED');
  const ref = doc(database(), 'users', user.uid);
  let ensuring = false;
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      if (!ensuring) {
        ensuring = true;
        void setDoc(ref, {
          ...authProfileFields(user), locale: 'th', theme: 'system',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }).catch((error: Error) => { ensuring = false; onError?.(error); });
      }
      return;
    }
    const profile = withId<UserProfile>(snap);
    callback(profile);
    if (profile.accountStatus !== 'suspended' && !ensuring && profileAuthChanged(profile, user)) {
      ensuring = true;
      void updateDoc(ref, { ...authProfileFields(user), updatedAt: serverTimestamp() })
        .catch((error: Error) => onError?.(error))
        .finally(() => { ensuring = false; });
    }
  }, onError);
}

export function subscribeProfile(uid: string, callback: (profile: UserProfile) => void): Unsubscribe {
  return onSnapshot(doc(database(), 'users', uid), (snap) => {
    if (snap.exists()) callback(withId<UserProfile>(snap));
  });
}

/** Site-wide roles are provisioned by trusted operators in Firestore, never by clients. */
export function subscribeSiteRole(uid: string, callback: (role: SiteRole | null) => void): Unsubscribe {
  return onSnapshot(
    doc(database(), 'siteAdmins', uid),
    (snap) => {
      const role = snap.exists() ? snap.data().role : null;
      callback(role === 'owner' || role === 'admin' ? role : null);
    },
    () => callback(null),
  );
}

export async function updatePreferences(
  uid: string,
  values: { locale?: Locale; theme?: ThemeMode },
): Promise<void> {
  await updateDoc(doc(database(), 'users', uid), { ...values, updatedAt: serverTimestamp() });
}
