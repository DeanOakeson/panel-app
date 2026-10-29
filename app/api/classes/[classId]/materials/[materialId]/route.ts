import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MATERIALS_BUCKET } from "@/lib/courseMaterials";

type RouteContext = {
  params: Promise<{ classId: string; materialId: string }>;
};

/** Removes a course material. Only the class's professor may do this. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId, materialId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor) {
      return NextResponse.json(
        { error: "Only this class's professor can remove course materials." },
        { status: 403 }
      );
    }

    const materialRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .doc(materialId);

    const materialDoc = await materialRef.get();

    if (!materialDoc.exists) {
      return NextResponse.json(
        { error: "Course material not found." },
        { status: 404 }
      );
    }

    await materialRef.delete();

    // Remove the attached file too. A failure here only leaves an unused
    // file in storage, so log it rather than failing the request.
    const filePath = materialDoc.data()?.filePath;
    if (typeof filePath === "string" && filePath) {
      const { error } = await getSupabaseAdmin()
        .storage.from(MATERIALS_BUCKET)
        .remove([filePath]);
      if (error) console.error("Remove course material file failed:", error);
    }

    return NextResponse.json({ deleted: true, id: materialId }, { status: 200 });
  } catch (error) {
    console.error(
      "DELETE /api/classes/[classId]/materials/[materialId] failed:",
      error
    );
    return NextResponse.json(
      { error: "Failed to remove course material." },
      { status: 500 }
    );
  }
}
