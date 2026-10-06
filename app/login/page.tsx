"use client";

import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();

  const [isLogin, setIsLogin] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  //prevent flash
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        router.replace("/dashboard");
      } else {
        setCheckingAuth(false); // only show login AFTER check
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleAuth = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // 🔥 SHOW NOTHING while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">

      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded shadow-md">

        <h1 className="text-2xl font-bold text-center mb-6 text-black dark:text-white">
          {isLogin ? "Sign in" : "Create account"}
        </h1>

        <form onSubmit={handleAuth} className="space-y-4">

          <input
            type="email"
            placeholder="Email"
            className="w-full border p-3 rounded text-black dark:text-white"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full border p-3 rounded text-black dark:text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <p className="text-red-500 text-sm text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 text-white p-3 rounded hover:bg-red-700"
          >
            {loading
              ? "Loading..."
              : isLogin
              ? "Sign in"
              : "Sign up"}
          </button>
        </form>

        <p className="text-sm text-center mt-4 text-black dark:text-white">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-red-600 font-medium"
          >
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </p>

      </div>
    </div>
  );
}