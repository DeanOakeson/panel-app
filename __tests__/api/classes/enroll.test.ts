import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAvailable } from "@/app/api/classes/available/route";
import {
  POST as enrollInCourse,
  DELETE as withdrawRequest,
} from "@/app/api/classes/[classId]/enroll/route";
import { GET as getStudentClasses } from "@/app/api/classes/student/route";
import { GET as listRequests } from "@/app/api/admin/requests/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { selfEnroll } from "@/lib/enrollmentRequests";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function request(path: string, method: string, idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function enrollIn(classId: string, idToken?: string) {
  return enrollInCourse(request(`/api/classes/${classId}/enroll`, "POST", idToken), {
    params: Promise.resolve({ classId }),
  });
}

function withdrawFrom(classId: string, idToken?: string) {
  return withdrawRequest(request(`/api/classes/${classId}/enroll`, "DELETE", idToken), {
    params: Promise.resolve({ classId }),
  });
}

function enrollments(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("classes");
}

/** The student's `requestedCourses` array as stored on their user doc. */
async function requestedCourses(uid: string) {
  const doc = await getAdminDb().collection("users").doc(uid).get();
  return (doc.data()?.requestedCourses ?? []) as {
    classId: string;
    status: string;
    requestedAt: string;
  }[];
}

/** The admin request queue, as /admin/requests reads it. */
async function requestQueue(idToken: string) {
  const res = await listRequests(
    new Request("http://localhost/api/admin/requests", {
      headers: { authorization: `Bearer ${idToken}` },
    })
  );
  const body = (await res.json()) as { requests: { classId: string }[] };
  return body.requests;
}

/**
 * Seeds a pending request straight into storage — what the pre-END-60 request
 * flow wrote. With self-enrollment restored (PANEL-26) the student's own POST
 * no longer creates these, so tests that exercise the leftover-request paths
 * (Requested badge, withdraw, an admin deciding an in-flight request) seed the
 * entry the way old data looks.
 */
async function seedPendingRequest(uid: string, classId: string, requestedAt: string) {
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

let studentUid: string;
let studentToken: string;

beforeEach(async () => {
  await clearEmulators();

  const professor = await createSignedInUser("prof@example.com", "professor");
  await getAdminDb().collection("users").doc(professor.uid).set(
    { name: "Dr. Ada" },
    { merge: true }
  );

  const db = getAdminDb();
  await db.collection("classes").doc("cs6300").set({
    name: "Software Engineering Leadership",
    courseCode: "CS 6300",
    term: "Fall",
    year: 2026,
    section: "001",
    professor_id: professor.uid,
  });
  await db.collection("classes").doc("cs2420").set({
    name: "Data Structures",
    courseCode: "CS 2420",
    term: "Fall",
    year: "2026",
    // Some older classes store the section as a number
    section: 2,
    professor_id: "",
  });

  const student = await createSignedInUser("student@example.com", "student");
  studentUid = student.uid;
  studentToken = student.idToken;
});

describe("GET /api/classes/available", () => {
  it("returns 401 without a token", async () => {
    const res = await getAvailable(request("/api/classes/available", "GET"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a professor", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");
    const res = await getAvailable(request("/api/classes/available", "GET", idToken));
    expect(res.status).toBe(403);
  });

  it("lists every class with the professor's name, sorted by course code", async () => {
    const res = await getAvailable(request("/api/classes/available", "GET", studentToken));

    expect(res.status).toBe(200);
    const { classes } = await res.json();
    expect(classes.map((c: { id: string }) => c.id)).toEqual(["cs2420", "cs6300"]);
    expect(classes[1]).toMatchObject({
      courseCode: "CS 6300",
      professorName: "Dr. Ada",
      enrolled: false,
      requested: false,
    });
    expect(classes[0]).toMatchObject({ section: "2", year: 2026, professorName: null });
  });

  it("marks classes the student is already enrolled in, including older auto-ID enrollments", async () => {
    await enrollments(studentUid).add({ class_id: "cs6300" });

    const res = await getAvailable(request("/api/classes/available", "GET", studentToken));
    const { classes } = await res.json();

    expect(classes.find((c: { id: string }) => c.id === "cs6300").enrolled).toBe(true);
    expect(classes.find((c: { id: string }) => c.id === "cs2420").enrolled).toBe(false);
  });

  // A leftover in-flight request (seeded the way pre-END-60 data looks) still
  // shows as Requested, and never as enrolled: the queue is the only thing
  // waiting on an admin.
  it("marks an in-flight request as requested, and NOT as enrolled", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await getAvailable(request("/api/classes/available", "GET", studentToken));
    const { classes } = await res.json();
    const cs6300 = classes.find((c: { id: string }) => c.id === "cs6300");

    expect(cs6300.requested).toBe(true);
    expect(cs6300.enrolled).toBe(false);
    expect(classes.find((c: { id: string }) => c.id === "cs2420").requested).toBe(false);
  });

  // PANEL-26: the browse list is the catalog of courses a student can join, so
  // a course closed to enrollment is not advertised on it — even to a student
  // who already has a pending request on it.
  it("hides a class that is closed to enrollment", async () => {
    await getAdminDb()
      .collection("classes")
      .doc("cs9990")
      .set({
        name: "Old Seminar",
        courseCode: "CS 9990",
        term: "Spring",
        year: 2024,
        section: "001",
        professor_id: "",
        enrollmentOpen: false,
      });
    await seedPendingRequest(studentUid, "cs9990", "2026-10-01T09:00:00.000Z");

    const res = await getAvailable(request("/api/classes/available", "GET", studentToken));
    const { classes } = await res.json();

    expect(classes.map((c: { id: string }) => c.id)).toEqual(["cs2420", "cs6300"]);
  });
});

describe("POST /api/classes/[classId]/enroll (self-enrollment)", () => {
  it("returns 401 without a token", async () => {
    const res = await enrollIn("cs6300");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a professor and writes no roster doc", async () => {
    const { uid, idToken } = await createSignedInUser("other@example.com", "professor");
    const res = await enrollIn("cs6300", idToken);
    expect(res.status).toBe(403);
    expect((await enrollments(uid).get()).empty).toBe(true);
  });

  it("returns 404 for a class that does not exist", async () => {
    const res = await enrollIn("missing", studentToken);
    expect(res.status).toBe(404);
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).empty).toBe(true);
  });

  // The core of PANEL-26: the student's own POST writes the roster doc — the
  // same doc an admin's approval writes — and the pending request for that
  // class goes with it, so the admin queue never asks for a decision that the
  // student already satisfied.
  it("enrolls the student directly: writes the roster doc and clears any pending request", async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ enrolled: true });

    // The roster doc is there, shaped like every other enrollment.
    const docs = await enrollments(studentUid).get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0].data()).toEqual({
      class_id: "cs6300",
      enrolledAt: expect.any(String),
    });

    // ...and the pending request for this class is gone from the user doc.
    expect(await requestedCourses(studentUid)).toEqual([]);

    // ...so the admin queue no longer asks for a decision on it.
    expect(await requestQueue(admin.idToken)).toEqual([]);

    // The class is enrolled (and not "requested") on the browse list...
    const available = await getAvailable(
      request("/api/classes/available", "GET", studentToken)
    );
    const { classes } = await available.json();
    expect(classes.find((c: { id: string }) => c.id === "cs6300")).toMatchObject({
      enrolled: true,
      requested: false,
    });

    // ...and it is in "My classes" right away.
    const mine = await getStudentClasses(
      request("/api/classes/student", "GET", studentToken)
    );
    expect((await mine.json()).classes.map((c: { id: string }) => c.id)).toEqual([
      "cs6300",
    ]);
  });

  // Idempotency, the property every version of this route has kept: a double
  // click cannot create two roster docs.
  it("a second POST reports alreadyEnrolled and does not duplicate the roster doc", async () => {
    await enrollIn("cs6300", studentToken);
    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  // (c) an enrolled student never gets a phantom pending entry.
  it("reports alreadyEnrolled for an enrolled student and creates no pending entry", async () => {
    await enrollments(studentUid).doc("cs6300").set({ class_id: "cs6300" });

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("reports alreadyEnrolled for an older auto-ID enrollment without queueing a request", async () => {
    await enrollments(studentUid).add({ class_id: "cs6300" });

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("enrolls into different classes side by side", async () => {
    await enrollIn("cs6300", studentToken);
    const res = await enrollIn("cs2420", studentToken);

    expect(res.status).toBe(201);
    const docs = await enrollments(studentUid).get();
    expect(docs.docs.map((doc) => doc.data().class_id).sort()).toEqual([
      "cs2420",
      "cs6300",
    ]);
  });

  // PANEL-26: a course the admin closed does not take self-enrollments, no
  // matter that it exists and the caller is a student.
  it("returns 403 for a class closed to enrollment and writes nothing", async () => {
    await getAdminDb()
      .collection("classes")
      .doc("cs6300")
      .set({ enrollmentOpen: false }, { merge: true });

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "This course is not open for enrollment.",
    });
    expect((await enrollments(studentUid).get()).empty).toBe(true);
    expect(await requestedCourses(studentUid)).toEqual([]);
  });

  it("enrolls into a class that explicitly stores enrollmentOpen: true", async () => {
    await getAdminDb()
      .collection("classes")
      .doc("cs6300")
      .set({ enrollmentOpen: true }, { merge: true });

    const res = await enrollIn("cs6300", studentToken);
    expect(res.status).toBe(201);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  // Closing a course must not break the idempotent reply: an enrolled
  // student's repeat click is still alreadyEnrolled, not an error.
  it("still answers alreadyEnrolled to an enrolled student after the course closes", async () => {
    await enrollIn("cs6300", studentToken);
    await getAdminDb()
      .collection("classes")
      .doc("cs6300")
      .set({ enrollmentOpen: false }, { merge: true });

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  // The transaction-level guard: the class doc is read inside the enroll
  // transaction, so a close that lands while a POST is in flight still wins.
  it("selfEnroll reports classClosed from inside the transaction", async () => {
    await getAdminDb()
      .collection("classes")
      .doc("cs6300")
      .set({ enrollmentOpen: false }, { merge: true });

    const outcome = await selfEnroll(studentUid, "cs6300");

    expect(outcome).toEqual({ kind: "classClosed" });
    expect((await enrollments(studentUid).get()).empty).toBe(true);
    expect(await requestedCourses(studentUid)).toEqual([]);
  });
});

describe("DELETE /api/classes/[classId]/enroll (withdraw an in-flight request)", () => {
  it("removes the pending request so the student can enroll again", async () => {
    await seedPendingRequest(studentUid, "cs6300", "2026-10-01T09:00:00.000Z");

    const res = await withdrawFrom("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await requestedCourses(studentUid)).toEqual([]);

    // The normal path is a self-enroll, so withdrawing an in-flight request
    // hands the row straight back to the Enroll button.
    const again = await enrollIn("cs6300", studentToken);
    expect(again.status).toBe(201);
    expect(await res.json()).toEqual({ withdrawn: true });
  });

  it("returns 404 when there is nothing to withdraw", async () => {
    const res = await withdrawFrom("cs6300", studentToken);
    expect(res.status).toBe(404);
  });

  it("never withdraws an enrollment through this path", async () => {
    await enrollments(studentUid).doc("cs6300").set({ class_id: "cs6300" });

    const res = await withdrawFrom("cs6300", studentToken);

    expect(res.status).toBe(409);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("returns 403 for a professor", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");
    const res = await withdrawFrom("cs6300", idToken);
    expect(res.status).toBe(403);
  });
});
