import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

export async function GET(req: Request) {
  try {
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return NextResponse.json(
        { error: "Missing authentication token." },
        { status: 401 }
      );
    }

    const decoded = await getAdminAuth().verifyIdToken(token);

    // Only the configured administrator can view requests.
    if (decoded.uid !== process.env.ADMIN_UID) {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    const db = getAdminDb();

    // Verify the administrator's Firestore role too.
    const adminDoc = await db.collection("users").doc(decoded.uid).get();

    if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
      return NextResponse.json(
        { error: "Your account does not have the admin role." },
        { status: 403 }
      );
    }

    const snapshot = await db
      .collection("users")
      .where("professorStatus", "==", "pending")
      .get();

    const requests = snapshot.docs.map((doc) => ({
      uid: doc.id,
      name: doc.data().name ?? "",
      email: doc.data().email ?? "",
      role: doc.data().role ?? "student",
      professorStatus: doc.data().professorStatus ?? "pending",
    }));

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("GET /api/admin/professors error:", error);

    return NextResponse.json(
      { error: "Failed to load professor requests." },
      { status: 500 }
    );
  }
}