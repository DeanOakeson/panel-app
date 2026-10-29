import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getClassAccess } from "@/lib/classAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ALLOWED_MATERIAL_TYPES,
  MATERIALS_BUCKET,
  MATERIALS_PREFIX,
  MAX_MATERIAL_FILE_SIZE,
} from "@/lib/courseMaterials";

type RouteContext = { params: Promise<{ classId: string }> };

/** How long a download link for a material file stays valid. */
const DOWNLOAD_LINK_SECONDS = 60 * 10;

/**
 * Returns the URL if it is a well-formed http(s) link, otherwise null.
 * Other schemes (javascript:, data:, file:) are rejected so a link can't run
 * code or point at the viewer's own machine.
 */
function parseLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Lists a class's course materials for its professor, admins, or enrolled students. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor && !access.isEnrolledStudent && !access.isAdmin) {
      return NextResponse.json(
        { error: "You do not have access to this class." },
        { status: 403 }
      );
    }

    const snapshot = await getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .orderBy("createdAt")
      .get();

    const materials = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const { filePath, ...rest } = data;

        if (typeof filePath !== "string" || !filePath) {
          return { id: doc.id, ...rest, fileUrl: null };
        }

        // Files are private; hand out a short-lived download link instead.
        const { data: signed, error } = await getSupabaseAdmin()
          .storage.from(MATERIALS_BUCKET)
          .createSignedUrl(filePath, DOWNLOAD_LINK_SECONDS);

        if (error) {
          console.error("Create course material download link failed:", error);
        }

        return { id: doc.id, ...rest, fileUrl: error ? null : signed.signedUrl };
      })
    );

    return NextResponse.json({ materials }, { status: 200 });
  } catch (error) {
    console.error("GET /api/classes/[classId]/materials failed:", error);
    return NextResponse.json(
      { error: "Failed to load course materials." },
      { status: 500 }
    );
  }
}

/**
 * Adds a course material: a title and description, plus an optional link and
 * an optional file. Send JSON, or multipart form data when attaching a file.
 * Only the class's professor may do this.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { classId } = await params;
    const access = await getClassAccess(request, classId);
    if (access.error) return access.error;

    if (!access.isClassProfessor) {
      return NextResponse.json(
        { error: "Only this class's professor can add course materials." },
        { status: 403 }
      );
    }

    let fields: Record<string, unknown>;
    let file: File | null = null;
    const isForm = (request.headers.get("content-type") ?? "").includes(
      "multipart/form-data"
    );

    try {
      if (isForm) {
        const form = await request.formData();
        const upload = form.get("file");
        file = upload instanceof File && upload.size > 0 ? upload : null;
        fields = {
          title: form.get("title"),
          description: form.get("description"),
          url: form.get("url"),
        };
      } else {
        fields = (await request.json()) ?? {};
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const title = typeof fields.title === "string" ? fields.title.trim() : "";
    const description =
      typeof fields.description === "string" ? fields.description.trim() : "";
    const rawUrl = typeof fields.url === "string" ? fields.url.trim() : "";
    const url = rawUrl ? parseLink(rawUrl) : null;

    if (!title || title.length > 150) {
      return NextResponse.json(
        { error: "Title is required (150 characters max)." },
        { status: 400 }
      );
    }

    if (!description || description.length > 1000) {
      return NextResponse.json(
        { error: "Description is required (1000 characters max)." },
        { status: 400 }
      );
    }

    if (rawUrl && !url) {
      return NextResponse.json(
        { error: "Enter a valid link starting with http:// or https://, or leave it blank." },
        { status: 400 }
      );
    }

    if (file) {
      if (file.size > MAX_MATERIAL_FILE_SIZE) {
        return NextResponse.json(
          { error: "Files must be 4 MB or smaller. Share larger files as a link." },
          { status: 400 }
        );
      }

      if (!ALLOWED_MATERIAL_TYPES[file.type]) {
        return NextResponse.json(
          {
            error:
              "Upload a PDF, Word, PowerPoint, Excel, text, PNG, or JPEG file.",
          },
          { status: 400 }
        );
      }
    }

    const materialRef = getAdminDb()
      .collection("classes")
      .doc(classId)
      .collection("materials")
      .doc();

    let fileFields: Record<string, string | number> = {};

    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${MATERIALS_PREFIX}/${classId}/${materialRef.id}/${safeName}`;

      const { error: uploadError } = await getSupabaseAdmin()
        .storage.from(MATERIALS_BUCKET)
        .upload(filePath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Course material upload failed:", uploadError);
        return NextResponse.json(
          { error: "The file couldn't be uploaded. Please try again." },
          { status: 500 }
        );
      }

      fileFields = {
        filePath,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      };
    }

    const material = {
      title,
      description,
      url,
      ...fileFields,
      createdBy: access.uid,
      createdAt: new Date().toISOString(),
    };

    try {
      await materialRef.set(material);
    } catch (error) {
      // Don't leave an orphaned file behind if the record can't be saved.
      if (typeof fileFields.filePath === "string") {
        await getSupabaseAdmin()
          .storage.from(MATERIALS_BUCKET)
          .remove([fileFields.filePath]);
      }
      throw error;
    }

    // The storage path stays on the server; clients get download links from GET.
    const publicMaterial: Record<string, unknown> = { id: materialRef.id, ...material };
    delete publicMaterial.filePath;

    return NextResponse.json({ material: publicMaterial }, { status: 201 });
  } catch (error) {
    console.error("POST /api/classes/[classId]/materials failed:", error);
    return NextResponse.json(
      { error: "Failed to add course material." },
      { status: 500 }
    );
  }
}
