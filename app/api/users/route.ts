
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

async function verifyAdmin(req: Request) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("UNAUTHORIZED");
  }

  const decoded = await getAdminAuth().verifyIdToken(token);
  const adminUid = process.env.ADMIN_UID;

  if (!adminUid || decoded.uid !== adminUid) {
    throw new Error("FORBIDDEN");
  }

  const db = getAdminDb();
  const adminDoc = await db.collection("users").doc(decoded.uid).get();

  if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  return { db, decoded };
}

// GET /api/users
export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return Response.json(
        { error: "Missing authentication token" },
        { status: 401 }
      );
    }

    const decoded = await getAdminAuth().verifyIdToken(token);

    const snapshot = await getAdminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!snapshot.exists) {
      return Response.json(
        { error: "User profile not found" },
        { status: 404 }
      );
    }

    return Response.json({
      id: snapshot.id,
      ...snapshot.data(),
    });
  } catch (error) {
    console.error("[GET /api/users] Failed:", error);

    return Response.json(
      { error: "Could not retrieve user profile" },
      { status: 500 }
    );
  }
}

// POST /api/users
// Create or update the signed-in user's own profile.
// This endpoint never grants admin or professor privileges.
export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return Response.json(
        { error: "Missing authentication token" },
        { status: 401 }
      );
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const body = await req.json();

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const requestedRole = body.role;

    if (!name || name.length > 100) {
      return Response.json(
        { error: "Please provide a valid name (up to 100 characters)" },
        { status: 400 }
      );
    }

    if (requestedRole !== "student" && requestedRole !== "professor") {
      return Response.json(
        { error: "Role must be student or professor" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(decoded.uid);

    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);

      if (!snapshot.exists) {
        const professorStatus =
          requestedRole === "professor" ? "pending" : "not_requested";

        transaction.set(userRef, {
          name,
          email: decoded.email ?? null,
          role: "student",
          professorStatus,
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          role: "student",
          professorStatus,
        };
      }

      const existing = snapshot.data()!;

      // Preserve privileged roles and approved professor status.
      const update: Record<string, unknown> = {
        name,
        email: decoded.email ?? null,
      };

      let professorStatus = existing.professorStatus ?? "not_requested";

      if (
        requestedRole === "professor" &&
        existing.role === "student" &&
        professorStatus !== "approved"
      ) {
        professorStatus = "pending";
        update.professorStatus = "pending";
      }

      transaction.update(userRef, update);

      return {
        role: existing.role ?? "student",
        professorStatus,
      };
    });

    return Response.json({
      success: true,
      uid: decoded.uid,
      role: result.role,
      professorStatus: result.professorStatus,
    });
  } catch (error) {
    console.error("[POST /api/users] Failed:", error);

    return Response.json(
      { error: "Failed to create or update user profile" },
      { status: 500 }
    );
  }
}

// PATCH /api/users
// Admin-only: approve or reject a professor application.
export async function PATCH(req: Request) {
  try {
    const { db } = await verifyAdmin(req);
    const body = await req.json();

    const uid = typeof body.uid === "string" ? body.uid.trim() : "";
    const action = body.action;

    if (!uid || !["approve", "reject"].includes(action)) {
      return Response.json(
        { error: "Provide a valid uid and action: approve or reject" },
        { status: 400 }
      );
    }

    if (uid === process.env.ADMIN_UID) {
      return Response.json(
        { error: "The admin account cannot be changed here" },
        { status: 400 }
      );
    }

    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);

      if (!snapshot.exists) {
        throw new Error("APPLICANT_NOT_FOUND");
      }

      const applicant = snapshot.data()!;

      if (applicant.professorStatus !== "pending") {
        throw new Error("APPLICATION_NOT_PENDING");
      }

      if (action === "approve") {
        transaction.update(userRef, {
          role: "professor",
          professorStatus: "approved",
        });
      } else {
        transaction.update(userRef, {
          role: "student",
          professorStatus: "rejected",
        });
      }
    });

    return Response.json({
      success: true,
      message:
        action === "approve"
          ? "Professor approved successfully"
          : "Professor application rejected",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (message === "FORBIDDEN") {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }

    if (message === "APPLICANT_NOT_FOUND") {
      return Response.json({ error: "Applicant not found" }, { status: 404 });
    }

    if (message === "APPLICATION_NOT_PENDING") {
      return Response.json(
        { error: "This application is no longer pending" },
        { status: 409 }
      );
    }

    console.error("[PATCH /api/users] Failed:", error);

    return Response.json(
      { error: "Failed to update professor application" },
      { status: 500 }
    );
  }
}
