import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/students/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function listStudents(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return GET(new Request("http://localhost/api/admin/students", { headers }));
}

/** Creates a student profile with a name (createSignedInUser stores email and role only). */
async function createStudent(email: string, name: string) {
  const student = await createSignedInUser(email, "student");
  await getAdminDb().collection("users").doc(student.uid).set({ name }, { merge: true });
  return student;
}

function enroll(studentUid: string, classId: string) {
  return getAdminDb()
    .collection("users")
    .doc(studentUid)
    .collection("classes")
    .add({ class_id: classId });
}

let adminToken: string;

beforeEach(async () => {
  await clearEmulators();

  const admin = await createSignedInUser("admin@example.com", "admin");
  adminToken = admin.idToken;

  const db = getAdminDb();
  await db.collection("classes").doc("cs6300").set({
    name: "Software Engineering Leadership",
    courseCode: "CS 6300",
    term: "Fall",
    year: 2026,
    section: "001",
  });
  await db.collection("classes").doc("cs2420").set({
    name: "Data Structures",
    courseCode: "CS 2420",
    term: "Fall",
    year: 2026,
    section: "002",
  });
});

describe("GET /api/admin/students", () => {
  it("returns 401 without a token", async () => {
    const res = await listStudents();
    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
    const { idToken } = await createSignedInUser(`${role}-caller@example.com`, role);

    const res = await listStudents(idToken);

    expect(res.status).toBe(403);
  });

  it("lets any admin in, not just the one in ADMIN_UID", async () => {
    process.env.ADMIN_UID = "someone-else";

    try {
      const res = await listStudents(adminToken);
      expect(res.status).toBe(200);
    } finally {
      delete process.env.ADMIN_UID;
    }
  });

  it("returns an empty list when there are no students", async () => {
    const res = await listStudents(adminToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ students: [] });
  });

  it("lists students sorted by name, with their course details", async () => {
    const zoe = await createStudent("zoe@example.com", "Zoe Young");
    const ada = await createStudent("ada@example.com", "Ada Lovelace");
    await enroll(zoe.uid, "cs6300");
    await enroll(ada.uid, "cs6300");
    await enroll(ada.uid, "cs2420");

    const res = await listStudents(adminToken);
    const { students } = await res.json();

    expect(students.map((s: { name: string }) => s.name)).toEqual(["Ada Lovelace", "Zoe Young"]);
    expect(students[0]).toMatchObject({ uid: ada.uid, email: "ada@example.com" });
    expect(
      students[0].courses.map((c: { courseCode: string }) => c.courseCode).sort()
    ).toEqual(["CS 2420", "CS 6300"]);
    expect(students[1].courses).toEqual([
      expect.objectContaining({
        id: "cs6300",
        name: "Software Engineering Leadership",
        courseCode: "CS 6300",
        term: "Fall",
        year: 2026,
        section: "001",
      }),
    ]);
  });

  it("lists a student with no enrollments with an empty course list", async () => {
    await createStudent("new@example.com", "New Student");

    const { students } = await (await listStudents(adminToken)).json();

    expect(students).toEqual([
      expect.objectContaining({ name: "New Student", courses: [] }),
    ]);
  });

  it("skips an enrollment that points at a deleted class", async () => {
    const student = await createStudent("ada@example.com", "Ada Lovelace");
    await enroll(student.uid, "cs6300");
    await enroll(student.uid, "deleted-class");

    const { students } = await (await listStudents(adminToken)).json();

    expect(students[0].courses.map((c: { id: string }) => c.id)).toEqual(["cs6300"]);
  });

  it("counts a duplicated enrollment once", async () => {
    const student = await createStudent("ada@example.com", "Ada Lovelace");
    await enroll(student.uid, "cs6300");
    await enroll(student.uid, "cs6300");

    const { students } = await (await listStudents(adminToken)).json();

    expect(students[0].courses).toHaveLength(1);
  });

  it("leaves out professors and admins", async () => {
    await createStudent("ada@example.com", "Ada Lovelace");
    await createSignedInUser("prof@example.com", "professor");

    const { students } = await (await listStudents(adminToken)).json();

    expect(students.map((s: { email: string }) => s.email)).toEqual(["ada@example.com"]);
  });

  it("sorts a student with no name by email", async () => {
    await createStudent("ada@example.com", "Ada Lovelace");
    await createSignedInUser("aaron@example.com", "student");

    const { students } = await (await listStudents(adminToken)).json();

    expect(students.map((s: { email: string }) => s.email)).toEqual([
      "aaron@example.com",
      "ada@example.com",
    ]);
  });
});
