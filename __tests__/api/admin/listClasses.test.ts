import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/classes/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function listClasses(idToken?: string, q?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const query = q ? `?q=${encodeURIComponent(q)}` : "";

  return GET(new Request(`http://localhost/api/admin/classes${query}`, { headers }));
}

/** Seeds a class the way POST /api/classes does, so the route reads real data. */
async function seedClass(
  id: string,
  fields: { name: string; courseCode: string; professor_id?: string }
) {
  await getAdminDb()
    .collection("classes")
    .doc(id)
    .set({ year: 2026, term: "Fall", section: "001", ...fields });
}

/** Enrolls a student the way the student join flow does: users/{uid}/classes/{doc}. */
async function enroll(uid: string, classId: string, docId = classId) {
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(docId)
    .set({ class_id: classId, class_name: "ignored" });
}

async function body(res: Response) {
  return (await res.json()) as {
    classes: {
      id: string;
      name: string;
      courseCode: string;
      professor: { uid: string; name: string; email: string } | null;
      studentCount: number;
    }[];
  };
}

beforeEach(clearEmulators);

describe("GET /api/admin/classes", () => {
  it("returns 401 without a token", async () => {
    const res = await listClasses();

    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await listClasses("not-a-real-token");

    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
    const { idToken } = await createSignedInUser(`${role}@example.com`, role);

    const res = await listClasses(idToken);

    expect(res.status).toBe(403);
  });

  it("resolves the professor and counts enrolled students per class", async () => {
    const { idToken: adminToken } = await createSignedInUser("admin@example.com", "admin");
    const { uid: professorUid } = await createSignedInUser("prof@example.com", "professor");
    await getAdminDb()
      .collection("users")
      .doc(professorUid)
      .set({ name: "Dr. Ada Lovelace", email: "prof@example.com", role: "professor" });

    const { uid: studentOne } = await createSignedInUser("student1@example.com", "student");
    const { uid: studentTwo } = await createSignedInUser("student2@example.com", "student");
    const { uid: otherStudent } = await createSignedInUser("student3@example.com", "student");

    await seedClass("class-a", {
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
      professor_id: professorUid,
    });
    await seedClass("class-b", { name: "Distributed Systems", courseCode: "CS 6250" });

    await enroll(studentOne, "class-a");
    await enroll(studentTwo, "class-a");
    await enroll(otherStudent, "class-b");

    const res = await listClasses(adminToken);

    expect(res.status).toBe(200);
    const { classes } = await body(res);

    // Stable order: course code first, so CS 6250 sorts before CS 6300.
    expect(classes.map((c) => c.id)).toEqual(["class-b", "class-a"]);

    const a = classes.find((c) => c.id === "class-a")!;
    const b = classes.find((c) => c.id === "class-b")!;

    expect(a.professor).toMatchObject({
      uid: professorUid,
      name: "Dr. Ada Lovelace",
      email: "prof@example.com",
    });
    expect(a.studentCount).toBe(2);

    // No professor_id on the document: the row still lists, marked unassigned.
    expect(b.professor).toBeNull();
    expect(b.studentCount).toBe(1);
  });

  it("does not double-count a student enrolled twice in the same class", async () => {
    const { idToken: adminToken } = await createSignedInUser("admin@example.com", "admin");
    const { uid: student } = await createSignedInUser("student@example.com", "student");

    await seedClass("class-a", { name: "Algorithms", courseCode: "CS 6510" });
    await enroll(student, "class-a", "enrollment-one");
    await enroll(student, "class-a", "enrollment-two");

    const res = await listClasses(adminToken);

    expect(res.status).toBe(200);
    expect((await body(res)).classes[0].studentCount).toBe(1);
  });

  it("returns an empty list when there are no classes", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await listClasses(idToken);

    expect(res.status).toBe(200);
    expect((await body(res)).classes).toEqual([]);
  });

  it("filters by course name or code with q, case-insensitively", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    await seedClass("class-a", {
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
    });
    await seedClass("class-b", { name: "Distributed Systems", courseCode: "CS 6250" });

    const byName = await listClasses(idToken, "engineering");
    expect((await body(byName)).classes.map((c) => c.id)).toEqual(["class-a"]);

    const byCode = await listClasses(idToken, "cs 62");
    expect((await body(byCode)).classes.map((c) => c.id)).toEqual(["class-b"]);

    const noMatch = await listClasses(idToken, "physics");
    expect((await body(noMatch)).classes).toEqual([]);

    // An empty q is the same as no filter at all.
    const blank = await listClasses(idToken, "   ");
    expect((await body(blank)).classes).toHaveLength(2);
  });
});
