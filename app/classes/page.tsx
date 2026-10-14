
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import StudentClasses from "../components/classes/StudentClasses";
import ProfessorClasses from "../components/classes/ProfessorClasses";
import CreateCourseForm from "../components/classes/CreateClass";
import type { ClassItem } from "../components/Types";

export default function ClassesPage() {
  const router = useRouter();

  const [role, setRole] = useState("");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadClasses = useCallback(async (user: User) => {
    try {
      const token = await user.getIdToken();

      // Load the user's profile and role.
      const profileResponse = await fetch("/api/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const profileData = await profileResponse.json();

      if (!profileResponse.ok) {
        throw new Error(
          profileData.error || "Failed to load user profile."
        );
      }

      const userRole = profileData.role;
      setRole(userRole);

      // Load classes for students and professors.
      if (userRole === "student" || userRole === "professor") {
        const endpoint =
          userRole === "student"
            ? "/api/classes/student"
            : "/api/classes/professor";

        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load classes.");
        }

        setClasses(data.classes ?? []);
      } else {
        setClasses([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      void loadClasses(user);
    });

    return unsubscribe;
  }, [loadClasses, router]);

  const reloadClasses = useCallback(async () => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    setLoading(true);
    setError("");
    await loadClasses(user);
  }, [loadClasses, router]);

  const isProfessor = role === "professor";

  return (
    <main className="mx-auto min-h-full w-full max-w-5xl p-8">
      {/* Page heading and create button */}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {isProfessor ? "Your courses" : "Classes"}
          </h1>

          <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
            {isProfessor
              ? "Courses assigned to you by the administrator."
              : "View and access your classes."}
          </p>
        </div>

        {isProfessor && !loading && !error && (
          <button
            type="button"
            onClick={() => setShowCreateForm((current) => !current)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            {showCreateForm ? "Cancel" : "+ Create course"}
          </button>
        )}
      </header>

      {/* Create course form */}
      {showCreateForm && isProfessor && (
        <CreateCourseForm
          onCancel={() => setShowCreateForm(false)}
          onCreated={async () => {
            setShowCreateForm(false);
            await reloadClasses();
          }}
        />
      )}

      {/* Loading, error, and role-specific content */}
      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">
          Loading classes...
        </p>
      ) : error ? (
        <div>
          <p className="text-red-600">{error}</p>

          <button
            type="button"
            onClick={reloadClasses}
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Try again
          </button>
        </div>
      ) : role === "student" ? (
        <StudentClasses classes={classes} />
      ) : role === "professor" ? (
        <ProfessorClasses classes={classes} />
      ) : role === "admin" ? (
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Classes
          </h2>

          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage classes from the admin dashboard.
          </p>
        </section>
      ) : (
        <p className="text-gray-600 dark:text-gray-300">
          Your account role is not configured.
        </p>
      )}
    </main>
  );
}
