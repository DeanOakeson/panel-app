// PANEL-90: the course pages need a small endpoint that names the course.
// GET /api/classes/{classId} returns the course identity to the people who
// can open the course, and nothing to anyone else.

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/classes/[classId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const params = { params: Promise.resolve({ classId }) };

function request(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return new NextRequest(`http://localhost/api/classes/${classId}`, { headers });
}

let professorToken: string;
let professorUid: string;

beforeEach(async () => {
  await clearEmulators();

  const professor = await createSignedInUser("prof@example.com", "professor");
  professorToken = professor.idToken;
  professorUid = professor.uid;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({
      name: "Software Engineering",
      courseCode: "CS 3450",
      term: "Fall",
      year: 2026,
      section: "001",
      professor_id: professorUid,
      // Internal fields the endpoint must not hand out.
      enrollmentOpen: false,
    });
});

describe("GET /api/classes/[classId]", () => {
  it("returns 401 without a token", async () => {
    const res = await GET(request(), params);

    expect(res.status).toBe(401);
  });

  it("returns 404 for a class that does not exist", async () => {
    const missing = { params: Promise.resolve({ classId: "nope" }) };

    const res = await GET(request(professorToken), missing);

    expect(res.status).toBe(404);
  });

  it("returns 403 for a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await GET(request(idToken), params);

    expect(res.status).toBe(403);
  });

  it("returns 403 for a student who is not enrolled", async () => {
    const { idToken } = await createSignedInUser("outsider@example.com", "student");

    const res = await GET(request(idToken), params);

    expect(res.status).toBe(403);
  });

  it("returns the course identity to the teaching professor", async () => {
    const res = await GET(request(professorToken), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      class: {
        id: classId,
        name: "Software Engineering",
        courseCode: "CS 3450",
        term: "Fall",
        year: 2026,
        section: "001",
      },
    });
  });

  it("returns the course identity to an enrolled student", async () => {
    const student = await createSignedInUser("enrolled@example.com", "student");
    await getAdminDb()
      .collection("users")
      .doc(student.uid)
      .collection("classes")
      .add({ class_id: classId });

    const res = await GET(request(student.idToken), params);

    expect(res.status).toBe(200);
    expect((await res.json()).class.name).toBe("Software Engineering");
  });

  it("returns the course identity to an admin", async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");

    const res = await GET(request(admin.idToken), params);

    expect(res.status).toBe(200);
    expect((await res.json()).class.courseCode).toBe("CS 3450");
  });

  it("never leaks the professor id or enrollment settings", async () => {
    const res = await GET(request(professorToken), params);
    const { class: course } = await res.json();

    expect(course).not.toHaveProperty("professorId");
    expect(course).not.toHaveProperty("professor_id");
    expect(course).not.toHaveProperty("enrollmentOpen");
  });
});
