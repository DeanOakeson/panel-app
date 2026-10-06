import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

// GET /api/users (get current user profile)
export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.split("Bearer ")[1];

    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const doc = await getAdminDb().collection("users").doc(uid).get();

    return Response.json({
      id: doc.id,
      ...doc.data(),
    });
  } catch {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }
}

// POST /api/users (create or update user profile)
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.split("Bearer ")[1];

    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const body = await req.json();

    await getAdminDb().collection("users").doc(uid).set(
      {
        name: body.name,
        email: body.email,
        createdAt: new Date(),
      },
      { merge: true }
    );

    return Response.json({
      success: true,
      uid,
    });
  } catch {
    return Response.json({ error: "Failed request" }, { status: 500 });
  }
}