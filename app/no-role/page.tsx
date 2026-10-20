"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { getHomePath, NO_ROLE_PATH } from "@/lib/homePath";
import { fetchUserProfile } from "@/lib/userProfile";

/**
 * Shown to signed-in users with no profile or an unknown role, so they never
 * land on another role's view.
 */
export default function NoRolePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      // If an admin has since fixed the account, send the user home
      try {
        const destination = getHomePath(await fetchUserProfile(user));
        if (destination !== NO_ROLE_PATH) {
          router.replace(destination);
          return;
        }
      } catch {
        // Stay on this page; it already tells the user to contact an admin
      }

      setChecking(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut(getFirebaseAuth());
      router.replace("/login");
    } catch (error) {
      console.error("Sign out failed:", error);
      setSigningOut(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-gray-800">
        <h1 className="mb-4 text-2xl font-bold text-black dark:text-white">
          Account Not Set Up
        </h1>

        <p className="mb-6 text-gray-600 dark:text-gray-300">
          Your account doesn&apos;t have a role yet, so there&apos;s no page
          to show you. Please contact an administrator to finish setting up
          your account.
        </p>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </main>
  );
}
