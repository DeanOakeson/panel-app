"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { describeCell, type CellDisplay, type GradebookCell } from "@/lib/gradebook";
import type { GradingStatus } from "@/lib/gradingStatus";
import GradeCellContent from "./GradeCellContent";

type Entry = {
    key: string;
    sample: ReactNode;
    /** What a screen reader hears for the sample, which is hidden from it. */
    spoken: string;
    meaning: string;
};

type Group = {
    key: string;
    heading: string;
    /** The dot beside the heading. */
    dotClass: string;
    entries: Entry[];
};

/** The gap between the button and the key, in pixels. */
const GAP = 4;

/** The least room the key leaves between itself and the window's edges, in pixels. */
const EDGE = 8;

/** The least room below the button that the key opens into before it tries above. */
const MIN_ROOM_BELOW = 240;

/** Returns how a cell with this status and score looks, the way the grid describes it. */
function sampleDisplay(
    status: GradingStatus,
    score: number | null,
    { points, closed = true, feedback = "" }: { points: number; closed?: boolean; feedback?: string }
): CellDisplay {
    const cell: GradebookCell = {
        status,
        score,
        submittedAt: null,
        grade: feedback ? { score: score ?? 0, feedback, gradedAt: "", updatedAt: null, submittedAt: "" } : null,
        missingGrade: null,
    };

    return describeCell(cell, { points, closed }, true);
}

/** Shows a sample cell. `withBadge` false leaves off the Needs grading badge its group already names. */
function SampleCell({ display, points, withBadge = true }: { display: CellDisplay; points: number; withBadge?: boolean }) {
    return <GradeCellContent display={withBadge ? display : { ...display, badge: null }} points={points} />;
}

const DROPPED_GROUP: Group = {
    key: "dropped",
    heading: "Left the class",
    dotClass: "border border-gray-500 dark:border-zinc-400",
    entries: [
        {
            key: "dropped",
            sample: <span className="text-base text-gray-500 dark:text-zinc-400">–</span>,
            spoken: "Dash:",
            meaning: "Not in the class for this assignment",
        },
    ],
};

const GROUPS: Group[] = [
    {
        key: "to-grade",
        heading: "To grade",
        dotClass: "bg-blue-600 dark:bg-blue-400",
        entries: [
            {
                key: "needs-grading",
                sample: <SampleCell display={sampleDisplay("needs-grading", null, { points: 10 })} points={10} />,
                spoken: "Needs grading:",
                meaning: "Turned in, waiting for you to grade",
            },
            {
                key: "resubmitted",
                sample: (
                    <SampleCell display={sampleDisplay("resubmitted", 82, { points: 100 })} points={100} withBadge={false} />
                ),
                spoken: "Resubmitted, with the earlier score:",
                meaning: "New version to grade. The earlier score stands until then",
            },
            {
                key: "after-missing",
                sample: (
                    <SampleCell
                        display={sampleDisplay("submitted-after-missing", 0, { points: 20 })}
                        points={20}
                        withBadge={false}
                    />
                ),
                spoken: "After Missing, with the earlier score:",
                meaning: "Turned in after a missing-work grade",
            },
        ],
    },
    {
        key: "not-turned-in",
        heading: "Not turned in",
        dotClass: "bg-gray-500 dark:bg-zinc-400",
        entries: [
            {
                key: "not-submitted",
                sample: <SampleCell display={sampleDisplay("missing", null, { points: 10, closed: false })} points={10} />,
                spoken: "Not submitted:",
                meaning: "Not due yet",
            },
            {
                key: "missing",
                sample: <SampleCell display={sampleDisplay("missing", null, { points: 10 })} points={10} />,
                spoken: "Missing:",
                meaning: "Past due, no grade yet",
            },
            {
                key: "missing-graded",
                sample: <SampleCell display={sampleDisplay("missing-graded", 0, { points: 10 })} points={10} />,
                spoken: "0 out of 10 with a Missing tag:",
                meaning: "Zero given for missing work",
            },
        ],
    },
    {
        key: "graded",
        heading: "Graded",
        dotClass: "bg-green-600 dark:bg-green-400",
        entries: [
            {
                key: "graded",
                sample: <SampleCell display={sampleDisplay("graded", 18, { points: 20 })} points={20} />,
                spoken: "A score like 18 out of 20:",
                meaning: "Score out of the points",
            },
            {
                key: "feedback",
                sample: (
                    <SampleCell display={sampleDisplay("graded", 18, { points: 20, feedback: "Clear work." })} points={20} />
                ),
                spoken: "A score with a speech bubble:",
                meaning: "Has written feedback",
            },
        ],
    },
];

/**
 * Places the key under its button with their right edges aligned, inside the
 * window. It opens above instead when the window has little room below and
 * more above. Its height is capped to the room, past which it scrolls.
 */
function placeKey(popover: HTMLElement, button: HTMLElement) {
    const anchor = button.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const right = Math.max(EDGE, viewportWidth - anchor.right);
    const roomBelow = viewportHeight - anchor.bottom - GAP - EDGE;
    const roomAbove = anchor.top - GAP - EDGE;
    const below = roomBelow >= MIN_ROOM_BELOW || roomBelow >= roomAbove;

    popover.style.right = `${right}px`;
    popover.style.maxWidth = `${viewportWidth - right - EDGE}px`;
    popover.style.top = below ? `${anchor.bottom + GAP}px` : "auto";
    popover.style.bottom = below ? "auto" : `${viewportHeight - anchor.top + GAP}px`;
    popover.style.maxHeight = `${Math.max(0, below ? roomBelow : roomAbove)}px`;
}

/**
 * Shows a Key button that opens what each kind of gradebook cell means, in
 * the column filter's groups. The key is a popover that leaves focus where it
 * is. Escape closes it and puts focus on the button, and a click outside
 * closes it. Its two group columns stack when the window is narrow.
 * `showDropped` adds the group for students who left the class, shown only
 * when the grid has one.
 */
export default function GradebookKey({ showDropped, buttonClassName }: { showDropped: boolean; buttonClassName: string }) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLElement>(null);
    const popoverId = useId();
    const groups = showDropped ? [...GROUPS, DROPPED_GROUP] : GROUPS;

    // Places the key before it shows and follows whether it is open
    useEffect(() => {
        const popover = popoverRef.current;
        if (!popover) return;

        function onBeforeToggle(event: Event) {
            if ((event as ToggleEvent).newState === "open" && popover && buttonRef.current) {
                placeKey(popover, buttonRef.current);
            }
        }

        function onToggle(event: Event) {
            setOpen((event as ToggleEvent).newState === "open");
        }

        popover.addEventListener("beforetoggle", onBeforeToggle);
        popover.addEventListener("toggle", onToggle);

        return () => {
            popover.removeEventListener("beforetoggle", onBeforeToggle);
            popover.removeEventListener("toggle", onToggle);
        };
    }, []);

    // Closes on Escape unless something else, such as a filter menu, took it,
    // and keeps the key at its button as the page scrolls or resizes
    useEffect(() => {
        if (!open) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Escape" || event.defaultPrevented) return;

            event.preventDefault();
            if (popoverRef.current?.matches(":popover-open")) popoverRef.current.hidePopover();
            buttonRef.current?.focus();
        }

        function follow() {
            if (popoverRef.current && buttonRef.current) placeKey(popoverRef.current, buttonRef.current);
        }

        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("scroll", follow, true);
        window.addEventListener("resize", follow);

        return () => {
            document.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("scroll", follow, true);
            window.removeEventListener("resize", follow);
        };
    }, [open]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                popoverTarget={popoverId}
                aria-expanded={open}
                aria-controls={popoverId}
                className={buttonClassName}
            >
                Key
            </button>

            <section
                ref={popoverRef}
                id={popoverId}
                popover="auto"
                aria-label="Key"
                className="inset-auto m-0 w-[40rem] overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-lg dark:border-zinc-700 dark:bg-gray-900 dark:text-zinc-100"
            >
                <div className="@container">
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 @lg:grid-cols-2">
                        {groups.map((group) => (
                            <div key={group.key}>
                                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-zinc-200">
                                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${group.dotClass}`} />
                                    {group.heading}
                                </h2>

                                <ul className="mt-2 flex flex-col gap-1.5">
                                    {group.entries.map((entry) => (
                                        <li key={entry.key} className="flex items-center gap-3">
                                            <span
                                                aria-hidden="true"
                                                className="flex min-h-9 w-32 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-gray-900"
                                            >
                                                {entry.sample}
                                            </span>

                                            <span className="min-w-0 flex-1 text-sm text-gray-700 dark:text-zinc-300">
                                                <span className="sr-only">{entry.spoken} </span>
                                                {entry.meaning}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
}
