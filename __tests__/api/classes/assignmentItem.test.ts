import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  DELETE,
  PATCH,
} from "@/app/api/classes/[classId]/assignments/[assignmentId]/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";
const assignmentId = "assignment-1";

const original = {
  name: "Project 1",
  description: "Build it",
  points: 100,
  dueDate: "2026-11-01",
};

function assignmentDoc() {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

type Handler = (
  request: NextRequest,
  context: { params: Promise<{ classId: string; assignmentId: string }> }
) => Promise<Response>;

function call(
  handler: Handler,
  method: "PATCH" | "DELETE",
  idToken?: string,
  body?: unknown,
  ids = { classId, assignmentId }
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return handler(
    new NextRequest(
      `http://localhost/api/classes/${ids.classId}/assignments/${ids.assignmentId}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve(ids) }
  );
}

let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  const owner = await createSignedInUser("owner@example.com", "professor");
  ownerToken = owner.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: owner.uid });
  await assignmentDoc().set(original);
});

describe("PATCH /api/classes/[classId]/assignments/[assignmentId]", () => {
  it("returns 401 without a token", async () => {
    const res = await call(PATCH, "PATCH", undefined, { name: "New" });

    expect(res.status).toBe(401);
    expect((await assignmentDoc().get()).data()?.name).toBe(original.name);
  });

  it("returns 403 for a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await call(PATCH, "PATCH", idToken, { name: "Hijacked" });

    expect(res.status).toBe(403);
    expect((await assignmentDoc().get()).data()?.name).toBe(original.name);
  });

  it("returns 403 for a student", async () => {
    const { idToken } = await createSignedInUser("student@example.com", "student");

    const res = await call(PATCH, "PATCH", idToken, { points: 1 });

    expect(res.status).toBe(403);
    expect((await assignmentDoc().get()).data()?.points).toBe(original.points);
  });

  it("lets the class's professor update fields", async () => {
    const res = await call(PATCH, "PATCH", ownerToken, {
      name: "Project 1 (revised)",
      points: 120,
      dueDate: "",
    });

    expect(res.status).toBe(200);
    const saved = (await assignmentDoc().get()).data();
    expect(saved).toMatchObject({
      name: "Project 1 (revised)",
      points: 120,
      dueDate: null,
      description: original.description,
    });
    expect(saved?.updatedAt).toEqual(expect.any(String));
  });

  it.each([
    { label: "an empty name", body: { name: "" } },
    { label: "zero points", body: { points: 0 } },
    { label: "negative points", body: { points: -5 } },
    { label: "a badly formatted due date", body: { dueDate: "11/01/2026" } },
    { label: "no fields", body: {} },
  ])("returns 400 for $label", async ({ body }) => {
    const res = await call(PATCH, "PATCH", ownerToken, body);

    expect(res.status).toBe(400);
    expect((await assignmentDoc().get()).data()).toMatchObject(original);
  });

  it("returns 404 for a class that does not exist", async () => {
    const res = await call(PATCH, "PATCH", ownerToken, { name: "X" }, {
      classId: "missing-class",
      assignmentId,
    });

    expect(res.status).toBe(404);
  });

  it("leaves fields that were not sent unchanged", async () => {
    const res = await call(PATCH, "PATCH", ownerToken, { points: 80 });

    expect(res.status).toBe(200);
    expect((await assignmentDoc().get()).data()).toMatchObject({
      ...original,
      points: 80,
    });
  });

  it("returns 404 for an assignment that does not exist", async () => {
    const res = await call(PATCH, "PATCH", ownerToken, { name: "X" }, {
      classId,
      assignmentId: "missing",
    });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/classes/[classId]/assignments/[assignmentId]", () => {
  it("returns 401 without a token", async () => {
    const res = await call(DELETE, "DELETE");

    expect(res.status).toBe(401);
    expect((await assignmentDoc().get()).exists).toBe(true);
  });

  it("returns 404 for a class that does not exist", async () => {
    const res = await call(DELETE, "DELETE", ownerToken, undefined, {
      classId: "missing-class",
      assignmentId,
    });

    expect(res.status).toBe(404);
    expect((await assignmentDoc().get()).exists).toBe(true);
  });

  it("returns 403 for a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser("other@example.com", "professor");

    const res = await call(DELETE, "DELETE", idToken);

    expect(res.status).toBe(403);
    expect((await assignmentDoc().get()).exists).toBe(true);
  });

  it("returns 403 for a student", async () => {
    const { idToken } = await createSignedInUser("student@example.com", "student");

    const res = await call(DELETE, "DELETE", idToken);

    expect(res.status).toBe(403);
    expect((await assignmentDoc().get()).exists).toBe(true);
  });

  it("lets the class's professor delete the assignment", async () => {
    const res = await call(DELETE, "DELETE", ownerToken);

    expect(res.status).toBe(200);
    expect((await assignmentDoc().get()).exists).toBe(false);
  });

  it("returns 404 for an assignment that does not exist", async () => {
    const res = await call(DELETE, "DELETE", ownerToken, undefined, {
      classId,
      assignmentId: "missing",
    });

    expect(res.status).toBe(404);
  });
});
