"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import CreateClass, {
  type CreatedClass,
  type ProfessorOption,
} from "../../components/classes/CreateClass";

export default function CreateCoursePage() {
  const [professors, setProfessors] = useState<ProfessorOption[]>([]);
  const [loadingProfessors, setLoadingProfessors] = useState(true);
  // Kept apart from the form's own error so a submit never hides it.
  const [professorsError, setProfessorsError] = useState("");
  const [success, setSuccess] = useState("");

  const loadProfessors = useCallback(async (user: User) => {
    setLoadingProfessors(true);
    setProfessorsError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/users?role=professor", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load professors.");
      setProfessors(data.users ?? []);
    } catch (err) {
      setProfessorsError(
        err instanceof Error ? err.message : "Failed to load professors."
      );
    } finally {
      setLoadingProfessors(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void loadProfessors(user);
    });
    return unsubscribe;
  }, [loadProfessors]);

  function retryProfessors() {
    const user = getFirebaseAuth().currentUser;
    if (user) void loadProfessors(user);
  }

  function handleCreated(created: CreatedClass) {
    const professor = professors.find((p) => p.uid === created.professorId);
    setSuccess(
      `Created ${created.courseCode} ${created.name} (${created.term} ${created.year}, section ${created.section}), ` +
        `taught by ${professor?.name || professor?.email || "the selected professor"}.`
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400">
        ← Back to admin panel
      </Link>
      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Admin
      </p>
      <h1 className="text-2xl font-bold">Create course</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-500">
        Create a course and assign the professor who teaches it.
      </p>

      {success && <p className="mb-4 text-sm text-green-600">{success}</p>}

      <CreateClass
        title="Course details"
        onCreated={handleCreated}
        admin={{
          professors,
          loading: loadingProfessors,
          error: professorsError,
          onRetry: retryProfessors,
        }}
      />
    </main>
  );
}
