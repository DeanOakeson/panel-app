"use client";

import { useEffect } from "react";
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
      <aside className="fixed bottom-0 left-24 top-0 z-40 w-56 overflow-y-auto bg-grey-200 px-4 py-6">
        <h2 className="mb-5 px-3 text-sm font-semibold text-gray-200">
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
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "border-l-2 border-red-600 font-semibold text-white"
                    : "text-gray-100 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Class content scrolls independently */}
      <main className="ml-56 min-w-0 p-6">
        {children}
      </main>
    </div>
  );
}