
"use client";

import { signOut } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseClient";

const navigation = [
  { name: "Accounts", icon: "👤", href: "/accounts" },
  { name: "Dashboard", icon: "▦", href: "/dashboard" },
  { name: "Classes", icon: "📚", href: "/classes" },
  { name: "Groups", icon: "👥", href: "/groups" },
  { name: "Calendar", icon: "📅", href: "/calendar" },
  { name: "Inbox", icon: "✉️", href: "/inbox" },
  { name: "History", icon: "◷", href: "/history" },
  { name: "Help", icon: "?", href: "/help" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    try {
      await signOut(auth);
      router.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  return (
    <aside className="flex h-screen w-20 shrink-0 flex-col items-center overflow-y-auto bg-gray-800 py-5 text-white sm:w-24">
      {/* Logo */}
      <button
        onClick={() => router.push("/dashboard")}
        aria-label="Go to dashboard"
        className="mb-8 flex h-12 w-12 shrink-0 items-center justify-center rounded bg-red-600 text-xl font-bold hover:bg-red-700"
      >
        C
      </button>

      {/* Navigation */}
      <nav className="flex w-full flex-1 flex-col gap-2">
        {navigation.map((item) => {
          const active =
            pathname === item.href ||
            pathname.startsWith(`${item.href}/`);

          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[68px] shrink-0 flex-col items-center justify-center gap-1 border-l-4 px-1 text-xs transition ${
                active
                  ? "border-red-500 bg-gray-700 text-white"
                  : "border-transparent text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="mt-4 flex shrink-0 flex-col items-center gap-1 px-2 py-3 text-xs text-gray-300 hover:text-white"
      >
        <span className="text-xl">↪</span>
        <span>Logout</span>
      </button>
    </aside>
  );
}
