"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type LogoutButtonProps = {
  className?: string;
};

/** Signs the user out of Firebase and sends them to the login page. */
export default function LogoutButton({ className = "" }: LogoutButtonProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    setLoggingOut(true);
    setError("");
    try {
      await signOut(getFirebaseAuth());
      router.replace("/login");
    } catch {
      setError("Couldn't log out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
        className={`rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-60 dark:border-zinc-600 dark:text-gray-100 dark:hover:bg-zinc-800 ${className}`}
      >
        {loggingOut ? "Logging out..." : "Log out"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
