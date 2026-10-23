import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/classes/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const course = {
  name: "Software Engineering Leadership",
  courseCode: "CS 6300",
  year: 2026,
  term: "Fall",
  section: "001",
};

function postClass(body: unknown, idToken?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return POST(
    new NextRequest("http://localhost/api/classes", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

async function classCount() {
  return (await getAdminDb().collection("classes").get()).size;
}

beforeEach(clearEmulators);

describe("POST /api/classes", () => {
  it("returns 401 without a token", async () => {
    const res = await postClass(course);

    expect(res.status).toBe(401);
    expect(await classCount()).toBe(0);
  });

  it("returns 403 for a student", async () => {
    const { idToken } = await createSignedInUser("student@example.com", "student");

    const res = await postClass(course, idToken);

    expect(res.status).toBe(403);
    expect(await classCount()).toBe(0);
  });

  describe("as an admin", () => {
    let adminToken: string;
    let adminUid: string;
    let professorUid: string;

    beforeEach(async () => {
      ({ idToken: adminToken, uid: adminUid } = await createSignedInUser(
        "admin@example.com",
        "admin"
      ));
      ({ uid: professorUid } = await createSignedInUser("prof@example.com", "professor"));
    });

    it("creates a class taught by the chosen professor", async () => {
      const res = await postClass({ ...course, professorId: professorUid }, adminToken);

      expect(res.status).toBe(201);
      const saved = (await getAdminDb().collection("classes").get()).docs.at(0)?.data();
      expect(saved).toMatchObject({
        ...course,
        professor_id: professorUid,
        createdBy: adminUid,
      });
    });

    it("returns 400 when no professor is chosen", async () => {
      const res = await postClass(course, adminToken);

      expect(res.status).toBe(400);
      expect(await classCount()).toBe(0);
    });

    it("returns 400 when the chosen user is not a professor", async () => {
      const { uid: studentUid } = await createSignedInUser("s@example.com", "student");

      const res = await postClass({ ...course, professorId: studentUid }, adminToken);

      expect(res.status).toBe(400);
      expect(await classCount()).toBe(0);
    });

    it("returns 400 when the chosen professor does not exist", async () => {
      const res = await postClass({ ...course, professorId: "no-such-user" }, adminToken);

      expect(res.status).toBe(400);
      expect(await classCount()).toBe(0);
    });
  });

  describe("as a professor", () => {
    it("creates a class taught by that professor, ignoring professorId", async () => {
      const { idToken, uid } = await createSignedInUser("prof@example.com", "professor");
      const { uid: otherUid } = await createSignedInUser("other@example.com", "professor");

      const res = await postClass({ ...course, professorId: otherUid }, idToken);

      expect(res.status).toBe(201);
      const saved = (await getAdminDb().collection("classes").get()).docs.at(0)?.data();
      expect(saved?.professor_id).toBe(uid);
    });
  });
});
