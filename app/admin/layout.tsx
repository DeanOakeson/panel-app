"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

/**
 * Gates everything under /admin: must be signed in AND have role === "admin".
 *
 * Also the one place the admin chrome is rendered: every page under /admin
 * inherits the header below (a link back to /admin plus Log out) so the section
 * behaves like one app instead of five pages that each invented their own
 * controls — the page-local Log out that used to sit on /admin/professors is
 * gone. The zinc/blue palette matches the pages added this sprint (/admin,
 * /admin/users, /admin/classes).
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

  const [loggingOut, setLoggingOut] = useState(false);

  /** Same contract as app/components/Sidebar.tsx: sign out, then land on "/". */
  async function handleLogout() {
    setLoggingOut(true);

    try {
      await signOut(getFirebaseAuth());
      router.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(
      getFirebaseAuth(),
      async (user: User | null) => {
        if (!user) {
          router.replace("/login");
          return;
        }

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
          <button
            onClick={() => router.replace("/dashboard")}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/*
        Shared admin chrome. Rendered once, here, so Log out and a way back to
        the dashboard exist on every /admin page; the page-local Log out that
        used to sit on /admin/professors is gone. Class strings are lifted from
        the sprint pages (the ADMIN chip, the zinc bordered button) so the
        header reads as part of the same UI.
      */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-8 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-blue-300">
              ADMIN
            </span>
            <span className="text-sm text-zinc-500">School administration</span>
          </div>

          <nav className="flex flex-wrap items-center gap-3" aria-label="Admin">
            <Link
              href="/admin"
              className="rounded border border-zinc-300 px-4 py-2 font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Admin panel
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="rounded border border-zinc-300 px-4 py-2 font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </nav>
        </div>
      </header>

      {children}
    </>
  );
}
