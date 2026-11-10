import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/classes/[classId]/assignments/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const classId = "class-1";

function assignmentDoc(assignmentId: string) {
  return getAdminDb()
    .collection("classes")
    .doc(classId)
    .collection("assignments")
    .doc(assignmentId);
}

async function listAssignments(idToken?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const res = await GET(
    new NextRequest(`http://localhost/api/classes/${classId}/assignments`, {
      headers,
    }),
    { params: Promise.resolve({ classId }) },
  );

  if (!res) {
    throw new Error("Assignments GET route returned no response.");
  }

  return res;
}

/** Stores a student's profile and enrolls them in a class. */
async function enrollStudent(uid: string, toClass = classId) {
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .set({ name: uid, email: `${uid}@example.com`, role: "student" });
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .doc(toClass)
    .set({ class_id: toClass });
}

/** Stores a submission, and a grade for `gradedVersion` when one is given. */
async function addWork(
  assignmentId: string,
  studentUid: string,
  submittedAt: string,
  gradedVersion?: string,
) {
  await assignmentDoc(assignmentId)
    .collection("submissions")
    .doc(studentUid)
    .set({
      studentId: studentUid,
      filePath: `${classId}/${assignmentId}/${studentUid}/1-work.pdf`,
      fileName: "work.pdf",
      submittedAt,
      status: "submitted",
    });

  if (gradedVersion) {
    await assignmentDoc(assignmentId).collection("grades").doc(studentUid).set({
      score: 80,
      feedback: "",
      submittedAt: gradedVersion,
      gradedBy: "owner",
      gradedAt: "2026-11-02T09:00:00.000Z",
    });
  }
}

/** Stores a missing-work grade for a student. */
async function addMissingGrade(assignmentId: string, studentUid: string) {
  await assignmentDoc(assignmentId).collection("grades").doc(studentUid).set({
    studentId: studentUid,
    classId,
    assignmentId,
    score: 0,
    feedback: "",
    submittedAt: null,
    gradedBy: "owner",
    gradedAt: "2026-11-02T09:00:00.000Z",
  });
}

const firstVersion = "2026-10-30T12:00:00.000Z";
const secondVersion = "2026-10-31T12:00:00.000Z";

let ownerToken: string;

beforeEach(async () => {
  await clearEmulators();

  const owner = await createSignedInUser("owner@example.com", "professor");
  ownerToken = owner.idToken;

  await getAdminDb()
    .collection("classes")
    .doc(classId)
    .set({ name: "CS 6300", professor_id: owner.uid });

  await assignmentDoc("graded-work").set({
    name: "Project 1",
    points: 100,
    dueDate: "2026-10-31",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  await assignmentDoc("no-work").set({
    name: "Project 2",
    points: 100,
    dueDate: "2026-11-30",
    createdAt: "2026-10-02T00:00:00.000Z",
  });

  for (const uid of ["graded", "resubmitted", "ungraded", "absent"]) {
    await enrollStudent(uid);
  }
  await enrollStudent("other-class", "class-2");

  await addWork("graded-work", "graded", firstVersion, firstVersion);
  await addWork("graded-work", "resubmitted", secondVersion, firstVersion);
  await addWork("graded-work", "ungraded", firstVersion);
});

describe("GET /api/classes/[classId]/assignments closing times", () => {
  it("returns when submissions close for each due date", async () => {
    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(
      assignments.map((assignment: { id: string; closesAt: unknown }) => [
        assignment.id,
        assignment.closesAt,
      ]),
    ).toEqual([
      ["no-work", "2026-12-01T06:59:59.999Z"],
      ["graded-work", "2026-11-01T05:59:59.999Z"],
    ]);
  });

  it("returns the closing time to an enrolled student", async () => {
    const { uid, idToken } = await createSignedInUser(
      "student@example.com",
      "student",
    );
    await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection("classes")
      .add({ class_id: classId });

    const res = await listAssignments(idToken);

    expect(res.status).toBe(200);
    expect((await res.json()).assignments[1].closesAt).toBe(
      "2026-11-01T05:59:59.999Z",
    );
  });

  it("returns a null closing time for a missing or malformed due date", async () => {
    await assignmentDoc("no-work").update({ dueDate: null });
    await assignmentDoc("graded-work").update({ dueDate: "2026-02-30" });

    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(
      assignments.map(
        (assignment: { closesAt: unknown }) => assignment.closesAt,
      ),
    ).toEqual([null, null]);
  });
});

describe("GET /api/classes/[classId]/assignments grading counts", () => {
  it("gives the class's professor each assignment's grading counts", async () => {
    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(
      assignments.map((assignment: { id: string; grading: unknown }) => [
        assignment.id,
        assignment.grading,
      ]),
    ).toEqual([
      [
        "no-work",
        {
          students: 4,
          submitted: 0,
          toGrade: 0,
          resubmitted: 0,
          afterMissingGrade: 0,
          graded: 0,
          missing: 4,
          missingGraded: 0,
        },
      ],
      [
        "graded-work",
        {
          students: 4,
          submitted: 3,
          toGrade: 2,
          resubmitted: 1,
          afterMissingGrade: 0,
          graded: 1,
          missing: 1,
          missingGraded: 0,
        },
      ],
    ]);
  });

  it("counts a student who submitted but is not enrolled", async () => {
    await addWork("graded-work", "dropped", firstVersion);

    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(assignments[1].grading).toEqual({
      students: 5,
      submitted: 4,
      toGrade: 3,
      resubmitted: 1,
      afterMissingGrade: 0,
      graded: 1,
      missing: 1,
      missingGraded: 0,
    });
  });

  it("counts missing-work grades and submissions that arrived after one", async () => {
    await addMissingGrade("graded-work", "absent");
    await addMissingGrade("graded-work", "ungraded");

    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(assignments[1].grading).toEqual({
      students: 4,
      submitted: 3,
      toGrade: 2,
      resubmitted: 1,
      afterMissingGrade: 1,
      graded: 1,
      missing: 1,
      missingGraded: 1,
    });
  });

  it("counts a student with a missing-work grade who is no longer enrolled", async () => {
    await addMissingGrade("graded-work", "dropped");

    const res = await listAssignments(ownerToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(assignments[1].grading).toMatchObject({
      students: 5,
      missing: 2,
      missingGraded: 1,
    });
  });

  it("gives an admin the grading counts", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await listAssignments(idToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(assignments[1].grading).toMatchObject({ submitted: 3, toGrade: 2 });
  });

  it("lists assignments for an enrolled student without grading counts", async () => {
    const { uid, idToken } = await createSignedInUser(
      "student@example.com",
      "student",
    );
    await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection("classes")
      .add({ class_id: classId });

    const res = await listAssignments(idToken);

    expect(res.status).toBe(200);
    const { assignments } = await res.json();
    expect(assignments).toHaveLength(2);
    for (const assignment of assignments) {
      expect(assignment).not.toHaveProperty("grading");
    }
  });

  it("returns 403 to a professor who does not teach the class", async () => {
    const { idToken } = await createSignedInUser(
      "other@example.com",
      "professor",
    );

    const res = await listAssignments(idToken);

    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("assignments");
  });

  it("returns 403 to a student who is not enrolled", async () => {
    const { idToken } = await createSignedInUser(
      "student@example.com",
      "student",
    );

    const res = await listAssignments(idToken);

    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("assignments");
  });

  it("returns 401 without a token", async () => {
    const res = await listAssignments();

    expect(res.status).toBe(401);
  });
});
