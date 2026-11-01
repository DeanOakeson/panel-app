import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/classes/[classId]/materials/route";
import { DELETE } from "@/app/api/classes/[classId]/materials/[materialId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

// Only Supabase Storage is stubbed; Firebase runs against the emulators.
const storage = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: storage.from } }),
}));

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

function formRequest(idToken: string | undefined, fields: Record<string, string>, file?: File) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  if (file) body.append("file", file);

  return new NextRequest(`http://localhost/api/classes/${classId}/materials`, {
    method: "POST",
    headers,
    body,
  });
}

function pdf(name = "syllabus.pdf", size = 2048, type = "application/pdf") {
  return new File([new Uint8Array(size)], name, { type });
}

function materials() {
  return getAdminDb().collection("classes").doc(classId).collection("materials");
}

let professorToken: string;

beforeEach(async () => {
  await clearEmulators();

  vi.clearAllMocks();
  storage.from.mockReturnValue(storage);
  storage.upload.mockResolvedValue({ data: {}, error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  storage.createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://storage.example/${path}?token=abc` },
    error: null,
  }));

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

  it("lets the professor add a material with no link", async () => {
    const res = await POST(
      request("POST", professorToken, { title: "Week 1 notes", description: "Read before class", url: "" }),
      classParams
    );

    expect(res.status).toBe(201);
    const saved = (await materials().get()).docs.at(0)?.data();
    expect(saved).toMatchObject({ title: "Week 1 notes", description: "Read before class", url: null });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("uploads an attached file and saves its details", async () => {
    const res = await POST(
      formRequest(professorToken, { title: "Syllabus", description: "Course policies" }, pdf()),
      classParams
    );

    expect(res.status).toBe(201);
    const { material } = await res.json();
    expect(material).toMatchObject({ fileName: "syllabus.pdf", fileSize: 2048, url: null });
    expect(material.filePath).toBeUndefined();

    expect(storage.from).toHaveBeenCalledWith("assignment-submissions");
    const [path, , options] = storage.upload.mock.calls[0];
    expect(path).toBe(`materials/${classId}/${material.id}/syllabus.pdf`);
    expect(options).toMatchObject({ contentType: "application/pdf", upsert: false });

    const saved = (await materials().doc(material.id).get()).data();
    expect(saved).toMatchObject({ filePath: path, fileName: "syllabus.pdf", fileType: "application/pdf" });
  });

  it.each([
    { label: "a file over 4 MB", file: pdf("big.pdf", 4 * 1024 * 1024 + 1) },
    { label: "a file type that isn't allowed", file: pdf("tool.exe", 100, "application/x-msdownload") },
  ])("returns 400 for $label without uploading", async ({ file }) => {
    const res = await POST(
      formRequest(professorToken, { title: "Syllabus", description: "Course policies" }, file),
      classParams
    );

    expect(res.status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    expect((await materials().get()).empty).toBe(true);
  });

  it("returns 500 and saves nothing when the upload fails", async () => {
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: "bucket offline" } });

    const res = await POST(
      formRequest(professorToken, { title: "Syllabus", description: "Course policies" }, pdf()),
      classParams
    );

    expect(res.status).toBe(500);
    expect((await materials().get()).empty).toBe(true);
  });

  it.each([
    { label: "an empty title", body: { ...validBody, title: "" } },
    { label: "a missing description", body: { ...validBody, description: "" } },
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

  it("lists materials for an admin", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await GET(request("GET", idToken), classParams);

    expect(res.status).toBe(200);
    expect((await res.json()).materials).toHaveLength(1);
  });

  it("returns a download link for an attached file without exposing its storage path", async () => {
    await materials().add({
      title: "Slides",
      description: "Week 2",
      url: null,
      filePath: "materials/class-1/m1/slides.pdf",
      fileName: "slides.pdf",
      fileSize: 1000,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });

    const res = await GET(request("GET", await enrolledStudentToken()), classParams);
    const { materials: list } = await res.json();
    const slides = list.find((m: { title: string }) => m.title === "Slides");

    expect(slides.fileUrl).toBe("https://storage.example/materials/class-1/m1/slides.pdf?token=abc");
    expect(slides.filePath).toBeUndefined();
    expect(list.find((m: { title: string }) => m.title === "Syllabus").fileUrl).toBeNull();
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

  it("returns 401 without a token", async () => {
    const res = await DELETE(
      request("DELETE", undefined, undefined, `/${materialId}`),
      deleteParams()
    );

    expect(res.status).toBe(401);
    expect((await materials().doc(materialId).get()).exists).toBe(true);
  });

  it("returns 403 for a professor who teaches a different class", async () => {
    const other = await createSignedInUser("other-prof@example.com", "professor");
    await getAdminDb()
      .collection("classes")
      .doc("class-2")
      .set({ name: "CS 6400", professor_id: other.uid });

    const res = await DELETE(
      request("DELETE", other.idToken, undefined, `/${materialId}`),
      deleteParams()
    );

    expect(res.status).toBe(403);
    expect((await materials().doc(materialId).get()).exists).toBe(true);
  });

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

  it("removes an attached file from storage too", async () => {
    const withFile = await materials().add({
      ...validBody,
      filePath: "materials/class-1/m2/notes.pdf",
      fileName: "notes.pdf",
      createdAt: new Date().toISOString(),
    });

    const res = await DELETE(
      request("DELETE", professorToken, undefined, `/${withFile.id}`),
      deleteParams(withFile.id)
    );

    expect(res.status).toBe(200);
    expect(storage.remove).toHaveBeenCalledWith(["materials/class-1/m2/notes.pdf"]);
    expect((await materials().doc(withFile.id).get()).exists).toBe(false);
  });

  it("returns 404 for a material that does not exist", async () => {
    const res = await DELETE(
      request("DELETE", professorToken, undefined, "/missing"),
      deleteParams("missing")
    );

    expect(res.status).toBe(404);
  });
});
