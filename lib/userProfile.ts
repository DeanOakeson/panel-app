import type { User } from "firebase/auth";
import type { RoutableProfile } from "./homePath";

export type UserProfile = RoutableProfile & {
  id?: string;
  name?: string;
  email?: string;
};

/**
 * Loads the signed-in user's users/{uid} profile through GET /api/users.
 * Returns `null` when the user has no profile, and throws on any other failure.
 */
export async function fetchUserProfile(user: User): Promise<UserProfile | null> {
  const token = await user.getIdToken();

  const response = await fetch("/api/users", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Could not load your profile. Please try again.");
  }

  return (await response.json()) as UserProfile;
}
