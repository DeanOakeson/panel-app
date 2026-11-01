import { getAdminDb } from "@/lib/firebaseAdmin";

/**
 * Returns the uids of every student enrolled in a class, without duplicates.
 * Enrollment is stored as users/{uid}/classes/{doc} with a class_id field.
 */
export async function loadEnrolledStudentIds(classId: string): Promise<string[]> {
  const snapshot = await getAdminDb()
    .collectionGroup("classes")
    .where("class_id", "==", classId)
    .get();

  const uids = new Set<string>();

  for (const enrollment of snapshot.docs) {
    const userRef = enrollment.ref.parent.parent;

    // The collection group also matches any other collection named "classes"
    if (userRef && userRef.parent.id === "users") {
      uids.add(userRef.id);
    }
  }

  return [...uids];
}
