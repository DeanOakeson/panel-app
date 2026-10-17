"use client";

import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();

  const handleLogout = async () => {
    await signOut(getFirebaseAuth());
    router.replace("/login");
  };

  return (

    <div className="min-h-screen flex items-top justify-top bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 p-10 rounded shadow-md text-center">

        <h1 className="text-2xl font-bold text-green-600">
          Logged in ✅
        </h1>

        <p className="text-gray-600 dark:text-gray-400 mt-2 text-left">
          Welcome to your dashboard
        </p>

        {/* Non-admins get redirected back by the /admin layout */}
        <a
          href="/admin/create-user"
          className="inline-block mt-4 text-sm font-medium text-blue-600 hover:underline"
        >
          Admin: create user
        </a>

        {/* LOGOUT BUTTON */}
        <button
          onClick={handleLogout}
          className="mt-6 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
        >
          Logout
        </button>

      </div>
    </div>
  );
}
