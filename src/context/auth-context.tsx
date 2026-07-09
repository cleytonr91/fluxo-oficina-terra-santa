"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { collections } from "@/lib/firebase/collections";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
import type { UserProfile, UserRole } from "@/types/domain";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  createFirstAccess: (data: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(uid: string) {
  const db = getFirebaseDb();
  const profileRef = doc(db, collections.users, uid);
  const profileSnapshot = await getDoc(profileRef);

  if (!profileSnapshot.exists()) {
    return null;
  }

  return {
    id: profileSnapshot.id,
    ...profileSnapshot.data(),
  } as UserProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();

    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        setProfile(await loadProfile(currentUser.uid));
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    } finally {
      setLoading(false);
    }
  }, []);

  const createFirstAccess = useCallback(
    async ({
      name,
      email,
      password,
      role,
    }: {
      name: string;
      email: string;
      password: string;
      role: UserRole;
    }) => {
      setLoading(true);

      try {
        const credentials = await createUserWithEmailAndPassword(
          getFirebaseAuth(),
          email,
          password,
        );
        const db = getFirebaseDb();
        const profileRef = doc(db, collections.users, credentials.user.uid);

        await setDoc(profileRef, {
          name,
          email,
          role,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        localStorage.setItem("firstAccessCreated", "true");
        setProfile(await loadProfile(credentials.user.uid));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth());
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, login, createFirstAccess, logout }),
    [user, profile, loading, login, createFirstAccess, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth precisa estar dentro de AuthProvider.");
  }

  return context;
}
