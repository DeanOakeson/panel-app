
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

type Role = "student" | "professor" | "admin";
type ProfessorStatus = "pending" | "approved" | "rejected" | "not_requested";

type UserProfile = {
  success?: boolean;
  uid?: string;
  role?: Role;
  professorStatus?: ProfessorStatus | string;
};

export default function AuthPage() {
  const router = useRouter();
  const skipRedirect = useRef(false);

  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "professor">("student");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  function getDestination(profile: UserProfile): string | null {
    // Admin accounts can access the professor approval page.
    if (profile.role === "admin") {
      return "/admin/professors";
    }

    // Students who have not requested professor access use the dashboard.
    if (
      profile.role === "student" &&
      profile.professorStatus === "not_requested"
    ) {
      return "/dashboard";
    }

    // Applicants must wait for approval.
    if (profile.professorStatus === "pending") {
      return "/pending-approval";
    }

    // Rejected applicants must not access professor features.
    if (profile.professorStatus === "rejected") {
      return "/pending-approval";
    }

    // Only approved professors can enter the dashboard as professors.
    if (
      profile.role === "professor" &&
      profile.professorStatus === "approved"
    ) {
      return "/dashboard";
    }

    return null;
  }

  async function fetchUserProfile(user: User): Promise<UserProfile> {
    const token = await user.getIdToken();

    const response = await fetch("/api/users", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Could not load your profile. Please try again.");
    }

    return (await response.json()) as UserProfile;
  }

  // Check the saved Firestore profile when authentication changes.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setCheckingAuth(false);
        return;
      }

      if (skipRedirect.current) {
        setCheckingAuth(false);
        return;
      }

      try {
        const profile = await fetchUserProfile(user);
        const destination = getDestination(profile);

        if (destination) {
          router.replace(destination);
        } else {
          setError(
            "Your account status could not be verified. Please contact an administrator."
          );
          setCheckingAuth(false);
        }
      } catch (err) {
        console.error("Failed to check user profile:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Could not verify your account."
        );
        setCheckingAuth(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  async function createUserProfile(
    user: User,
    displayName: string,
    requestedRole: "student" | "professor"
  ): Promise<UserProfile> {
    const token = await user.getIdToken();

    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: displayName,
        role: requestedRole,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? "Could not save your profile.");
    }

    return result as UserProfile;
  }

  async function handleAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isLogin) {
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        const profile = await fetchUserProfile(credential.user);
        const destination = getDestination(profile);

        if (!destination) {
          setError(
            "Your account status could not be verified. Please contact an administrator."
          );
          return;
        }

        router.replace(destination);
        return;
      }

      const displayName = name.trim();

      if (!displayName) {
        throw new Error("Please enter your full name.");
      }

      skipRedirect.current = true;

      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      try {
        await updateProfile(credential.user, {
          displayName,
        });

        const profile = await createUserProfile(
          credential.user,
          displayName,
          role
        );

        const destination = getDestination(profile);

        if (!destination) {
          throw new Error(
            "Your account was created, but its role or approval status is invalid. Please contact an administrator."
          );
        }

        router.replace(destination);
      } catch (profileError) {
        await signOut(auth);
        throw profileError;
      } finally {
        skipRedirect.current = false;
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setIsLogin((previous) => !previous);
    setError("");
  }

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded bg-white p-8 shadow-md dark:bg-gray-800">
        <h1 className="mb-6 text-center text-2xl font-bold text-black dark:text-white">
          {isLogin ? "Sign in" : "Create account"}
        </h1>

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm text-gray-700 dark:text-gray-300"
              >
                Full name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Your full name"
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border p-3 text-white"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm text-gray-700 dark:text-gray-300"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border p-3 text-white"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm text-gray-700 dark:text-gray-300"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border p-3 text-white"
            />
          </div>

          {!isLogin && (
            <div>
              <label
                htmlFor="role"
                className="mb-2 block text-sm text-gray-700 dark:text-gray-300"
              >
                Sign up as
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "student" | "professor")
                }
                className="w-full rounded border p-3 text-white"
              >
                <option value="student">Student</option>
                <option value="professor">Professor</option>
              </select>

              {role === "professor" && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Your professor account requires administrator approval
                  before you can use professor features.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-center text-sm text-red-500">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-red-600 p-3 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : isLogin
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-black dark:text-white">
          {isLogin
            ? "Don't have an account?"
            : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={toggleMode}
            className="font-medium text-red-600"
          >
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
