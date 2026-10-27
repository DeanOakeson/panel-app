import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";

export async function GET(req: Request) {
  try {
    const { error } = await requireAdmin(req);
    if (error) return error;

    const db = getAdminDb();

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
