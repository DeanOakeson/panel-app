"use client";

import { usePathname } from "next/navigation";
import DashboardSidebar from "./Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

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
    <div className="h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Fixed main sidebar */}
      <div className="fixed inset-y-0 left-0 z-50">
        <DashboardSidebar />
      </div>

      {/* Parent does not scroll on class pages */}
      <main
        className={`ml-20 h-screen bg-gray-50 dark:bg-gray-900 sm:ml-24 ${
          isClassPage
            ? "overflow-hidden p-0"
            : "overflow-y-auto p-5 sm:p-8"
        }`}
      >
        {children}
      </main>
    </div>
  );
}