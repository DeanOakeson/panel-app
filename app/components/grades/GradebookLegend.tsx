import type { ReactNode } from "react";
import type { CellDisplay } from "@/lib/gradebook";
import GradeCellContent, { FeedbackIcon } from "./GradeCellContent";

const SAMPLE_POINTS = 100;

/** Returns a sample cell for the key, with every field not given left empty. */
function sample(fields: Partial<CellDisplay>): CellDisplay {
    return {
        primary: null,
        primaryMuted: false,
        primaryLabel: null,
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
        meaning: "Ready to grade",
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
        meaning: "New version to grade",
    },
    {
        key: "submitted-after-missing",
        example: (
            <GradeCellContent
                display={sample({
                    badge: { label: "Needs grading", tone: "submitted-after-missing" },
                })}
                points={SAMPLE_POINTS}
            />
        ),
        spoken: "Needs grading in amber:",
        meaning: "Turned in after Missing",
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
        meaning: "Past due, no grade",
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
        meaning: "Missing-work grade",
    },
    {
        key: "not-submitted",
        example: (
            <GradeCellContent display={sample({ placeholder: "Not submitted" })} points={SAMPLE_POINTS} />
        ),
        spoken: "Not submitted:",
        meaning: "Still open",
    },
];

const DROPPED_ENTRY: Entry = {
    key: "dropped",
    example: <span aria-hidden="true" className="px-1 text-base text-gray-500 dark:text-zinc-400">–</span>,
    spoken: "Dash:",
    meaning: "Not enrolled then",
};

/**
 * Explains each kind of gradebook cell in a compact, wrapping line.
 * `showDropped` adds the entry for students who left the class, shown only
 * when the grid has one.
 */
export default function GradebookLegend({ id, showDropped }: { id: string; showDropped: boolean }) {
    const entries = showDropped ? [...ENTRIES, DROPPED_ENTRY] : ENTRIES;

    return (
        <section
            id={id}
            aria-labelledby={`${id}-heading`}
            className="relative rounded-lg border border-gray-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-gray-900"
        >
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-800 dark:text-zinc-200">
                <li>
                    <h2
                        id={`${id}-heading`}
                        className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-zinc-300"
                    >
                        Key
                    </h2>
                </li>

                {entries.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-1.5">
                        <span className="flex shrink-0 items-center">{entry.example}</span>
                        <span className="whitespace-nowrap">
                            <span className="sr-only">{entry.spoken} </span>
                            {entry.meaning}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
