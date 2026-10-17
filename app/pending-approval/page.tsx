
"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

export default function PendingApprovalPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
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
        <p className="text-gray-600 dark:text-gray-400">
          Loading...
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-gray-800">
        <h1 className="mb-4 text-2xl font-bold text-black dark:text-white">
          Professor Approval Pending
        </h1>

        <p className="mb-6 text-gray-600 dark:text-gray-300">
          Your account has been created successfully. Your request
          to become a professor is waiting for administrator approval.
          You can sign in again later to check your account.
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
