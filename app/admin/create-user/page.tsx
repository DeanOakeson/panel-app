"use client";

import { useState } from "react";
import { auth } from "@/lib/firebaseClient";

type Role = "student" | "professor";

export default function CreateUserPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (!auth.currentUser) {
      setError("You must be signed in.");
      return;
    }

    setSubmitting(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          password,
        }),
      });

      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError(
          (data.error as string) || `Request failed (${res.status}).`
        );
        return;
      }

      setSuccess(
        `Created a ${role} account for ${(data.email as string) || email.trim()}. ` +
          "Hand the temporary password to the user so they can sign in, then reset it."
      );
      setName("");
      setEmail("");
      setRole("student");
      setPassword("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "rounded border px-3 py-2 bg-transparent text-black dark:text-white dark:border-gray-600";

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Admin
      </p>
      <h1 className="text-2xl font-bold">Create user</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-500">
        Create a student or professor account. The user signs in with the
        temporary password and should reset it after their first login.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded border p-5 bg-white dark:bg-gray-800"
      >
        <label className="flex flex-col gap-1">
          Full name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Ada Lovelace"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="ada@example.com"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={`${inputClass} dark:bg-gray-800`}
          >
            <option value="student">Student</option>
            <option value="professor">Professor</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Temporary password
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="min 6 characters"
            className={inputClass}
          />
          <span className="text-xs text-zinc-500">
            Share this with the user. They&apos;ll use it to sign in once, then
            reset it.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create user"}
        </button>
      </form>
    </main>
  );
}
