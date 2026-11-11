"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import DashboardSidebar from "./Sidebar";
import { TopbarActionsContext } from "./TopbarActions";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Adjust state during render (a documented React pattern) so the phone
  // drawer closes on navigation — even back/forward — without an effect.
  const [navOpen, setNavOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // The right-hand end of the phone top bar, published to the page below so a
  // control that belongs in the bar can be rendered inside it (END-179).
  const [topbarActions, setTopbarActions] = useState<HTMLDivElement | null>(
    null
  );

  if (lastPath !== pathname) {
    setLastPath(pathname);
    setNavOpen(false);
  }

  const sidebarRoutes = [
    "/accounts",
    "/dashboard",
    "/groups",
    "/calendar",
    "/inbox",
    "/history",
    "/help",
    "/classes",
  ];

  const showSidebar = sidebarRoutes.some(
    (route) =>
      pathname === route || pathname.startsWith(`${route}/`)
  );

  const isClassPage = pathname.startsWith("/classes/");

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Top bar on phones and tablets; the icon rail is hidden behind it. */}
      <header className="relative z-60 flex h-12 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 lg:hidden dark:border-gray-700 dark:bg-gray-800">
        <button
          type="button"
          aria-label="Open main navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          ☰
        </button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Panel
        </span>

        {/*
          The right-hand end of the bar, empty until a page puts its own control
          in it (END-179). Sharing the bar's flex row is what keeps such a
          control off the wordmark: a control a page floats with `fixed` is
          placed by constants, and constants landed the course toggle's 36x48
          tap target squarely on top of the "Panel" text.
        */}
        <div
          ref={setTopbarActions}
          className="ml-auto flex h-full items-center"
        />
      </header>

      {/* Dimmed backdrop that closes the phone drawer when tapped */}
      {navOpen && (
        <button
          type="button"
          aria-label="Close main navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      {/* Fixed main sidebar; slides in as a drawer below the lg breakpoint */}
      <div
        className={`fixed inset-y-0 left-0 z-60 transition-transform duration-200 lg:z-50 ${
          navOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <DashboardSidebar />
      </div>

      {/* Parent does not scroll on class pages */}
      <main
        className={`min-h-0 flex-1 bg-gray-50 dark:bg-gray-900 lg:ml-24 ${
          isClassPage
            ? "overflow-hidden"
            : "overflow-y-auto p-5 sm:p-8"
        }`}
      >
        {/*
          The page's own controls read the slot above through this context, so
          they render inside the bar rather than over it (END-179).
        */}
        <TopbarActionsContext.Provider value={topbarActions}>
          {children}
        </TopbarActionsContext.Provider>
      </main>
    </div>
  );
}
