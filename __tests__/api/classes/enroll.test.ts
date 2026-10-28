import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAvailable } from "@/app/api/classes/available/route";
import {
  POST as requestCourse,
  DELETE as withdrawRequest,
} from "@/app/api/classes/[classId]/enroll/route";
import { GET as getStudentClasses } from "@/app/api/classes/student/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function request(path: string, method: string, idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function requestCourseIn(classId: string, idToken?: string) {
  return requestCourse(request(`/api/classes/${classId}/enroll`, "POST", idToken), {
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

  it("marks a pending request as requested, and NOT as enrolled", async () => {
    await requestCourseIn("cs6300", studentToken);

    const res = await getAvailable(request("/api/classes/available", "GET", studentToken));
    const { classes } = await res.json();
    const cs6300 = classes.find((c: { id: string }) => c.id === "cs6300");

    expect(cs6300.requested).toBe(true);
    expect(cs6300.enrolled).toBe(false);
    expect(classes.find((c: { id: string }) => c.id === "cs2420").requested).toBe(false);
  });
});

describe("POST /api/classes/[classId]/enroll (course request)", () => {
  it("returns 401 without a token", async () => {
    const res = await requestCourseIn("cs6300");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a professor", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");
    const res = await requestCourseIn("cs6300", idToken);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a class that does not exist", async () => {
    const res = await requestCourseIn("missing", studentToken);
    expect(res.status).toBe(404);
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).empty).toBe(true);
  });

  // (a) the core of END-54: asking is not enrolling.
  it("creates a pending request and does NOT create the enrollment doc", async () => {
    const res = await requestCourseIn("cs6300", studentToken);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ requested: true });

    const pending = await requestedCourses(studentUid);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ classId: "cs6300", status: "pending" });
    expect(typeof pending[0].requestedAt).toBe("string");

    // The roster is untouched until an admin approves.
    expect((await enrollments(studentUid).get()).empty).toBe(true);

    // ...so the class is not in "My classes" either.
    const mine = await getStudentClasses(request("/api/classes/student", "GET", studentToken));
    const { classes } = await mine.json();
    expect(classes).toEqual([]);
  });

  // (b) idempotency, the property the old enroll route had and the request
  // route must keep: a double click queues one decision, not two.
  it("does not add a second request when called twice", async () => {
    await requestCourseIn("cs6300", studentToken);
    const res = await requestCourseIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true, alreadyRequested: true });

    const pending = await requestedCourses(studentUid);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ classId: "cs6300", status: "pending" });
    expect((await enrollments(studentUid).get()).empty).toBe(true);
  });

  // (c) an enrolled student never gets a phantom pending entry.
  it("reports alreadyEnrolled for an enrolled student and creates no pending entry", async () => {
    await enrollments(studentUid).doc("cs6300").set({ class_id: "cs6300" });

    const res = await requestCourseIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("reports alreadyEnrolled for an older auto-ID enrollment without queueing a request", async () => {
    await enrollments(studentUid).add({ class_id: "cs6300" });

    const res = await requestCourseIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect(await requestedCourses(studentUid)).toEqual([]);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("keeps requests for different classes side by side", async () => {
    await requestCourseIn("cs6300", studentToken);
    const res = await requestCourseIn("cs2420", studentToken);

    expect(res.status).toBe(201);
    const pending = await requestedCourses(studentUid);
    expect(pending.map((entry) => entry.classId).sort()).toEqual(["cs2420", "cs6300"]);
  });
});

describe("DELETE /api/classes/[classId]/enroll (withdraw a request)", () => {
  it("removes the pending request so the student can ask again", async () => {
    await requestCourseIn("cs6300", studentToken);

    const res = await withdrawFrom("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await requestedCourses(studentUid)).toEqual([]);

    const again = await requestCourseIn("cs6300", studentToken);
    expect(again.status).toBe(201);
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
