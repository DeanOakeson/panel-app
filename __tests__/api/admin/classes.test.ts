import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, DELETE } from "@/app/api/admin/classes/[classId]/route";
import { POST } from "@/app/api/admin/classes/[classId]/enrollments/route";
import { DELETE as UNENROLL } from "@/app/api/admin/classes/[classId]/enrollments/[studentId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const classParams = { params: Promise.resolve({ classId }) };

function paramsFor(studentId: string) {
  return { params: Promise.resolve({ classId, studentId }) };
}

function classRequest(method: "GET" | "DELETE", idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(`http://localhost/api/admin/classes/${classId}`, {
    method,
    headers,
  });
}

function enrollRequest(idToken: string | undefined, body?: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(
    `http://localhost/api/admin/classes/${classId}/enrollments`,
    {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

function unenrollRequest(idToken: string | undefined, studentId: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return new NextRequest(
    `http://localhost/api/admin/classes/${classId}/enrollments/${studentId}`,
    { method: "DELETE", headers }
  );
}

/** Creates the class under test with a named professor. */
async function seedClass() {
  const professor = await createSignedInUser("prof@example.com", "professor");
  await getAdminDb()
    .collection("users")
    .doc(professor.uid)
    .set({ name: "Prof. Puddle" }, { merge: true });
  await getAdminDb().collection("classes").doc(classId).set({
    name: "Software Engineering",
    courseCode: "CS 6300",
    year: "2026",
    term: "Fall",
    section: "001",
    professor_id: professor.uid,
  });
  return professor;
}

async function seedStudent(name = "Sam Student") {
  const student = await createSignedInUser("sam@example.com", "student");
  await getAdminDb()
    .collection("users")
    .doc(student.uid)
    .set({ name }, { merge: true });
  return student;
}

async function seedEnrollment(studentUid: string) {
  await getAdminDb()
    .collection("users")
    .doc(studentUid)
    .collection("classes")
    .doc(classId)
    .set({ class_id: classId });
}

beforeEach(clearEmulators);

describe("GET /api/admin/classes/[classId]", () => {
  it("returns 401 without a token", async () => {
    const res = await GET(classRequest("GET"), classParams);
    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])(
    "returns 403 for a %s",
    async (role) => {
      const { idToken } = await createSignedInUser(`${role}@example.com`, role);
      const res = await GET(classRequest("GET", idToken), classParams);
      expect(res.status).toBe(403);
    }
  );

  it("returns 404 for an unknown class", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await GET(classRequest("GET", idToken), classParams);
    expect(res.status).toBe(404);
  });

  it("returns the class, its professor, and the roster", async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");
    const professor = await seedClass();
    const student = await seedStudent();
    await seedEnrollment(student.uid);

    const res = await GET(classRequest("GET", admin.idToken), classParams);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.class).toMatchObject({
      id: classId,
      name: "Software Engineering",
      courseCode: "CS 6300",
      professor_id: professor.uid,
    });
    expect(data.professor).toMatchObject({
      uid: professor.uid,
      name: "Prof. Puddle",
    });
    expect(data.roster).toHaveLength(1);
    expect(data.roster.at(0)).toMatchObject({
      uid: student.uid,
      name: "Sam Student",
    });
  });
});

describe("DELETE /api/admin/classes/[classId]", () => {
  it("returns 403 for a non-admin", async () => {
    await seedClass();
    const { idToken } = await createSignedInUser(
      "other@example.com",
      "professor"
    );
    const res = await DELETE(classRequest("DELETE", idToken), classParams);
    expect(res.status).toBe(403);
    expect(
      (await getAdminDb().collection("classes").doc(classId).get()).exists
    ).toBe(true);
  });

  it("returns 404 for an unknown class", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await DELETE(classRequest("DELETE", idToken), classParams);
    expect(res.status).toBe(404);
  });

  it("deletes the class, enrollments, and its subcollections", async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");
    await seedClass();
    const student = await seedStudent();
    await seedEnrollment(student.uid);

    const assignmentRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .doc("a1");
    await assignmentRef.set({ title: "Project 1" });
    await assignmentRef
      .collection("submissions")
      .doc(student.uid)
      .set({ submittedAt: Date.now() });
    const materialRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .doc("m1");
    await materialRef.set({ title: "Syllabus", url: "https://example.com/syllabus" });

    const res = await DELETE(classRequest("DELETE", admin.idToken), classParams);

    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({
      deleted: true,
      classId,
      studentsRemoved: 1,
    });
    expect(
      (await getAdminDb().collection("classes").doc(classId).get()).exists
    ).toBe(false);
    expect(
      (
        await getAdminDb()
          .collection("users")
          .doc(student.uid)
          .collection("classes")
          .doc(classId)
          .get()
      ).exists
    ).toBe(false);
    expect((await assignmentRef.get()).exists).toBe(false);
    expect(
      (await assignmentRef.collection("submissions").doc(student.uid).get())
        .exists
    ).toBe(false);
    expect((await materialRef.get()).exists).toBe(false);
  });
});

describe("POST /api/admin/classes/[classId]/enrollments", () => {
  it("returns 401 without a token", async () => {
    const res = await POST(enrollRequest(undefined, { studentId: "s1" }), classParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a student", async () => {
    const { idToken } = await createSignedInUser("sam@example.com", "student");
    const res = await POST(
      enrollRequest(idToken, { studentId: "s1" }),
      classParams
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown class", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await POST(
      enrollRequest(idToken, { studentId: "s1" }),
      classParams
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 without a studentId", async () => {
    await seedClass();
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await POST(enrollRequest(idToken, {}), classParams);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown student", async () => {
    await seedClass();
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await POST(
      enrollRequest(idToken, { studentId: "ghost" }),
      classParams
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when enrolling a professor", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const professor = await createSignedInUser("other@example.com", "professor");
    const res = await POST(
      enrollRequest(admin.idToken, { studentId: professor.uid }),
      classParams
    );
    expect(res.status).toBe(400);
  });

  it("enrolls a student", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const student = await seedStudent();

    const res = await POST(
      enrollRequest(admin.idToken, { studentId: student.uid }),
      classParams
    );

    expect(res.status).toBe(201);
    const enrollment = await getAdminDb()
      .collection("users")
      .doc(student.uid)
      .collection("classes")
      .doc(classId)
      .get();
    expect(enrollment.exists).toBe(true);
    expect(enrollment.data()?.class_id).toBe(classId);
  });

  it("returns 409 when the student is already enrolled", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const student = await seedStudent();
    await seedEnrollment(student.uid);

    const res = await POST(
      enrollRequest(admin.idToken, { studentId: student.uid }),
      classParams
    );
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/admin/classes/[classId]/enrollments/[studentId]", () => {
  it("returns 403 for a non-admin", async () => {
    const { idToken } = await createSignedInUser("prof@example.com", "professor");
    const res = await UNENROLL(
      unenrollRequest(idToken, "sam-uid"),
      paramsFor("sam-uid")
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown class", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await UNENROLL(
      unenrollRequest(idToken, "sam-uid"),
      paramsFor("sam-uid")
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the student is not enrolled", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const student = await seedStudent();

    const res = await UNENROLL(
      unenrollRequest(admin.idToken, student.uid),
      paramsFor(student.uid)
    );
    expect(res.status).toBe(404);
  });

  it("removes the enrollment", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const student = await seedStudent();
    await seedEnrollment(student.uid);

    const res = await UNENROLL(
      unenrollRequest(admin.idToken, student.uid),
      paramsFor(student.uid)
    );

    expect(res.status).toBe(200);
    expect(
      (
        await getAdminDb()
          .collection("users")
          .doc(student.uid)
          .collection("classes")
          .doc(classId)
          .get()
      ).exists
    ).toBe(false);
  });
});