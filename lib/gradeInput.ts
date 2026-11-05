/** The longest feedback a grade can store, in characters. */
export const MAX_FEEDBACK_LENGTH = 5000;

/**
 * Parses a request's JSON body. Returns the body, an empty object for a JSON
 * null, or null when the body is not JSON.
 */
export async function readJsonBody(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) ?? {};
  } catch {
    return null;
  }
}

/**
 * Reads a grade's score and feedback from a request body. The score must be a
 * number from 0 to `points`, and the trimmed feedback at most 5000 characters.
 * Returns the parsed values, or the message for a 400 response.
 */
export function readScoreAndFeedback(
  body: Record<string, unknown>,
  points: number
): { score: number; feedback: string } | { error: string } {
  const score = body.score;
  const feedback =
    typeof body.feedback === "string" ? body.feedback.trim() : "";

  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > points
  ) {
    return { error: `Score must be a number from 0 to ${points}.` };
  }

  if (feedback.length > MAX_FEEDBACK_LENGTH) {
    return { error: "Feedback must be 5000 characters or fewer." };
  }

  return { score, feedback };
}
