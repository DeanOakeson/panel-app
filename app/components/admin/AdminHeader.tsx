"use client";

import Link from "next/link";
import LogoutButton from "./LogoutButton";

/** Top bar on every /admin page: a link back to the admin home, who is signed in, and Log out. */
export default function AdminHeader({ email }: { email: string | null }) {
  return (
    <header className="border-b border-gray-200 bg-white dark:border-zinc-800 dark:bg-gray-950">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-8 py-3">
        <Link
          href="/admin"
          className="flex items-center gap-2 font-bold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
        >
          Panel
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-blue-300">
            ADMIN
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {email && (
            <span className="hidden text-sm text-gray-600 sm:inline dark:text-zinc-400">
              {email}
            </span>
          )}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
