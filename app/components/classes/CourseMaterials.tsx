"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import {
  ALLOWED_MATERIAL_TYPES,
  MATERIAL_FILE_ACCEPT,
  MAX_MATERIAL_FILE_SIZE,
  formatFileSize,
} from "@/lib/courseMaterials";

type Material = {
  id: string;
  title: string;
  description?: string;
  url?: string | null;
  fileName?: string;
  fileSize?: number;
  fileUrl?: string | null;
};

const inputClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

/**
 * Mirrors the server's check: any link the browser can parse with an
 * http or https scheme. Spaces are fine; they get encoded when saved.
 */
function checkLink(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return "Links must start with http:// or https://.";
  }
  try {
    new URL(trimmed);
    return null;
  } catch {
    return "That link isn't valid. Check it for typos.";
  }
}

export default function CourseMaterials({ classId }: { classId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isProfessor, setIsProfessor] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

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
    if (!description.trim()) {
      setFormError("Description is required.");
      return;
    }
    const linkError = url.trim() ? checkLink(url) : null;
    if (linkError) {
      setFormError(linkError);
      return;
    }
    if (file) {
      if (file.size > MAX_MATERIAL_FILE_SIZE) {
        setFormError("Files must be 4 MB or smaller. Share larger files as a link.");
        return;
      }
      if (!ALLOWED_MATERIAL_TYPES[file.type]) {
        setFormError("Upload a PDF, Word, PowerPoint, Excel, text, PNG, or JPEG file.");
        return;
      }
    }

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setFormError("Please sign in again.");
      return;
    }

    setSaving(true);
    try {
      // Form data so a file can ride along; the browser sets the content type.
      const body = new FormData();
      body.append("title", title.trim());
      body.append("description", description.trim());
      body.append("url", url.trim());
      if (file) body.append("file", file);

      const res = await authedFetch(user, `/api/classes/${classId}/materials`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add material.");

      setTitle("");
      setUrl("");
      setDescription("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    // Ignore a second click while the first request is still running.
    if (deletingId) return;

    const user = getFirebaseAuth().currentUser;
    if (!user) {
      setDeleteError({ id, message: "Please sign in again." });
      return;
    }

    setDeletingId(id);
    setDeleteError(null);
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
      // Show the error on this item only, so the rest of the list stays visible.
      setDeleteError({
        id,
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setDeletingId(null);
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
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What is this and when should students use it?"
              className={inputClass}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            Link (optional)
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            File (optional)
            <input
              ref={fileInputRef}
              id="material-file"
              type="file"
              accept={MATERIAL_FILE_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-800 hover:file:bg-gray-200 dark:text-gray-300 dark:file:bg-zinc-800 dark:file:text-gray-200"
            />
          </label>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Files up to 4 MB: PDF, Word, PowerPoint, Excel, text, PNG, or JPEG.
            For bigger files or videos, share a link instead and make sure
            students have permission to open it.
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
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                  {m.title} ↗
                </a>
              ) : (
                <span className="font-semibold text-gray-900 dark:text-white">
                  {m.title}
                </span>
              )}
              {m.description && (
                <p className="whitespace-pre-line text-sm text-gray-600 dark:text-zinc-300">
                  {m.description}
                </p>
              )}
              {m.fileName &&
                (m.fileUrl ? (
                  <a
                    href={m.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="self-start rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800"
                  >
                    Download {m.fileName}
                    {typeof m.fileSize === "number" ? ` (${formatFileSize(m.fileSize)})` : ""}
                  </a>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-zinc-400">
                    {m.fileName} is unavailable right now. Try reloading the page.
                  </p>
                ))}

              {isProfessor &&
                (confirmingId === m.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-gray-700 dark:text-gray-300">
                      Remove &quot;{m.title}&quot;?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(m.id)}
                      disabled={deletingId === m.id}
                      className="rounded-md bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-60"
                    >
                      {deletingId === m.id ? "Removing..." : "Yes, remove"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        setDeleteError(null);
                      }}
                      disabled={deletingId === m.id}
                      className="text-gray-600 hover:text-gray-800 dark:text-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingId(m.id);
                      setDeleteError(null);
                    }}
                    className="mt-1 self-start text-sm text-red-600 hover:text-red-500"
                  >
                    Remove
                  </button>
                ))}

              {deleteError?.id === m.id && (
                <p className="text-sm text-red-600">{deleteError.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
