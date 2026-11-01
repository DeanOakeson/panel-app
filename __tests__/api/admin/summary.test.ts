// END-23 (dashboard): GET /api/admin/summary is the one read behind the /admin
// tiles and course table. It delegates to lib/adminClasses.ts — the same module
// GET /api/admin/classes uses — so the dashboard's professor column and
// enrolled-student counts must be byte-for-byte what the course list reports
// for the same documents. The 200 test below asserts that directly: it seeds
// once, calls both handlers, and deep-compares the two `classes` payloads. If
// someone forks the enrollment count for the dashboard, that test goes red.

import { beforeEach, describe, expect, it } from "vitest";
import { GET as getClasses } from "@/app/api/admin/classes/route";
import { GET as getSummary } from "@/app/api/admin/summary/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function summaryRequest(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return getSummary(new Request("http://localhost/api/admin/summary", { headers }));
}

function classesRequest(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return getClasses(new Request("http://localhost/api/admin/classes", { headers }));
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

async function summaryBody(res: Response) {
  return (await res.json()) as {
    students: number;
    professors: number;
    courses: number;
    classes: {
      id: string;
      name: string;
      courseCode: string;
      professor: { uid: string; name: string; email: string } | null;
      studentCount: number;
    }[];
  };
}

async function classesBody(res: Response) {
  return (await res.json()) as { classes: unknown[] };
}

/** How many `classes` documents actually exist — the truth `courses` must match. */
async function classDocCount() {
  return (await getAdminDb().collection("classes").get()).size;
}

beforeEach(clearEmulators);

describe("GET /api/admin/summary", () => {
  it("returns 401 without a token", async () => {
    const res = await summaryRequest();

    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await summaryRequest("not-a-real-token");

    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
    const { idToken } = await createSignedInUser(`${role}@example.com`, role);

    const res = await summaryRequest(idToken);

    expect(res.status).toBe(403);
  });

  it("counts users per role and reports the same course rows as /api/admin/classes", async () => {
    const { idToken: adminToken } = await createSignedInUser("admin@example.com", "admin");

    const { uid: professorUid } = await createSignedInUser("prof@example.com", "professor");
    await getAdminDb()
      .collection("users")
      .doc(professorUid)
      .set({ name: "Dr. Ada Lovelace", email: "prof@example.com", role: "professor" });

    const { uid: studentOne } = await createSignedInUser("student1@example.com", "student");
    const { uid: studentTwo } = await createSignedInUser("student2@example.com", "student");

    await seedClass("class-a", {
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
      professor_id: professorUid,
    });
    await seedClass("class-b", { name: "Distributed Systems", courseCode: "CS 6250" });

    // Both students in the professor-taught class, one of them in the other too.
    await enroll(studentOne, "class-a");
    await enroll(studentTwo, "class-a");
    await enroll(studentOne, "class-b");

    const res = await summaryRequest(adminToken);

    expect(res.status).toBe(200);
    const summary = await summaryBody(res);

    // The admin themself must not land in either tile count.
    expect(summary.students).toBe(2);
    expect(summary.professors).toBe(1);

    // `courses` is the count of classes documents, not something else.
    expect(await classDocCount()).toBe(2);
    expect(summary.courses).toBe(await classDocCount());

    expect(summary.classes.map((c) => c.id)).toEqual(["class-b", "class-a"]);

    const a = summary.classes.find((c) => c.id === "class-a")!;
    expect(a.professor).toMatchObject({
      uid: professorUid,
      name: "Dr. Ada Lovelace",
      email: "prof@example.com",
    });
    expect(a.studentCount).toBe(2);

    const b = summary.classes.find((c) => c.id === "class-b")!;
    expect(b.professor).toBeNull();
    expect(b.studentCount).toBe(1);

    // THE point of this test: the dashboard and the course list are served by
    // the same lib/adminClasses.ts read, so for identical data the two routes
    // must return an identical `classes` array — same rows, same order, same
    // professor, same studentCount, same shape.
    const listRes = await classesRequest(adminToken);
    expect(listRes.status).toBe(200);
    const list = await classesBody(listRes);

    expect(summary.classes).toStrictEqual(list.classes);
    expect(summary.classes.map((c) => c.id)).toEqual(list.classes.map((c) => (c as { id: string }).id));
  });

  it("reports zero courses and no rows when the school has no classes", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await summaryRequest(idToken);

    expect(res.status).toBe(200);
    const summary = await summaryBody(res);

    expect(summary.courses).toBe(0);
    expect(summary.classes).toEqual([]);
  });
});
