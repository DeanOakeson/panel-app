// END-54: the admin must be able to answer "which course did this student ask
// to join?". Two routes serve that:
//
//   GET   /api/admin/requests                       -> the pending queue
//   PATCH /api/admin/requests/{classId}/{studentId} -> approve or reject one
//
// Both are admin-gated by lib/adminGuard.ts, and both are the only way a
// request becomes an enrollment: a student's own POST only records intent (see
// __tests__/api/classes/enroll.test.ts). The tests below pin the three things
// that make the ticket real — every row carries its course AND its student,
// approving writes the roster and empties the queue in one step, and rejecting
// empties the queue without touching the roster.

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as listRequests } from "@/app/api/admin/requests/route";
import { PATCH as decideRequest } from "@/app/api/admin/requests/[classId]/[studentId]/route";
import { POST as adminEnroll } from "@/app/api/admin/classes/[classId]/enrollments/route";
import { GET as getSummary } from "@/app/api/admin/summary/route";
import { POST as requestCourse } from "@/app/api/classes/[classId]/enroll/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function listRequest(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return listRequests(
    new Request("http://localhost/api/admin/requests", { headers })
  );
}

function decideRequestFor(classId: string, studentId: string, idToken: string | undefined, action: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return decideRequest(
    new NextRequest(`http://localhost/api/admin/requests/${classId}/${studentId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ classId, studentId }) }
  );
}

type RequestRow = {
  classId: string;
  courseCode: string;
  name: string;
  term: string;
  year: number | null;
  section: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  requestedAt: string;
};

async function requestRows(res: Response) {
  const body = (await res.json()) as { requests: RequestRow[] };
  return body.requests;
}

/** The student's pending entries as stored on their user doc. */
async function pendingEntries(uid: string) {
  const doc = await getAdminDb().collection("users").doc(uid).get();
  return (doc.data()?.requestedCourses ?? []) as { classId: string; status: string }[];
}

async function enrollmentDocs(uid: string) {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/** Seeds a real pending request straight into storage (what the student route writes). */
async function seedPendingRequest(uid: string, classId: string, requestedAt: string) {
  // Read-modify-write appends without touching the student's other requests;
  // `set` with merge alone would replace the whole array on the second call for
  // the same student, and the emulator's array-union de-duplication of equal
  // map values is not something a seed helper should depend on.
  const ref = getAdminDb().collection("users").doc(uid);
  const doc = await ref.get();
  const existing = Array.isArray(doc.data()?.requestedCourses)
    ? (doc.data()!.requestedCourses as unknown[])
    : [];

  await ref.set(
    { requestedCourses: [...existing, { classId, status: "pending", requestedAt }] },
    { merge: true }
  );
}

let adminToken: string;
let studentUid: string;
let studentToken: string;

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
    professor_id: "",
  });
  await db.collection("classes").doc("cs2420").set({
    name: "Data Structures",
    courseCode: "CS 2420",
    term: "Spring",
    year: 2026,
    section: "002",
    professor_id: "",
  });

  const student = await createSignedInUser("student@example.com", "student");
  studentUid = student.uid;
  studentToken = student.idToken;
  await db
    .collection("users")
    .doc(studentUid)
    .set({ name: "Sam Student", email: "student@example.com", role: "student" }, { merge: true });
});

describe("GET /api/admin/requests", () => {
  it("returns 401 without a token", async () => {
    const res = await listRequest();
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await listRequest("not-a-real-token");
    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
    const { idToken } = await createSignedInUser(`${role}-2@example.com`, role);
    const res = await listRequest(idToken);
    expect(res.status).toBe(403);
  });

  it("returns an empty queue when no one has asked", async () => {
    const res = await listRequest(adminToken);

    expect(res.status).toBe(200);
    expect(await requestRows(res)).toEqual([]);
  });

  // (e) the ticket's whole point: the row names the course, not just the student.
  it("reports each pending request with its course and its student", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await listRequest(adminToken);

    expect(res.status).toBe(200);
    const rows = await requestRows(res);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      classId: "cs6300",
      courseCode: "CS 6300",
      name: "Software Engineering Leadership",
      term: "Fall",
      year: 2026,
      section: "001",
      studentUid,
      studentName: "Sam Student",
      studentEmail: "student@example.com",
      requestedAt: "2026-10-01T09:00:00.000Z",
    });
  });

  it("lists one row per student per course, oldest request first", async () => {
    const other = await createSignedInUser("student2@example.com", "student");
    await getAdminDb()
      .collection("users")
      .doc(other.uid)
      .set({ name: "Ava Asks", email: "student2@example.com", role: "student" }, { merge: true });

    await seedPendingRequest(studentUid, "cs6300", "2026-10-05T09:00:00.000Z");
    await seedPendingRequest(studentUid, "cs2420", "2026-10-02T09:00:00.000Z");
    await seedPendingRequest(other.uid, "cs6300", "2026-10-01T09:00:00.000Z");

    const rows = await requestRows(await listRequest(adminToken));

    expect(rows.map((row) => [row.courseCode, row.studentName])).toEqual([
      ["CS 6300", "Ava Asks"],
      ["CS 2420", "Sam Student"],
      ["CS 6300", "Sam Student"],
    ]);
  });

  it("hides decided and broken entries: only pending requests with a real course show up", async () => {
    const db = getAdminDb();

    // A leftover entry with a status no admin can act on.
    await db
      .collection("users")
      .doc(studentUid)
      .set(
        { requestedCourses: [{ classId: "cs2420", status: "cancelled", requestedAt: "x" }] },
        { merge: true }
      );
    // A pending request for a class that no longer exists.
    await seedPendingRequest(studentUid, "ghost-class", "2026-10-01T09:00:00.000Z");
    // A real one.
    await seedPendingRequest(studentUid, "cs6300", "2026-10-02T09:00:00.000Z");

    const rows = await requestRows(await listRequest(adminToken));

    expect(rows.map((row) => row.classId)).toEqual(["cs6300"]);
  });
});

describe("PATCH /api/admin/requests/[classId]/[studentId]", () => {
  it("returns 401 without a token and 403 for a student", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    expect(
      (await decideRequestFor("cs6300", studentUid, undefined, "approve")).status
    ).toBe(401);
    expect(
      (await decideRequestFor("cs6300", studentUid, studentToken, "approve")).status
    ).toBe(403);
  });

  it("rejects a body that is not approve or reject", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await decideRequestFor("cs6300", studentUid, adminToken, "maybe");

    expect(res.status).toBe(400);
    expect(await pendingEntries(studentUid)).toHaveLength(1);
  });

  it("returns 404 for a class that does not exist", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await decideRequestFor("nope", studentUid, adminToken, "approve");

    expect(res.status).toBe(404);
    expect(await enrollmentDocs(studentUid)).toEqual([]);
  });

  // (f) approve = enroll + clear the queue entry, in one call.
  it("approve enrolls the student and clears the pending entry", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await decideRequestFor("cs6300", studentUid, adminToken, "approve");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      approved: true,
      enrolled: true,
      classId: "cs6300",
      studentId: studentUid,
    });

    expect(await enrollmentDocs(studentUid)).toEqual([
      { id: "cs6300", class_id: "cs6300", enrolledAt: expect.any(String) },
    ]);
    expect(await pendingEntries(studentUid)).toEqual([]);

    // And the queue the admin reads is now empty for that request.
    expect(await requestRows(await listRequest(adminToken))).toEqual([]);
  });

  it("approve leaves the student's other pending requests alone", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");
    await seedPendingRequest(studentUid, "cs2420", "2026-10-02T09:00:00.000Z");

    await decideRequestFor("cs6300", studentUid, adminToken, "approve");

    expect(await pendingEntries(studentUid)).toEqual([
      {
        classId: "cs2420",
        status: "pending",
        requestedAt: "2026-10-02T09:00:00.000Z",
      },
    ]);
    expect((await requestRows(await listRequest(adminToken))).map((r) => r.classId)).toEqual([
      "cs2420",
    ]);
  });

  it("approve on a request that is not pending is a 409, not a silent enrollment", async () => {
    // Enrolled by the admin's "Add a student" control, with nothing queued.
    await getAdminDb()
      .collection("users")
      .doc(studentUid)
      .collection("classes")
      .doc("cs6300")
      .set({ class_id: "cs6300", enrolledAt: "2026-10-01T08:00:00.000Z" });

    const res = await decideRequestFor("cs6300", studentUid, adminToken, "approve");

    expect(res.status).toBe(409);
    expect((await enrollmentDocs(studentUid)).filter((d) => d.id === "cs6300")).toHaveLength(1);
  });

  it("approve refuses to enroll a profile that is no longer a student", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");
    await getAdminDb()
      .collection("users")
      .doc(studentUid)
      .set({ role: "professor" }, { merge: true });

    const res = await decideRequestFor("cs6300", studentUid, adminToken, "approve");

    expect(res.status).toBe(400);
    expect(await enrollmentDocs(studentUid)).toEqual([]);
  });

  // (g) reject = drop the request, enroll nobody.
  it("reject removes the pending entry and does NOT enroll", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await decideRequestFor("cs6300", studentUid, adminToken, "reject");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rejected: true,
      classId: "cs6300",
      studentId: studentUid,
    });

    expect(await enrollmentDocs(studentUid)).toEqual([]);
    expect(await pendingEntries(studentUid)).toEqual([]);
    expect(await requestRows(await listRequest(adminToken))).toEqual([]);
  });

  it("rejecting twice is a 409 the second time", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    expect(
      (await decideRequestFor("cs6300", studentUid, adminToken, "reject")).status
    ).toBe(200);
    expect(
      (await decideRequestFor("cs6300", studentUid, adminToken, "reject")).status
    ).toBe(409);
    expect(await enrollmentDocs(studentUid)).toEqual([]);
  });

  it("a rejected student may request the course again", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");
    await decideRequestFor("cs6300", studentUid, adminToken, "reject");

    // The student's own POST is the way back into the queue: rejection clears
    // the entry rather than storing a refusal they could never undo.
    const res = await requestCourse(
      new NextRequest("http://localhost/api/classes/cs6300/enroll", {
        method: "POST",
        headers: { authorization: `Bearer ${studentToken}` },
      }),
      { params: Promise.resolve({ classId: "cs6300" }) }
    );

    expect(res.status).toBe(201);
    expect((await requestRows(await listRequest(adminToken))).map((r) => r.classId)).toEqual([
      "cs6300",
    ]);
  });
});

// The admin can also enroll from the course page instead of approving here.
// That action answers the same ask, so it has to empty the same queue.
describe("admin manual-enroll clears the queue", () => {
  it("admin manual-enroll removes the student's pending request for that class", async () => {
    // The other approval door: "Add a student" on the course page. It answers
    // the ask, so the queue entry must not sit there with a dead Approve.
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    };

    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");
    const res = await adminEnroll(
      new NextRequest("http://localhost/api/admin/classes/cs6300/enrollments", {
        method: "POST",
        headers,
        body: JSON.stringify({ studentId: studentUid }),
      }),
      { params: Promise.resolve({ classId: "cs6300" }) }
    );

    expect(res.status).toBe(201);
    expect(await enrollmentDocs(studentUid)).toHaveLength(1);
    expect(await pendingEntries(studentUid)).toEqual([]);
    expect(await requestRows(await listRequest(adminToken))).toEqual([]);
  });
});

// END-21 / END-48 guardrail: the queue must never leak into the numbers that
// mean "enrolled".
describe("pending requests do not move enrollment counts", () => {
  it("keeps /api/admin/summary studentCount on actual enrollments while reporting the queue separately", async () => {
    // One student enrolled for real, one only asking.
    const enrolled = await createSignedInUser("enrolled@example.com", "student");
    await getAdminDb()
      .collection("users")
      .doc(enrolled.uid)
      .collection("classes")
      .doc("cs6300")
      .set({ class_id: "cs6300", enrolledAt: "2026-10-01T08:00:00.000Z" });

    await seedPendingRequest(studentUid, "cs6300", "2026-10-02T09:00:00.000Z");

    const res = await getSummary(
      new Request("http://localhost/api/admin/summary", {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    );

    expect(res.status).toBe(200);
    const summary = (await res.json()) as {
      pendingRequests: number;
      classes: { id: string; studentCount: number }[];
    };

    const cs6300 = summary.classes.find((c) => c.id === "cs6300")!;
    expect(cs6300.studentCount).toBe(1);
    expect(summary.pendingRequests).toBe(1);
  });
});
