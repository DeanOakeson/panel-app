"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { useStoredFlag } from "@/lib/storedFlag";

const items = [
  { label: "Home", path: "" },
  { label: "Assignments", path: "/assignments" },
  { label: "Modules", path: "/modules" },
  { label: "Grades", path: "/grades" },
];

/** Where the browser remembers whether the course navigation is collapsed. */
const NAV_COLLAPSED_STORAGE = "panel-course-nav-collapsed";

const NAV_ID = "course-navigation";

/** Below this window width, the course navigation starts collapsed until someone chooses. */
const COLLAPSE_BELOW = 1100;

/** Returns whether the course navigation starts collapsed, which it does in narrow windows. */
function collapsedByDefault(): boolean {
  return window.innerWidth < COLLAPSE_BELOW;
}

/** Shows a chevron pointing left to collapse the navigation, or right to expand it. */
function ChevronIcon({ pointsLeft }: { pointsLeft: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
      <path
        d={
          pointsLeft
            ? "M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z"
            : "M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4Z"
        }
      />
    </svg>
  );
}

/**
 * Wraps every course page with the course navigation, which collapses to a
 * narrow strip and remembers that choice, and sends signed-out visitors to login.
 */
export default function ClassLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { classId } = useParams<{ classId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const basePath = `/classes/${classId}`;
  const [collapsed, setCollapsed] = useStoredFlag(
    NAV_COLLAPSED_STORAGE,
    collapsedByDefault
  );
  const toggleLabel = collapsed ? "Show course navigation" : "Hide course navigation";

  // Every class page needs a signed-in user, so send signed-out visitors to
  // the login page instead of leaving them on a page that never loads.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) router.replace("/login");
    });
    return unsubscribe;
  }, [router]);

  return (
    <div className="min-w-0">
      {/* Fixed course sidebar */}
      <aside
        className={`fixed bottom-0 left-24 top-0 z-40 overflow-y-auto bg-gray-200 py-6 dark:bg-gray-800 ${
          collapsed ? "w-12 px-1" : "w-56 px-4"
        }`}
      >
        <div
          className={`mb-5 flex items-center ${collapsed ? "justify-center" : "justify-between gap-2 pl-3"}`}
        >
          {!collapsed && (
            <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              Course Navigation
            </h2>
          )}

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls={NAV_ID}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="rounded-md p-1.5 text-gray-700 hover:bg-gray-300 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <ChevronIcon pointsLeft={!collapsed} />
          </button>
        </div>

        <nav id={NAV_ID} hidden={collapsed} className="space-y-1">
          {items.map((item) => {
            const href = `${basePath}${item.path}`;
            const active =
              pathname === href ||
              (item.path !== "" && pathname.startsWith(`${href}/`));

            return (
              <Link
                key={item.label}
                href={href}
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
      <main
        className={`h-screen min-w-0 overflow-y-auto p-6 ${collapsed ? "ml-12" : "ml-56"}`}
      >
        {children}
      </main>
    </div>
  );
}