"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import AdminHeader from "../components/admin/AdminHeader";
import LogoutButton from "../components/admin/LogoutButton";

/**
 * Gates everything under /admin: must be signed in AND have role === "admin".
 *
 * NOTE (by design, to be hardened later): the role is read from Firestore via
 * the existing GET /api/users endpoint, and current Firestore rules are open
 * for development. Tighten rules before production.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "denied" | "ready">(
    "loading"
  );
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(
      getFirebaseAuth(),
      async (user: User | null) => {
        if (!user) {
          router.replace("/login");
          return;
        }

        if (active) setEmail(user.email);

        try {
          const token = await user.getIdToken();
          const res = await fetch("/api/users", {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            if (active) setState("denied");
            return;
          }
          const profile = await res.json();
          if (active) {
            setState(profile.role === "admin" ? "ready" : "denied");
          }
        } catch {
          if (active) setState("denied");
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-6">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded shadow-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">Admins only</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
            You don&apos;t have permission to view this page.
          </p>
          <div className="flex flex-wrap items-start justify-center gap-3">
            <button
              onClick={() => router.replace("/dashboard")}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Back to dashboard
            </button>
            {/* Signed in with the wrong account? Let them switch. */}
            <LogoutButton className="py-2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AdminHeader email={email} />
      {children}
    </>
  );
}
