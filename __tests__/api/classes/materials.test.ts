import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/classes/[classId]/materials/route";
import { DELETE } from "@/app/api/classes/[classId]/materials/[materialId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const validBody = {
  title: "Syllabus",
  url: "https://drive.google.com/file/d/abc/view",
  description: "Read before week 1",
};

function request(method: string, idToken?: string, body?: unknown, path = "") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return new NextRequest(`http://localhost/api/classes/${classId}/materials${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const classParams = { params: Promise.resolve({ classId }) };

function materials() {
  return getAdminDb().collection("classes").doc(classId).collection("materials");
}

let professorToken: string;

beforeEach(async () => {
  await clearEmulators();

  const professor = await createSignedInUser("prof@example.com", "professor");
  professorToken = professor.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: professor.uid });
});

async function enrolledStudentToken() {
  const student = await createSignedInUser("enrolled@example.com", "student");
  await getAdminDb()
    .collection("users")
    .doc(student.uid)
    .collection("classes")
    .add({ class_id: classId });
  return student.idToken;
}

describe("POST /api/classes/[classId]/materials", () => {
  it("returns 401 without a token", async () => {
    const res = await POST(request("POST", undefined, validBody), classParams);

    expect(res.status).toBe(401);
    expect((await materials().get()).empty).toBe(true);
  });

  it("returns 403 for a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await POST(request("POST", idToken, validBody), classParams);

    expect(res.status).toBe(403);
    expect((await materials().get()).empty).toBe(true);
  });

  it("returns 403 for an enrolled student", async () => {
    const res = await POST(
      request("POST", await enrolledStudentToken(), validBody),
      classParams
    );

    expect(res.status).toBe(403);
    expect((await materials().get()).empty).toBe(true);
  });

  it("lets the class's professor add a link", async () => {
    const res = await POST(request("POST", professorToken, validBody), classParams);

    expect(res.status).toBe(201);
    const saved = await materials().get();
    expect(saved.size).toBe(1);
    expect(saved.docs.at(0)?.data()).toMatchObject(validBody);
  });

  it.each([
    { label: "an empty title", body: { ...validBody, title: "" } },
    { label: "a missing link", body: { ...validBody, url: "" } },
    { label: "a link without http(s)", body: { ...validBody, url: "drive.google.com/x" } },
    { label: "a javascript: link", body: { ...validBody, url: "javascript:alert(1)" } },
    { label: "a too-long description", body: { ...validBody, description: "x".repeat(1001) } },
  ])("returns 400 for $label", async ({ body }) => {
    const res = await POST(request("POST", professorToken, body), classParams);

    expect(res.status).toBe(400);
    expect((await materials().get()).empty).toBe(true);
  });
});

describe("GET /api/classes/[classId]/materials", () => {
  beforeEach(async () => {
    await materials().add({ ...validBody, createdAt: new Date().toISOString() });
  });

  it("lists materials for the class's professor", async () => {
    const res = await GET(request("GET", professorToken), classParams);

    expect(res.status).toBe(200);
    expect((await res.json()).materials).toHaveLength(1);
  });

  it("lists materials for an enrolled student", async () => {
    const res = await GET(request("GET", await enrolledStudentToken()), classParams);

    expect(res.status).toBe(200);
    expect((await res.json()).materials).toHaveLength(1);
  });

  it("returns 403 for a student who is not enrolled", async () => {
    const { idToken } = await createSignedInUser("outsider@example.com", "student");

    const res = await GET(request("GET", idToken), classParams);

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/classes/[classId]/materials/[materialId]", () => {
  let materialId: string;

  beforeEach(async () => {
    materialId = (await materials().add({ ...validBody, createdAt: new Date().toISOString() })).id;
  });

  function deleteParams(id = materialId) {
    return { params: Promise.resolve({ classId, materialId: id }) };
  }

  it("returns 403 for an enrolled student", async () => {
    const res = await DELETE(
      request("DELETE", await enrolledStudentToken(), undefined, `/${materialId}`),
      deleteParams()
    );

    expect(res.status).toBe(403);
    expect((await materials().doc(materialId).get()).exists).toBe(true);
  });

  it("lets the class's professor remove a material", async () => {
    const res = await DELETE(
      request("DELETE", professorToken, undefined, `/${materialId}`),
      deleteParams()
    );

    expect(res.status).toBe(200);
    expect((await materials().doc(materialId).get()).exists).toBe(false);
  });

  it("returns 404 for a material that does not exist", async () => {
    const res = await DELETE(
      request("DELETE", professorToken, undefined, "/missing"),
      deleteParams("missing")
    );

    expect(res.status).toBe(404);
  });
});
