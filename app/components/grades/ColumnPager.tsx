import type { ColumnView } from "./GradebookTable";

type Props = {
    /** The columns in view, or null while every column fits, which hides the pager. */
    view: ColumnView | null;
    /** The id of the scrolling grid the buttons move. */
    controls: string;
    /** Moves the grid one column earlier (-1) or later (1). */
    onStep: (step: -1 | 1) => void;
};

const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white dark:border-zinc-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-zinc-800 dark:focus-visible:outline-blue-400 dark:aria-disabled:hover:bg-gray-900";

/** Shows a chevron pointing left or right. */
function Chevron({ pointsLeft }: { pointsLeft: boolean }) {
    return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
            <path
                d={
                    pointsLeft
                        ? "M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z"
                        : "M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4Z"
                }
            />
        </svg>
    );
}

/**
 * Shows which assignment columns are in view, like "Assignments 1–5 of 6",
 * with buttons that move the grid a column at a time. A button at its end is
 * disabled but keeps focus, so pressing it again does nothing.
 */
export default function ColumnPager({ view, controls, onStep }: Props) {
    if (!view) return null;

    const range =
        view.first === view.last
            ? `Assignment ${view.first} of ${view.total}`
            : `Assignments ${view.first}–${view.last} of ${view.total}`;

    return (
        <div className="flex items-center gap-1.5">
            <p className="mr-1 whitespace-nowrap text-sm tabular-nums text-gray-700 dark:text-zinc-300">
                {range}
            </p>

            <button
                type="button"
                aria-label="Show earlier assignments"
                title="Show earlier assignments"
                aria-controls={controls}
                aria-disabled={view.atStart}
                onClick={() => !view.atStart && onStep(-1)}
                className={buttonClass}
            >
                <Chevron pointsLeft />
            </button>

            <button
                type="button"
                aria-label="Show later assignments"
                title="Show later assignments"
                aria-controls={controls}
                aria-disabled={view.atEnd}
                onClick={() => !view.atEnd && onStep(1)}
                className={buttonClass}
            >
                <Chevron pointsLeft={false} />
            </button>
        </div>
    );
}
