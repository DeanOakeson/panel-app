import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH, DELETE } from "@/app/api/admin/classes/[classId]/route";
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

describe("PATCH /api/admin/classes/[classId]", () => {
  function patchRequest(body: unknown, idToken?: string) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (idToken) headers.authorization = `Bearer ${idToken}`;
    return new NextRequest(`http://localhost/api/admin/classes/${classId}`, {
      method: "PATCH",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function classDoc() {
    const snap = await getAdminDb().collection("classes").doc(classId).get();
    return snap.data() ?? {};
  }

  /** The class ids a professor is assigned to, same query the professor
   *  dashboard uses (`GET /api/classes/professor`). */
  async function professorClassIds(uid: string) {
    const snap = await getAdminDb()
      .collection("classes")
      .where("professor_id", "==", uid)
      .get();
    return snap.docs.map((doc) => doc.id);
  }

  it("returns 401 without a token", async () => {
    await seedClass();
    const res = await PATCH(patchRequest({ name: "Renamed" }), classParams);
    expect(res.status).toBe(401);
    expect((await classDoc()).name).toBe("Software Engineering");
  });

  it("returns 401 for a token the Auth emulator did not issue", async () => {
    await seedClass();
    const res = await PATCH(
      patchRequest({ name: "Renamed" }, "not-a-real-token"),
      classParams
    );
    expect(res.status).toBe(401);
    expect((await classDoc()).name).toBe("Software Engineering");
  });

  it.each(["student", "professor"])(
    "returns 403 for a signed-in %s",
    async (role) => {
      await seedClass();
      const { idToken } = await createSignedInUser(
        `${role}-other@example.com`,
        role
      );
      const res = await PATCH(patchRequest({ name: "Renamed" }, idToken), classParams);
      expect(res.status).toBe(403);
      expect((await classDoc()).name).toBe("Software Engineering");
    }
  );

  it("returns 404 for an unknown class", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await PATCH(patchRequest({ name: "Renamed" }, idToken), classParams);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a body that is not JSON", async () => {
    await seedClass();
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    const res = await PATCH(patchRequest("{not json", idToken), classParams);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a term outside Spring, Summer, Fall, Winter", async () => {
    await seedClass();
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    for (const term of ["Springhike", "spring", "Quarters", ""]) {
      const res = await PATCH(patchRequest({ term }, idToken), classParams);
      expect(res.status).toBe(400);
    }
    expect((await classDoc()).term).toBe("Fall");
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a missing course code", { courseCode: "" }],
    ["a blank section", { section: "  " }],
    ["a non-numeric year", { year: "next year" }],
    ["a year out of range", { year: 1999 }],
    ["an unknown professor", { professorId: "ghost" }],
    ["an empty body", {}],
  ])("returns 400 for %s", async (_label, payload) => {
    const professor = await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");

    const res = await PATCH(patchRequest(payload, admin.idToken), classParams);

    expect(res.status).toBe(400);
    expect(await classDoc()).toMatchObject({
      name: "Software Engineering",
      courseCode: "CS 6300",
      section: "001",
      term: "Fall",
      professor_id: professor.uid,
    });
  });

  it("returns 400 when the new professor is not actually a professor", async () => {
    const professor = await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const student = await seedStudent();

    const res = await PATCH(
      patchRequest({ professorId: student.uid }, admin.idToken),
      classParams
    );

    expect(res.status).toBe(400);
    expect((await classDoc()).professor_id).toBe(professor.uid);
  });

  it("rejects an invalid field even when a valid one is present", async () => {
    const professor = await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");

    const res = await PATCH(
      patchRequest({ name: "Good name", term: "Semester" }, admin.idToken),
      classParams
    );

    expect(res.status).toBe(400);
    const stored = await classDoc();
    expect(stored.name).toBe("Software Engineering");
    expect(stored.term).toBe("Fall");
    expect(stored.professor_id).toBe(professor.uid);
  });

  it("updates every editable field and the class reads back changed", async () => {
    await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const nextProfessor = await createSignedInUser("new@example.com", "professor");

    const res = await PATCH(
      patchRequest(
        {
          name: "Distributed Systems",
          courseCode: "CS 6340",
          year: 2027,
          term: "Spring",
          section: "002",
          professorId: nextProfessor.uid,
        },
        admin.idToken
      ),
      classParams
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.class).toMatchObject({
      id: classId,
      name: "Distributed Systems",
      courseCode: "CS 6340",
      year: 2027,
      term: "Spring",
      section: "002",
      professor_id: nextProfessor.uid,
    });

    // Read back through the same GET the detail page uses.
    const readBack = await GET(
      classRequest("GET", admin.idToken),
      classParams
    );
    expect(readBack.status).toBe(200);
    const page = await readBack.json();
    expect(page.class).toMatchObject({
      name: "Distributed Systems",
      courseCode: "CS 6340",
      year: 2027,
      term: "Spring",
      section: "002",
      professor_id: nextProfessor.uid,
    });
    expect(page.professor).toMatchObject({ uid: nextProfessor.uid });
  });

  it("moves the class off the old professor's list when reassigning", async () => {
    const oldProfessor = await seedClass();
    const admin = await createSignedInUser("admin@example.com", "admin");
    const nextProfessor = await createSignedInUser("new@example.com", "professor");

    expect(await professorClassIds(oldProfessor.uid)).toEqual([classId]);

    const res = await PATCH(
      patchRequest({ professorId: nextProfessor.uid }, admin.idToken),
      classParams
    );

    expect(res.status).toBe(200);
    expect(await professorClassIds(oldProfessor.uid)).toEqual([]);
    expect(await professorClassIds(nextProfessor.uid)).toEqual([classId]);
  });

  it("leaves fields that were not sent untouched", async () => {
    const professor = await seedClass();
    await seedEnrollment((await seedStudent()).uid);
    const admin = await createSignedInUser("admin@example.com", "admin");

    const res = await PATCH(
      patchRequest({ section: "007" }, admin.idToken),
      classParams
    );

    expect(res.status).toBe(200);
    expect(await classDoc()).toMatchObject({
      name: "Software Engineering",
      courseCode: "CS 6300",
      term: "Fall",
      section: "007",
      professor_id: professor.uid,
    });
    expect((await res.json()).class.section).toBe("007");
  });

  it("keeps the roster intact across an edit", async () => {
    await seedClass();
    const student = await seedStudent();
    await seedEnrollment(student.uid);
    const admin = await createSignedInUser("admin@example.com", "admin");

    const res = await PATCH(
      patchRequest({ name: "Renamed Course" }, admin.idToken),
      classParams
    );

    expect(res.status).toBe(200);
    const readBack = await GET(classRequest("GET", admin.idToken), classParams);
    const page = await readBack.json();
    expect(page.roster).toHaveLength(1);
    expect(page.roster[0]).toMatchObject({ uid: student.uid });
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