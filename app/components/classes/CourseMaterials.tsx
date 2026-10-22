"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type Material = {
  id: string;
  title: string;
  url: string;
  description?: string;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

export default function CourseMaterials({ classId }: { classId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isProfessor, setIsProfessor] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const authedFetch = useCallback(
    async (user: User, path: string, init: RequestInit = {}) => {
      const token = await user.getIdToken();
      return fetch(path, {
        ...init,
        cache: "no-store",
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    },
    []
  );

  const loadMaterials = useCallback(
    async (user: User) => {
      setError("");
      try {
        const [materialsRes, profileRes] = await Promise.all([
          authedFetch(user, `/api/classes/${classId}/materials`),
          authedFetch(user, "/api/users"),
        ]);

        const data = await materialsRes.json();
        if (!materialsRes.ok) {
          throw new Error(data.error || "Failed to load course materials.");
        }
        setMaterials(data.materials ?? []);

        if (profileRes.ok) {
          const profile = await profileRes.json();
          // The server still checks that this professor teaches the class.
          setIsProfessor(profile.role === "professor");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [authedFetch, classId]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) void loadMaterials(user);
    });
    return unsubscribe;
  }, [loadMaterials]);

  async function reload() {
    const user = getFirebaseAuth().currentUser;
    if (user) await loadMaterials(user);
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");

    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      setFormError("Enter a link starting with http:// or https://.");
      return;
    }

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setFormError("Please sign in again.");
      return;
    }

    setSaving(true);
    try {
      const res = await authedFetch(user, `/api/classes/${classId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          url: url.trim(),
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add material.");

      setTitle("");
      setUrl("");
      setDescription("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;

    try {
      const res = await authedFetch(
        user,
        `/api/classes/${classId}/materials/${id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove material.");
      setConfirmingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <section className="mt-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
          Course materials
        </h3>

        {isProfessor && !loading && (
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            {showForm ? "Cancel" : "+ Add material"}
          </button>
        )}
      </header>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-gray-900"
        >
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={150}
              placeholder="e.g. Syllabus"
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Link
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Description (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Share files with a link (Google Drive, OneDrive, YouTube, a website).
            Make sure students have permission to open it.
          </p>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {saving ? "Adding..." : "Add material"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-600 dark:text-gray-300">Loading materials...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : materials.length === 0 ? (
        <p className="text-gray-500 dark:text-zinc-400">No course materials yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {materials.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-gray-900"
            >
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                {m.title} ↗
              </a>
              {m.description && (
                <p className="whitespace-pre-line text-sm text-gray-600 dark:text-zinc-300">
                  {m.description}
                </p>
              )}

              {isProfessor &&
                (confirmingId === m.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-gray-700 dark:text-gray-300">
                      Remove &quot;{m.title}&quot;?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(m.id)}
                      className="rounded-md bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500"
                    >
                      Yes, remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="text-gray-600 hover:text-gray-800 dark:text-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(m.id)}
                    className="mt-1 self-start text-sm text-red-600 hover:text-red-500"
                  >
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
