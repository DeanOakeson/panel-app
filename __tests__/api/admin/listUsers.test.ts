import { beforeEach, describe, expect, it } from "vitest";
import { GET as listUsersRoute } from "@/app/api/admin/users/route";
import { GET as listClassesRoute } from "@/app/api/admin/classes/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function listUsers(idToken?: string, role?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const query = role ? `?role=${role}` : "";

  return listUsersRoute(
    new Request(`http://localhost/api/admin/users${query}`, { headers })
  );
}

function listClasses(idToken: string) {
  return listClassesRoute(
    new Request("http://localhost/api/admin/classes", {
      headers: { authorization: `Bearer ${idToken}` },
    })
  );
}

type UserRow = {
  uid: string;
  name: string;
  email: string;
  role: string;
  courses: {
    id: string;
    name: string;
    courseCode: string;
    term: string;
    year: number | null;
    section: string;
  }[];
  teaching: {
    id: string;
    name: string;
    courseCode: string;
    term: string;
    year: number | null;
    section: string;
    students: { uid: string; name: string; email: string }[];
  }[];
};

async function userRows(res: Response) {
  const body = (await res.json()) as { users: UserRow[] };
  return body.users;
}

beforeEach(clearEmulators);

describe("GET /api/admin/users", () => {
  it("returns 401 without a token", async () => {
    const res = await listUsers();

    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])(`returns 403 for a %s`, async (role) => {
    const { idToken } = await createSignedInUser(`${role}@example.com`, role);

    const res = await listUsers(idToken, "professor");

    expect(res.status).toBe(403);
  });

  it("lists only professors when filtered by role", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    await createSignedInUser("prof@example.com", "professor");
    await createSignedInUser("student@example.com", "student");

    const res = await listUsers(idToken, "professor");

    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users).toHaveLength(1);
    expect(users.at(0)).toMatchObject({ email: "prof@example.com" });
  });

  it("includes the role the admin user list renders and edits", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    await createSignedInUser("prof@example.com", "professor");
    await createSignedInUser("student@example.com", "student");

    const res = await listUsers(idToken);

    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users).toHaveLength(3);
    expect(users.map((user: { role: string }) => user.role).sort()).toEqual([
      "admin",
      "professor",
      "student",
    ]);
  });

  it("returns 400 for an unknown role", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await listUsers(idToken, "janitor");

    expect(res.status).toBe(400);
  });
});

// PANEL-22/23: the dashboard's "View all students" / "View all professors"
// links open this same list, so each row must carry the courses behind it — a
// student's enrollments, a professor's classes with each roster.
describe("GET /api/admin/users course data (PANEL-22/23)", () => {
  let adminToken: string;

  beforeEach(async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");
    adminToken = admin.idToken;
  });

  it("lists each student with the courses they are enrolled in", async () => {
    const db = getAdminDb();
    await db.collection("classes").doc("cs6300").set({
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
      term: "Fall",
      year: 2026,
      section: "001",
      professor_id: "",
    });
    await db.collection("classes").doc("cs2420").set({
      name: "Data Structures",
      courseCode: "CS 2420",
      term: "Spring",
      year: 2026,
      section: "002",
      professor_id: "",
    });

    const sam = await createSignedInUser("sam@example.com", "student");
    await db.collection("users").doc(sam.uid).set(
      { name: "Sam Student", email: "sam@example.com" },
      { merge: true }
    );
    const ava = await createSignedInUser("ava@example.com", "student");
    await db.collection("users").doc(ava.uid).set(
      { name: "Ava Asks", email: "ava@example.com" },
      { merge: true }
    );

    // Sam is in one course; Ava in two (one of them the older auto-ID doc
    // shape, which must still count through the class_id field).
    await db
      .collection("users")
      .doc(sam.uid)
      .collection("classes")
      .doc("cs6300")
      .set({ class_id: "cs6300" });
    await db
      .collection("users")
      .doc(ava.uid)
      .collection("classes")
      .add({ class_id: "cs6300" });
    await db
      .collection("users")
      .doc(ava.uid)
      .collection("classes")
      .doc("cs2420")
      .set({ class_id: "cs2420" });

    const res = await listUsers(adminToken, "student");

    expect(res.status).toBe(200);
    const rows = await userRows(res);
    expect(rows).toHaveLength(2);

    const samRow = rows.find((row) => row.uid === sam.uid)!;
    expect(samRow.courses).toEqual([
      {
        id: "cs6300",
        name: "Software Engineering Leadership",
        courseCode: "CS 6300",
        term: "Fall",
        year: 2026,
        section: "001",
      },
    ]);

    // Sorted by course code, one entry despite the duplicate auto-ID doc.
    const avaRow = rows.find((row) => row.uid === ava.uid)!;
    expect(avaRow.courses.map((course) => course.id)).toEqual(["cs2420", "cs6300"]);
    expect(avaRow.courses[1]).toMatchObject({ courseCode: "CS 6300", section: "001" });
  });

  it("lists each professor with the courses they teach and each course's roster", async () => {
    const db = getAdminDb();
    const prof = await createSignedInUser("ada@example.com", "professor");
    await db.collection("users").doc(prof.uid).set(
      { name: "Dr. Ada", email: "ada@example.com" },
      { merge: true }
    );
    await db.collection("classes").doc("cs6300").set({
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
      term: "Fall",
      year: 2026,
      section: "001",
      professor_id: prof.uid,
    });
    await db.collection("classes").doc("cs2420").set({
      name: "Data Structures",
      courseCode: "CS 2420",
      term: "Spring",
      year: 2026,
      section: "002",
      professor_id: prof.uid,
    });

    const sam = await createSignedInUser("sam@example.com", "student");
    await db.collection("users").doc(sam.uid).set(
      { name: "Sam Student", email: "sam@example.com" },
      { merge: true }
    );
    const ava = await createSignedInUser("ava@example.com", "student");
    await db.collection("users").doc(ava.uid).set(
      { name: "Ava Asks", email: "ava@example.com" },
      { merge: true }
    );

    // Sam in both of Ada's courses, Ava in one — so each course's roster is
    // distinct and the ordering is checkable.
    await db.collection("users").doc(sam.uid).collection("classes").doc("cs6300")
      .set({ class_id: "cs6300" });
    await db.collection("users").doc(sam.uid).collection("classes").doc("cs2420")
      .set({ class_id: "cs2420" });
    await db.collection("users").doc(ava.uid).collection("classes").doc("cs6300")
      .set({ class_id: "cs6300" });

    const res = await listUsers(adminToken, "professor");

    expect(res.status).toBe(200);
    const rows = await userRows(res);
    expect(rows).toHaveLength(1);

    const ada = rows[0];
    expect(ada.teaching.map((course) => course.id)).toEqual(["cs2420", "cs6300"]);

    const cs2420 = ada.teaching.find((course) => course.id === "cs2420")!;
    expect(cs2420).toMatchObject({
      courseCode: "CS 2420",
      name: "Data Structures",
      term: "Spring",
      year: 2026,
      section: "002",
    });
    expect(cs2420.students).toEqual([
      { uid: sam.uid, name: "Sam Student", email: "sam@example.com" },
    ]);

    const cs6300 = ada.teaching.find((course) => course.id === "cs6300")!;
    // Roster ordered by name, carrying the fields the page displays.
    expect(cs6300.students.map((student) => student.name)).toEqual([
      "Ava Asks",
      "Sam Student",
    ]);
    expect(cs6300.students[0]).toEqual({
      uid: ava.uid,
      name: "Ava Asks",
      email: "ava@example.com",
    });
  });

  it("reports the same roster size the course list's studentCount reports", async () => {
    const db = getAdminDb();
    const prof = await createSignedInUser("ada@example.com", "professor");
    await db.collection("users").doc(prof.uid).set({ name: "Dr. Ada" }, { merge: true });
    await db.collection("classes").doc("cs6300").set({
      name: "Software Engineering Leadership",
      courseCode: "CS 6300",
      term: "Fall",
      year: 2026,
      section: "001",
      professor_id: prof.uid,
    });

    for (const email of ["s1@example.com", "s2@example.com", "s3@example.com"]) {
      const student = await createSignedInUser(email, "student");
      await db.collection("users").doc(student.uid).set(
        { name: email.split("@")[0] },
        { merge: true }
      );
      await db
        .collection("users")
        .doc(student.uid)
        .collection("classes")
        .doc("cs6300")
        .set({ class_id: "cs6300" });
    }

    const [usersRes, classesRes] = await Promise.all([
      listUsers(adminToken, "professor"),
      listClasses(adminToken),
    ]);

    const professors = await userRows(usersRes);
    const rosterSize = professors[0].teaching.find((c) => c.id === "cs6300")!.students.length;

    const classes = (await classesRes.json()) as {
      classes: { id: string; studentCount: number }[];
    };
    const courseCount = classes.classes.find((c) => c.id === "cs6300")!.studentCount;

    // One shared join in lib/adminClasses.ts: the users page and the course
    // list can never report different numbers for the same course.
    expect(rosterSize).toBe(3);
    expect(courseCount).toBe(3);
  });

  it("keeps users without course ties at empty course lists", async () => {
    await createSignedInUser("plain-admin@example.com", "admin");
    await createSignedInUser("idle-student@example.com", "student");
    const idleProf = await createSignedInUser("idle-prof@example.com", "professor");

    const res = await listUsers(adminToken);

    expect(res.status).toBe(200);
    const rows = await userRows(res);

    const adminRow = rows.find((row) => row.role === "admin")!;
    expect(adminRow.courses).toEqual([]);
    expect(adminRow.teaching).toEqual([]);

    const studentRow = rows.find((row) => row.role === "student")!;
    expect(studentRow.courses).toEqual([]);
    expect(studentRow.teaching).toEqual([]);

    // A professor assigned no classes still renders, with an empty list.
    const profRow = rows.find((row) => row.uid === idleProf.uid)!;
    expect(profRow.teaching).toEqual([]);
  });
});
