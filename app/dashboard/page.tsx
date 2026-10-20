"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { getHomePath } from "@/lib/homePath";
import { fetchUserProfile } from "@/lib/userProfile";

/**
 * Sends the user to their role's home view. The sidebar logo and Dashboard
 * button link here, so every "go home" link ends up in the right place.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        router.replace(getHomePath(await fetchUserProfile(user)));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load your profile."
        );
      }
    });

    return () => unsubscribe();
  }, [router]);

  return (
    <div className="flex min-h-full items-center justify-center">
      {error ? (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      ) : (
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      )}
    </div>
  );
}
