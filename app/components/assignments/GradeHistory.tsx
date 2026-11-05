"use client";

import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { formatTimestamp } from "@/lib/assignmentDeadline";
import type { GradeHistoryEntry } from "@/lib/gradeHistory";

type HistoryEntry = GradeHistoryEntry & {
    /** Null when the saver has no profile. */
    savedByName: string | null;
};

type History = { grade: HistoryEntry[]; missingGrade: HistoryEntry[] };

type Props = {
    classId: string;
    assignmentId: string;
    studentId: string;
    points: number;
    /** Changes whenever a grade on the row is saved, which reloads an open history. */
    version: string;
};

/** Lists the saved versions of one kind of grade, oldest first. */
function HistoryList({ entries, points }: { entries: HistoryEntry[]; points: number }) {
    return (
        <ol className="mt-1 space-y-2">
            {entries.map((entry) => (
                <li
                    key={`${entry.savedAt}-${entry.action}`}
                    className="border-l-2 border-gray-200 pl-3 dark:border-zinc-700"
                >
                    <p className="text-sm text-gray-900 dark:text-white">
                        <span className="font-medium">{`${entry.score} / ${points}`}</span>
                        <span className="text-gray-500 dark:text-zinc-400">
                            {` · ${entry.action === "created" ? "Graded" : "Edited"} by ${
                                entry.savedByName ?? "Unknown user"
                            }, ${formatTimestamp(entry.savedAt)}`}
                        </span>
                    </p>

                    {entry.feedback && (
                        <p className="whitespace-pre-line text-sm text-gray-700 dark:text-zinc-300">
                            {entry.feedback}
                        </p>
                    )}
                </li>
            ))}
        </ol>
    );
}

/**
 * Shows a "History" disclosure listing every saved version of a student's
 * submission grade and missing-work grade. Loads when first opened.
 */
export default function GradeHistory({
    classId,
    assignmentId,
    studentId,
    points,
    version,
}: Props) {
    const [open, setOpen] = useState(false);
    const [history, setHistory] = useState<History | null>(null);
    const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open || loadedVersion === version) {
            return;
        }

        let cancelled = false;

        async function load() {
            try {
                const user = getFirebaseAuth().currentUser;

                if (!user) {
                    throw new Error("Please sign in again.");
                }

                const response = await fetch(
                    `/api/classes/${classId}/assignments/${assignmentId}/grade-history/${studentId}`,
                    {
                        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
                        cache: "no-store",
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || "Failed to load grade history.");
                }

                if (!cancelled) {
                    setHistory(data);
                    setError("");
                    setLoadedVersion(version);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Something went wrong.");
                }
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [open, version, loadedVersion, classId, assignmentId, studentId]);

    const both = !!history && history.grade.length > 0 && history.missingGrade.length > 0;

    return (
        <details
            className="mt-3"
            onToggle={(event) => setOpen(event.currentTarget.open)}
        >
            <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400">
                History
            </summary>

            <div className="mt-2">
                {error ? (
                    <p className="text-sm text-red-600">{error}</p>
                ) : !history ? (
                    <p className="text-sm text-gray-500 dark:text-zinc-400">Loading history...</p>
                ) : history.grade.length === 0 && history.missingGrade.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-zinc-400">No saved versions yet.</p>
                ) : (
                    <div className="space-y-3">
                        {history.missingGrade.length > 0 && (
                            <div>
                                {both && (
                                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                                        Missing-work grade
                                    </p>
                                )}
                                <HistoryList entries={history.missingGrade} points={points} />
                            </div>
                        )}

                        {history.grade.length > 0 && (
                            <div>
                                {both && (
                                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                                        Submission grade
                                    </p>
                                )}
                                <HistoryList entries={history.grade} points={points} />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </details>
    );
}
