/**
 * Course material file rules, shared by the API routes and the upload form.
 * Kept free of server imports so client components can use it.
 */

/**
 * Files go in the existing Supabase bucket under materials/, next to student
 * submissions (which live at {classId}/...), so no extra bucket is needed.
 */
export const MATERIALS_BUCKET = "assignment-submissions";
export const MATERIALS_PREFIX = "materials";

/** Vercel rejects request bodies over 4.5 MB, so stay under it. */
export const MAX_MATERIAL_FILE_SIZE = 4 * 1024 * 1024;

export const ALLOWED_MATERIAL_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

/** For the file input's accept attribute. */
export const MATERIAL_FILE_ACCEPT = Object.values(ALLOWED_MATERIAL_TYPES).join(",") + ",.jpeg";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
