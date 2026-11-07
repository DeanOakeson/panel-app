"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

const items = [
  { label: "Home", path: "" },
  { label: "Assignments", path: "/assignments" },
  { label: "Modules", path: "/modules" },
  { label: "Grades", path: "/grades" },
];

export default function ClassLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { classId } = useParams<{ classId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const basePath = `/classes/${classId}`;

  // Adjust state during render (a documented React pattern) so the phone
  // drawer closes on navigation — even back/forward — without an effect
  // (PANEL-88).
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  // Every class page needs a signed-in user, so send signed-out visitors to
  // the login page instead of leaving them on a page that never loads.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) router.replace("/login");
    });
    return unsubscribe;
  }, [router]);

  return (
    <div className="h-full min-w-0">
      {/* Course-menu toggle, parked inside the phone top bar (PANEL-88) */}
      <button
        type="button"
        aria-label="Open course navigation"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className="fixed left-12 top-0 z-60 flex h-12 w-9 items-center justify-center rounded-md text-xl text-gray-700 hover:bg-gray-200 lg:hidden dark:text-gray-200 dark:hover:bg-gray-700"
      >
        ☰
      </button>

      {/* Dimmed backdrop that closes the phone drawer when tapped */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close course navigation"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      {/* Course sidebar; slides in as a drawer below the lg breakpoint (PANEL-88) */}
      <aside
        className={`fixed bottom-0 left-0 top-12 z-55 w-64 overflow-y-auto bg-gray-200 px-4 py-6 transition-transform duration-200 dark:bg-gray-800 lg:top-0 lg:left-24 lg:z-40 lg:w-56 ${
          menuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <h2 className="mb-5 px-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
          Course Navigation
        </h2>

        <nav className="space-y-1">
          {items.map((item) => {
            const href = `${basePath}${item.path}`;
            const active =
              pathname === href ||
              (item.path !== "" && pathname.startsWith(`${href}/`));

            return (
              <Link
                key={item.label}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "border-l-2 border-red-600 font-semibold text-gray-900 dark:text-white"
                    : "text-gray-700 hover:bg-gray-300 dark:text-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Class content scrolls independently */}
      <main className="h-full min-w-0 overflow-y-auto p-6 lg:ml-56">
        {children}
      </main>
    </div>
  );
}
