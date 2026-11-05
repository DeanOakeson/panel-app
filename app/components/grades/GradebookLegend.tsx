import type { ReactNode } from "react";
import type { CellDisplay } from "@/lib/gradebook";
import GradeCellContent, { FeedbackIcon } from "./GradeCellContent";

const SAMPLE_POINTS = 100;

/** Returns a sample cell for the key, with every field not given left empty. */
function sample(fields: Partial<CellDisplay>): CellDisplay {
    return {
        primary: null,
        primaryMuted: false,
        badge: null,
        missingTag: false,
        hasFeedback: false,
        placeholder: null,
        srText: "",
        action: null,
        ...fields,
    };
}

type Entry = {
    key: string;
    example: ReactNode;
    /** What a screen reader hears for the example, which is hidden from it. */
    spoken: string;
    meaning: string;
};

const ENTRIES: Entry[] = [
    {
        key: "score",
        example: <GradeCellContent display={sample({ primary: "92" })} points={SAMPLE_POINTS} />,
        spoken: "A score such as 92 out of 100:",
        meaning: "Score saved",
    },
    {
        key: "feedback",
        example: <FeedbackIcon />,
        spoken: "Speech bubble:",
        meaning: "Has feedback",
    },
    {
        key: "needs-grading",
        example: (
            <GradeCellContent
                display={sample({ badge: { label: "Needs grading", tone: "needs-grading" } })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "Needs grading:",
        meaning: "Submitted, not graded yet",
    },
    {
        key: "resubmitted",
        example: (
            <GradeCellContent
                display={sample({ badge: { label: "Resubmitted", tone: "resubmitted" } })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "Resubmitted:",
        meaning: "New version to grade. The earlier score stands",
    },
    {
        key: "submitted-after-missing",
        example: (
            <GradeCellContent
                display={sample({
                    badge: { label: "Needs grading", tone: "submitted-after-missing" },
                    primary: "0",
                    primaryMuted: true,
                    missingTag: true,
                })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "Needs grading above 0 Missing:",
        meaning: "Turned in after a missing-work grade",
    },
    {
        key: "missing",
        example: (
            <GradeCellContent
                display={sample({ badge: { label: "Missing", tone: "missing" } })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "Missing:",
        meaning: "Past due, nothing turned in, no grade",
    },
    {
        key: "missing-graded",
        example: (
            <GradeCellContent
                display={sample({ primary: "0", missingTag: true })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "0 with a Missing tag:",
        meaning: "Missing-work grade of 0",
    },
    {
        key: "not-submitted",
        example: (
            <GradeCellContent display={sample({ placeholder: "Not submitted" })} points={SAMPLE_POINTS} />
        ),
        spoken: "Not submitted:",
        meaning: "Not turned in yet, still open",
    },
];

const DROPPED_ENTRY: Entry = {
    key: "dropped",
    example: <span aria-hidden="true" className="px-1 text-gray-400 dark:text-zinc-500">–</span>,
    spoken: "Dash:",
    meaning: "Not in the class for that assignment",
};

/**
 * Explains what each kind of gradebook cell means. `showDropped` adds the
 * entry for students who left the class, shown only when the grid has one.
 */
export default function GradebookLegend({ showDropped }: { showDropped: boolean }) {
    const entries = showDropped ? [...ENTRIES, DROPPED_ENTRY] : ENTRIES;

    return (
        <section
            aria-labelledby="gradebook-key-heading"
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-gray-900"
        >
            <h2
                id="gradebook-key-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400"
            >
                Key
            </h2>

            <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-2 text-xs text-gray-700 dark:text-zinc-300">
                {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-3">
                        <span className="flex w-28 shrink-0 justify-center">{entry.example}</span>
                        <span>
                            <span className="sr-only">{entry.spoken} </span>
                            {entry.meaning}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
