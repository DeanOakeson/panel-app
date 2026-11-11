"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { createPortal } from "react-dom";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { useStoredFlag } from "@/lib/storedFlag";
import { useTopbarActions } from "../../components/TopbarActions";
import {
  CourseIdentityProvider,
  type CourseIdentity,
} from "../../components/classes/CourseIdentity";

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

/**
 * Tailwind's `lg` breakpoint. Below it the course navigation is a phone drawer
 * (PANEL-88) rather than a collapsible rail, so the desktop collapse, its
 * chevron and its widths stand down and a phone sees exactly one course-nav
 * toggle.
 */
const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

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

/** True from the `lg` breakpoint up, where the course navigation sits inline. */
function useHasDesktopNav(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia(DESKTOP_NAV_QUERY);
      query.addEventListener("change", onStoreChange);

      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(DESKTOP_NAV_QUERY).matches,
    // A server render has no viewport, so it sees the desktop rail; the real
    // breakpoint follows straight after hydration.
    () => true
  );
}

/**
 * Wraps every course page with the course navigation and sends signed-out
 * visitors to login. From `lg` up the navigation collapses to a narrow strip
 * and remembers that choice (PANEL-36); below `lg` the same navigation slides
 * off-canvas into a phone drawer behind the top bar's hamburger (PANEL-88).
 * Either way it names the course it belongs to (PANEL-90).
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
  const onGrades = pathname === `${basePath}/grades`;

  // The navigation starts collapsed on Grades, which needs the width, and in narrow windows
  const collapsedByDefault = useCallback(
    () => onGrades || window.innerWidth < COLLAPSE_BELOW,
    [onGrades]
  );
  const [collapsed, setCollapsed] = useStoredFlag(
    NAV_COLLAPSED_STORAGE,
    collapsedByDefault,
    onGrades
  );
  const toggleLabel = collapsed ? "Show course navigation" : "Hide course navigation";

  // Below `lg` the same aside is the phone drawer, so nothing may stay hidden
  // there until the drawer itself is opened.
  const hasDesktopNav = useHasDesktopNav();
  const navHidden = collapsed && hasDesktopNav;

  const [course, setCourse] = useState<CourseIdentity | null>(null);

  // Adjust state during render (a documented React pattern) so the phone
  // drawer closes on navigation — even back/forward — without an effect
  // (PANEL-88).
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const loadCourse = useCallback(async (user: User) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/classes/${classId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) return;

      const body = (await res.json()) as { class?: CourseIdentity };
      if (body.class) setCourse(body.class);
    } catch {
      // The sidebar keeps its placeholder; the pages still work without it.
    }
  }, [classId]);

  // Every class page needs a signed-in user, so send signed-out visitors to
  // the login page instead of leaving them on a page that never loads.
  // Signed-in visitors get the course identity, so every page inside the
  // course names the course it belongs to (PANEL-90).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      void loadCourse(user);
    });
    return unsubscribe;
  }, [router, loadCourse]);

  const courseTitle = course
    ? course.name || "Untitled Class"
    : "Loading course…";

  // The right-hand end of the phone top bar, or `null` until that bar mounts.
  const topbarActions = useTopbarActions();

  // The identity block names the navigation it sits in, so it only goes where
  // that navigation is on screen: the desktop rail when it is expanded, the
  // phone drawer when it is open. A closed drawer keeps nothing — not even its
  // own course name — parked off-canvas (PANEL-90).
  const showIdentity = !navHidden && (hasDesktopNav || menuOpen);

  return (
    <CourseIdentityProvider value={course}>
      <div className="h-full min-w-0">
        {/*
          Course-menu toggle (PANEL-88), portalled into the right-hand end of
          the phone top bar instead of floating over it at `left-12`, where its
          36x48 box landed on the "Panel" wordmark (END-179). The bar's own flex
          row does the placing, so the two cannot collide at any width. Until
          the bar mounts — the server render, and the commit after it — there is
          nowhere to place it and the button is not rendered; at a desktop width
          the bar is `lg:hidden`, which takes the toggle with it.
        */}
        {topbarActions &&
          createPortal(
            <button
              type="button"
              aria-label="Open course navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-full w-9 items-center justify-center rounded-md text-xl text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              ☰
            </button>,
            topbarActions
          )}

        {/* Dimmed backdrop that closes the phone drawer when tapped */}
        {menuOpen && (
          <button
            type="button"
            aria-label="Close course navigation"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          />
        )}

        {/* Course sidebar: a phone drawer below lg, a collapsible rail above it */}
        <aside
          className={`fixed bottom-0 left-0 top-12 z-55 w-64 overflow-y-auto bg-gray-200 px-4 py-6 transition-transform duration-200 dark:bg-gray-800 lg:top-0 lg:left-24 lg:z-40 ${
            menuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          } ${navHidden ? "lg:w-12 lg:px-1" : "lg:w-56 lg:px-4"}`}
        >
          {/* Which course this is (PANEL-90), only where the navigation it names is on screen */}
          {showIdentity && (
            <div className="mb-5 border-b border-gray-300 px-3 pb-4 dark:border-gray-700">
              <p className="text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-300">
                {course?.courseCode || "COURSE"}
              </p>

              <h1 className="mt-1 break-words text-base font-bold text-gray-900 dark:text-white">
                {courseTitle}
              </h1>

              {course && (course.term || course.section) && (
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  {course.term && course.year ? `${course.term} ${course.year}` : ""}
                  {course.section ? ` · Section ${course.section}` : ""}
                </p>
              )}
            </div>
          )}

          <div
            className={`mb-5 flex items-center ${
              navHidden ? "justify-center" : "justify-between gap-2 pl-3"
            }`}
          >
            {!navHidden && (
              <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                Course Navigation
              </h2>
            )}

            {/* The chevron belongs to the desktop rail; a phone has the hamburger */}
            {hasDesktopNav && (
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
            )}
          </div>

          <nav id={NAV_ID} hidden={navHidden} className="space-y-1">
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

        {/* Class content scrolls independently, full width until the rail appears at lg */}
        <main
          className={`h-full min-w-0 overflow-y-auto p-6 ${
            navHidden ? "lg:ml-12" : "lg:ml-56"
          }`}
        >
          {children}
        </main>
      </div>
    </CourseIdentityProvider>
  );
}
