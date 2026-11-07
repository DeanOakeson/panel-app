const CHANNEL_NAME = "panel-grades";

type GradeSavedMessage = { type: "grade-saved"; classId: string };

/** Returns whether the browser can message other tabs. */
function canBroadcast(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

/** Tells this browser's other tabs that a grade in a class was saved. */
export function announceGradeSaved(classId: string): void {
  if (!canBroadcast()) return;

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const message: GradeSavedMessage = { type: "grade-saved", classId };

  channel.postMessage(message);
  channel.close();
}

/**
 * Calls `onSaved` whenever another tab saves a grade in the class. Returns a
 * function that stops listening.
 */
export function onGradeSaved(classId: string, onSaved: () => void): () => void {
  if (!canBroadcast()) return () => {};

  const channel = new BroadcastChannel(CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent<GradeSavedMessage>) => {
    if (event.data?.type === "grade-saved" && event.data.classId === classId) {
      onSaved();
    }
  };

  return () => channel.close();
}
