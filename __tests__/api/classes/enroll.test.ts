import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAvailable } from "@/app/api/classes/available/route";
import { POST as enroll } from "@/app/api/classes/[classId]/enroll/route";
import { GET as getStudentClasses } from "@/app/api/classes/student/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function request(path: string, method: string, idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function enrollIn(classId: string, idToken?: string) {
  return enroll(request(`/api/classes/${classId}/enroll`, "POST", idToken), {
    params: Promise.resolve({ classId }),
  });
}

function enrollments(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("classes");
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
});

describe("POST /api/classes/[classId]/enroll", () => {
  it("returns 401 without a token", async () => {
    const res = await enrollIn("cs6300");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a professor", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");
    const res = await enrollIn("cs6300", idToken);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a class that does not exist", async () => {
    const res = await enrollIn("missing", studentToken);
    expect(res.status).toBe(404);
    expect((await enrollments(studentUid).get()).empty).toBe(true);
  });

  it("enrolls the student, and the class then shows up in their classes", async () => {
    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: false });

    const saved = (await enrollments(studentUid).doc("cs6300").get()).data();
    expect(saved).toMatchObject({ class_id: "cs6300", enrolledAt: expect.any(String) });

    const mine = await getStudentClasses(request("/api/classes/student", "GET", studentToken));
    const { classes } = await mine.json();
    expect(classes.map((c: { id: string }) => c.id)).toEqual(["cs6300"]);
  });

  it("does not add a second enrollment when called twice", async () => {
    await enrollIn("cs6300", studentToken);
    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrolled: true, alreadyEnrolled: true });
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });

  it("does not add a duplicate for an older auto-ID enrollment", async () => {
    await enrollments(studentUid).add({ class_id: "cs6300" });

    const res = await enrollIn("cs6300", studentToken);

    expect(res.status).toBe(200);
    expect((await enrollments(studentUid).get()).size).toBe(1);
  });
});
