"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import {
  ASSIGNABLE_ROLES,
  buildUserChanges,
  canEditRole,
  isAssignableRole,
  type AssignableRole,
} from "@/lib/adminUserEdit";

type AdminUser = {
  uid: string;
  name: string;
  email: string;
  role: string;
};

const ROLE_FILTERS = ["all", "student", "professor", "admin"] as const;

/**
 * A fresh ID token for one request.
 *
 * Deliberately *not* captured once at sign-in and reused: a Firebase ID token
 * lives about an hour, and an admin who leaves this page open and comes back
 * would otherwise have every save and delete fail with 401 until a reload.
 * `getIdToken()` returns the cached token while it is valid and refreshes it
 * when it is not, so calling it per request is cheap.
 */
async function currentIdToken(): Promise<string | null> {
  const user = getFirebaseAuth().currentUser;
  return user ? await user.getIdToken() : null;
}

/**
 * The role filter tabs are also the target of the dashboard's "View all
 * students" / "View all professors" links: `/admin/users?role=student` opens
 * with that tab already selected. A role this page cannot filter on is ignored
 * and the list loads unfiltered, so a hand-typed `?role=` never dead-ends.
 */
function initialRoleFilter(raw: string | null): (typeof ROLE_FILTERS)[number] {
  return (ROLE_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as (typeof ROLE_FILTERS)[number])
    : "all";
}

export default function AdminUsersPage() {
  // `useSearchParams` needs a Suspense boundary above it, which the app router
  // requires for the page's prerender; everything else is the page itself.
  return (
    <Suspense fallback={<p className="p-8 text-zinc-500">Loading users...</p>}>
      <AdminUsersInner />
    </Suspense>
  );
}

function AdminUsersInner() {
  const searchParams = useSearchParams();
  const [me, setMe] = useState<{ uid: string } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  // The URL owns the filter until the admin clicks a tab: `?role=student` from
  // the dashboard opens on the students tab, and a later tab click wins over
  // the URL without rewriting it. Deriving `filter` from both, rather than
  // copying the query into state in an effect, keeps a URL change and a tab
  // click from cascading re-renders through each other.
  const [filterOverride, setFilterOverride] =
    useState<(typeof ROLE_FILTERS)[number] | null>(null);
  const filter = filterOverride ?? initialRoleFilter(searchParams.get("role"));

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Inline edit state: only one row is open at a time.
  const [editingUid, setEditingUid] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<AssignableRole>("student");
  const [savingUid, setSavingUid] = useState("");

  // Delete confirmation state. `pending` holds the row that is waiting for the
  // admin to type the name, so the dialog can name the user it will remove.
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (token: string | null, roleFilter: string) => {
      setLoading(true);
      setLoadError("");
      if (!token) {
        setLoadError("You must be signed in.");
        setLoading(false);
        return;
      }
      try {
        const query = roleFilter === "all" ? "" : `?role=${roleFilter}`;
        const res = await fetch(`/api/admin/users${query}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load users.");
        setUsers((data.users as AdminUser[]) ?? []);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load users."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (!user) {
        setLoadError("You must be signed in.");
        setLoading(false);
        return;
      }
      setMe({ uid: user.uid });
      const token = await currentIdToken();
      await load(token, filter);
    });
    return unsubscribe;
  }, [load, filter]);

  function startEdit(user: AdminUser) {
    setActionError("");
    setActionSuccess("");
    setEditingUid(user.uid);
    setEditName(user.name);
    // When the role dropdown is not offered for this row (an admin row, or the
    // admin's own row) this value is a placeholder that no request will read:
    // buildUserChanges only sends `role` if the dropdown was available.
    setEditRole(isAssignableRole(user.role) ? user.role : "student");
  }

  function cancelEdit() {
    setEditingUid("");
    setEditName("");
    setEditRole("student");
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!me) return;

    const target = users.find((u) => u.uid === editingUid);
    if (!target) return;

    const name = editName.trim();
    if (!name) {
      setActionError("Name is required.");
      return;
    }

    // Send only what actually changed, and `role` only if this row offers an
    // enabled role dropdown — otherwise the hidden select's placeholder value
    // would ride along and rename an admin into a student. All the rules live
    // in buildUserChanges so they can be tested without a DOM.
    const changes = buildUserChanges({
      targetName: target.name,
      targetRole: target.role,
      isSelf: target.uid === me.uid,
      name,
      role: editRole,
    });

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    setSavingUid(target.uid);
    setActionError("");
    setActionSuccess("");
    try {
      const token = await currentIdToken();
      if (!token) {
        setActionError("Your session expired. Please sign in again.");
        return;
      }
      const res = await fetch(`/api/admin/users/${target.uid}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess(`Saved changes for ${data.email || target.email}.`);
      cancelEdit();
      await load(await currentIdToken(), filter);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setSavingUid("");
    }
  }

  function startDelete(user: AdminUser) {
    cancelEdit();
    setActionError("");
    setActionSuccess("");
    setPendingDelete(user);
    setConfirmText("");
  }

  function cancelDelete() {
    setPendingDelete(null);
    setConfirmText("");
  }

  async function handleConfirmDelete() {
    if (!me || !pendingDelete) return;

    setDeleting(true);
    setActionError("");
    try {
      const token = await currentIdToken();
      if (!token) {
        setActionError("Your session expired. Please sign in again.");
        return;
      }
      const res = await fetch(`/api/admin/users/${pendingDelete.uid}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((data.error as string) || `Request failed (${res.status}).`);
        return;
      }
      setActionSuccess(`Deleted ${pendingDelete.name || pendingDelete.email}.`);
      cancelDelete();
      await load(await currentIdToken(), filter);
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const confirmed =
    pendingDelete !== null &&
    confirmText.trim().toLowerCase() ===
      (pendingDelete.name || pendingDelete.email).trim().toLowerCase();

  const inputClass =
    "rounded border px-2 py-1 bg-transparent text-black dark:text-white dark:border-gray-600";

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Admin
          </p>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Edit a user&apos;s name or role, or remove their account. Admin
            accounts are listed but their role cannot be changed from here.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/create-user"
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
          >
            Create user
          </Link>
          <Link
            href="/admin"
            className="rounded border border-zinc-700 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Admin panel
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {ROLE_FILTERS.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => setFilterOverride(role)}
            className={`rounded px-3 py-1 text-sm font-semibold capitalize ${
              filter === role
                ? "bg-blue-600 text-white"
                : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {role}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p className="mb-3 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {actionSuccess}
        </p>
      )}

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-title"
          className="mb-4 rounded border border-red-300 p-4 bg-white dark:bg-gray-800 dark:border-red-800"
        >
          <h2 id="delete-user-title" className="text-lg font-bold text-red-700 dark:text-red-300">
            Delete this user?
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            <strong>{pendingDelete.name || pendingDelete.email}</strong> (
            {pendingDelete.email}
            ) will be removed, along with their profile, course enrollments, and
            submissions. This cannot be undone.
          </p>
          <label className="mt-3 flex flex-col gap-1 text-sm">
            Type{" "}
            <code className="font-mono">
              {pendingDelete.name || pendingDelete.email}
            </code>{" "}
            to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={pendingDelete.name || pendingDelete.email}
              className={inputClass}
            />
          </label>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => void handleConfirmDelete()}
              disabled={!confirmed || deleting}
              className="rounded bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete user"}
            </button>
            <button
              type="button"
              onClick={cancelDelete}
              disabled={deleting}
              className="rounded border border-zinc-300 px-4 py-2 font-semibold hover:bg-zinc-100 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500">Loading users...</p>
      ) : loadError ? (
        <p className="text-red-600">{loadError}</p>
      ) : users.length === 0 ? (
        <p className="text-zinc-500">No users match this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-300 dark:border-gray-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-600 dark:bg-gray-800 dark:text-zinc-300">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isMe = user.uid === me?.uid;

                return (
                  <tr
                    key={user.uid}
                    className="border-t border-zinc-200 dark:border-gray-700"
                  >
                    <td className="px-4 py-3">
                      {editingUid === user.uid ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={inputClass}
                          aria-label="Name"
                        />
                      ) : (
                        user.name || <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{user.email}</td>
                    <td className="px-4 py-3">
                      {editingUid === user.uid ? (
                        canEditRole(user.role, isMe) ? (
                          <select
                            value={editRole}
                            onChange={(e) =>
                              setEditRole(e.target.value as AssignableRole)
                            }
                            className={`${inputClass} dark:bg-gray-800`}
                            aria-label="Role"
                          >
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        ) : (
                          // Admins, other non-assignable roles, and the
                          // admin's own row stay as text: this endpoint cannot
                          // change role into or out of admin, and refuses a
                          // self role change, so a dropdown here would be a lie.
                          <span>
                            {user.role}{" "}
                            <span className="text-xs text-zinc-500">
                              (role not editable)
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="capitalize">{user.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingUid === user.uid ? (
                        <form
                          onSubmit={(e) => void handleSave(e)}
                          className="flex justify-end gap-2"
                        >
                          <button
                            type="submit"
                            disabled={savingUid === user.uid}
                            className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingUid === user.uid ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={savingUid === user.uid}
                            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-gray-600 dark:hover:bg-gray-700"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-gray-600 dark:hover:bg-gray-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => startDelete(user)}
                            disabled={isMe}
                            title={
                              isMe
                                ? "You cannot delete your own account."
                                : undefined
                            }
                            className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
