"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

type ClassItem = {
  id: string;
  name: string;
  courseCode?: string;
  professorId?: string;
};

export default function ClassesPage() {
  const router = useRouter();

  const [role, setRole] = useState("");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClasses() {
      try {
        const user = auth.currentUser;

        if (!user) {
          router.replace("/");
          return;
        }

        const token = await user.getIdToken();

        const profileResponse = await fetch("/api/users", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!profileResponse.ok) {
          throw new Error("Failed to load user profile.");
        }

        const profileData = await profileResponse.json();
        const userRole = profileData.role;
        setRole(userRole);

        if (userRole === "student") {
          const response = await fetch("/api/classes", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Failed to load classes.");
          }

          setClasses(data.classes);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong."
        );
      } finally {
        setLoading(false);
      }
    }

    loadClasses();
  }, [router]);

  return (
    <div className="min-h-full bg-gray-100 p-8 dark:bg-gray-900">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Classes
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          View and access your classes.
        </p>
      </header>

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">
          Loading classes...
        </p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : role === "student" ? (
        <section>
          {classes.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-gray-600 dark:text-gray-300">
                You haven't joined any classes yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {classes.map((classItem) => (
                <button
                  key={classItem.id}
                  onClick={() => router.push(`/classes/${classItem.id}`)}
                  className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-2xl dark:bg-blue-900">
                    📚
                  </div>

                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {classItem.name || "Untitled Class"}
                  </h2>

                  {classItem.courseCode && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {classItem.courseCode}
                    </p>
                  )}

                  <p className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-400">
                    View Class →
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : role === "professor" ? (
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Your Classes
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Professor class management will appear here.
          </p>
        </section>
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
    </div>
  );
}