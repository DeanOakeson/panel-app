"use client";

import {
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type FocusEvent,
    type KeyboardEvent,
    type Ref,
} from "react";
import Link from "next/link";
import {
    columnsInView,
    describeCell,
    filterCounts,
    filterStudents,
    gridLayout,
    moveInGrid,
    STUDENT_COLUMN_WIDTH,
    studentLabel,
    type ColumnRange,
    type Gradebook,
    type GradebookAssignment,
    type GradebookFilter,
    type GradebookStudent,
    type GridKey,
    type GridPosition,
    type StudentFilter,
} from "@/lib/gradebook";
import ColumnFilterMenu from "./ColumnFilterMenu";
import GradeCellContent from "./GradeCellContent";

/** Identifies one cell of the gradebook. */
export type CellKey = { studentId: string; assignmentId: string };

/** The assignment columns in view while the grid scrolls sideways, and whether it rests at either end. */
export type ColumnView = ColumnRange & { atStart: boolean; atEnd: boolean };

/** Lets the page scroll the grid from outside it. */
export type GradebookTableHandle = {
    /** Scrolls the grid one assignment column earlier (-1) or later (1). */
    scrollColumns: (step: -1 | 1) => void;
};

type Props = {
    gradebook: Gradebook;
    /** The cell whose details are open, outlined in the grid. */
    selected: CellKey | null;
    onSelect: (key: CellKey) => void;
    /** The column filter that limits the rows, or null to show every student. */
    filter: GradebookFilter | null;
    /** Sets one column's filter, or clears it with null. */
    onFilterChange: (filter: GradebookFilter | null) => void;
    /** Receives the columns in view as they change, or null while every column fits. */
    onColumnViewChange?: (view: ColumnView | null) => void;
    ref?: Ref<GradebookTableHandle>;
};

const HINT_ID = "gradebook-keys-hint";

/** The scrolling grid's id, which the column buttons control. */
export const GRID_SCROLLER_ID = "gradebook-grid";

/** The scroll container's left and right borders together, in pixels. */
const CONTAINER_BORDER = 2;

const GRID_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];

/** Returns the attribute value that finds a cell's button again, such as after its panel closes. */
export function cellDataKey({ studentId, assignmentId }: CellKey): string {
    return `${studentId}:${assignmentId}`;
}

/** Returns the name shown for a student, falling back for an unknown one. */
export function displayStudentName(student: GradebookStudent): string {
    return studentLabel(student) ?? "Unknown student";
}

/**
 * Scrolls a grid element just far enough to show it clear of the frozen
 * header row and student column, which the container's scroll padding covers.
 */
export function revealInGrid(element: Element) {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Returns a short due line for a column header, like "Due Nov 8" or "Closed Oct 30". */
function shortDue(assignment: GradebookAssignment): string {
    if (assignment.closesAt) {
        const day = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Denver",
            month: "short",
            day: "numeric",
        }).format(new Date(assignment.closesAt));

        return `${assignment.closed ? "Closed" : "Due"} ${day}`;
    }

    return assignment.dueDate ? `Due ${assignment.dueDate}` : "No due date";
}

/**
 * Shows a student's name, with their email in its hover title, and a Not
 * enrolled tag for someone who left.
 */
function StudentHeader({ student }: { student: GradebookStudent }) {
    const label = studentLabel(student);
    const title = student.name && student.email ? `${student.name} (${student.email})` : label;

    return (
        <div className="min-w-0">
            <p className="truncate font-medium text-gray-900 dark:text-white" title={title ?? undefined}>
                {label ?? "Unknown student"}
            </p>

            {!label && (
                <p className="truncate text-sm font-normal text-gray-600 dark:text-zinc-300">
                    ID: {student.id}
                </p>
            )}

            {!student.enrolled && (
                <span className="mt-1 inline-block rounded-full border border-gray-400 px-2 py-0.5 text-xs font-semibold text-gray-800 dark:border-zinc-500 dark:text-zinc-100">
                    Not enrolled
                </span>
            )}
        </div>
    );
}

/** Returns whether two column views show the same thing. */
function sameView(first: ColumnView | null, second: ColumnView | null): boolean {
    if (first === null || second === null) return first === second;

    return (
        first.first === second.first &&
        first.last === second.last &&
        first.total === second.total &&
        first.atStart === second.atStart &&
        first.atEnd === second.atEnd
    );
}

/** Returns the grid position an element was rendered at, or null for anything else. */
function positionOf(element: HTMLElement): GridPosition | null {
    const row = element.dataset.gridRow;
    const col = element.dataset.gridCol;

    return row === undefined || col === undefined ? null : { row: Number(row), col: Number(col) };
}

const stickyCellBase = "border-b border-gray-200 dark:border-zinc-700";
const bodyBackground =
    "bg-white group-hover:bg-gray-50 dark:bg-gray-900 dark:group-hover:bg-gray-800";
const focusRing =
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";
const headerButton =
    "-mx-1 mt-0.5 block w-fit max-w-full rounded-sm px-1 text-left text-sm leading-5 hover:bg-gray-200 dark:hover:bg-gray-700";
const headerFocusRing =
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";
const filteredHeader =
    "bg-blue-50 shadow-[inset_0_3px_0_0_var(--color-blue-600)] dark:bg-blue-950 dark:shadow-[inset_0_3px_0_0_var(--color-blue-400)]";
const cellInteraction =
    "cursor-pointer hover:bg-blue-50 hover:ring-1 hover:ring-inset hover:ring-blue-300 focus-visible:bg-blue-50 dark:hover:bg-blue-950 dark:hover:ring-blue-700 dark:focus-visible:bg-blue-950";

/**
 * Shows every student against every assignment. Each cell is a button that
 * opens its details, and the header row and student column stay in view
 * while the grid scrolls. The grid is one Tab stop: the arrow keys, Home and
 * End move between its cells and the column headers' filter buttons. A
 * shaded edge marks each side with more columns or rows beyond it, and a
 * scroll comes to rest on whole columns and rows.
 */
export default function GradebookTable({
    gradebook,
    selected,
    onSelect,
    filter,
    onFilterChange,
    onColumnViewChange,
    ref,
}: Props) {
    const { assignments, canGradeSubmissions } = gradebook;
    const students = filterStudents(gradebook, filter);
    const courseName = gradebook.class.courseCode ?? gradebook.class.name;
    const tableRef = useRef<HTMLTableElement>(null);
    const headerRef = useRef<HTMLTableSectionElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const reportedView = useRef<ColumnView | null>(null);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [room, setRoom] = useState<number | null>(null);
    const [active, setActive] = useState<GridPosition | null>(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(true);
    const [atBottom, setAtBottom] = useState(true);
    const [scrollbarWidth, setScrollbarWidth] = useState(0);
    const [scrollbarHeight, setScrollbarHeight] = useState(0);

    // Keeps the scroll padding equal to the header row, whose height follows the names' wrapping
    useEffect(() => {
        const header = headerRef.current;
        if (!header) return;

        const observer = new ResizeObserver(([entry]) => {
            setHeaderHeight(entry.target.getBoundingClientRect().height);
        });

        observer.observe(header);
        return () => observer.disconnect();
    }, []);

    // Sizes the columns to the room the page gives the grid, less the frozen
    // column, the container's border and any vertical scrollbar
    useEffect(() => {
        const scroller = scrollerRef.current;
        const container = frameRef.current?.parentElement;
        if (!scroller || !container) return;

        const observer = new ResizeObserver(() => {
            const scrollbar = scroller.offsetWidth - scroller.clientWidth - CONTAINER_BORDER;

            setRoom(container.clientWidth - CONTAINER_BORDER - scrollbar - STUDENT_COLUMN_WIDTH);
        });

        observer.observe(container);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, []);

    const { columnWidth, overflows } = gridLayout(room, assignments.length);
    const studentWidth = STUDENT_COLUMN_WIDTH;
    const studentColumnStyle = { width: studentWidth, minWidth: studentWidth, maxWidth: studentWidth };
    const columnStyle = { width: columnWidth, minWidth: columnWidth, maxWidth: columnWidth };
    const assignmentCount = assignments.length;

    // Follows the scroll, by any means, once per frame: the shaded edges, the
    // scrollbars they stay clear of, and the columns in view
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;

        let frame = 0;

        function measure() {
            frame = 0;
            if (!scroller) return;

            const maxScroll = scroller.scrollWidth - scroller.clientWidth;
            const start = scroller.scrollLeft <= 1;
            const end = scroller.scrollLeft >= maxScroll - 1;
            const view: ColumnView | null = overflows
                ? {
                      ...columnsInView(
                          scroller.scrollLeft,
                          scroller.clientWidth - STUDENT_COLUMN_WIDTH,
                          columnWidth,
                          assignmentCount
                      ),
                      atStart: start,
                      atEnd: end,
                  }
                : null;

            setAtStart(start);
            setAtEnd(end);
            setAtBottom(scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1);
            setScrollbarWidth(scroller.offsetWidth - scroller.clientWidth - CONTAINER_BORDER);
            setScrollbarHeight(scroller.offsetHeight - scroller.clientHeight - CONTAINER_BORDER);

            if (!sameView(view, reportedView.current)) {
                reportedView.current = view;
                onColumnViewChange?.(view);
            }
        }

        function schedule() {
            if (!frame) frame = requestAnimationFrame(measure);
        }

        const observer = new ResizeObserver(schedule);
        observer.observe(scroller);
        if (tableRef.current) observer.observe(tableRef.current);
        scroller.addEventListener("scroll", schedule, { passive: true });
        schedule();

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            scroller.removeEventListener("scroll", schedule);
        };
    }, [overflows, columnWidth, assignmentCount, onColumnViewChange]);

    useImperativeHandle(
        ref,
        () => ({
            scrollColumns(step) {
                const scroller = scrollerRef.current;
                if (!scroller) return;

                const current = Math.round(scroller.scrollLeft / columnWidth);
                const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

                scroller.scrollTo({ left: (current + step) * columnWidth, behavior: still ? "auto" : "smooth" });
            },
        }),
        [columnWidth]
    );

    /** Returns whether a grid position holds something to focus. */
    function isFocusable({ row, col }: GridPosition): boolean {
        if (col < 0 || col >= assignments.length) return false;
        if (row === -1) return true;

        return row >= 0 && row < students.length && students[row].cells[col] !== null;
    }

    const firstCell = moveInGrid(
        { row: 0, col: 0 },
        "Home",
        { rows: students.length, cols: assignments.length, toGridEnds: true },
        isFocusable
    );
    const tabStop =
        active && isFocusable(active)
            ? active
            : firstCell ?? (assignments.length > 0 ? { row: -1, col: 0 } : null);

    /** Returns 0 for the grid's one Tab stop and -1 for every other cell. */
    function tabIndexAt(row: number, col: number): number {
        return tabStop?.row === row && tabStop.col === col ? 0 : -1;
    }

    /** Moves focus between cells with the arrow keys, Home and End. */
    function handleKeyDown(event: KeyboardEvent<HTMLTableElement>) {
        if (!GRID_KEYS.includes(event.key)) return;

        const from = positionOf(event.target as HTMLElement);
        if (!from) return;

        const next = moveInGrid(
            from,
            event.key as GridKey,
            {
                rows: students.length,
                cols: assignments.length,
                toGridEnds: event.ctrlKey || event.metaKey,
            },
            isFocusable
        );

        event.preventDefault();
        if (!next) return;

        tableRef.current
            ?.querySelector<HTMLElement>(`[data-grid-row="${next.row}"][data-grid-col="${next.col}"]`)
            ?.focus();
    }

    /** Makes a focused cell the Tab stop and shows it clear of the frozen header and column. */
    function handleFocus(event: FocusEvent<HTMLTableElement>) {
        const position = positionOf(event.target as HTMLElement);
        if (!position) return;

        setActive(position);
        revealInGrid(event.target);
    }

    const shadeInset = { top: 1, bottom: 1 + scrollbarHeight };

    return (
        <div
            ref={frameRef}
            className="relative isolate flex min-h-0 max-w-full shrink flex-col self-start overflow-hidden rounded-lg"
        >
            <div
                ref={scrollerRef}
                id={GRID_SCROLLER_ID}
                className="relative min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-gray-900"
                style={{
                    scrollPaddingTop: headerHeight,
                    scrollPaddingLeft: studentWidth,
                    scrollSnapType: overflows ? "both mandatory" : "y mandatory",
                }}
            >
                <p id={HINT_ID} className="sr-only">
                    Use the arrow keys to move between grades, and Enter to open one.
                </p>

                <table
                    ref={tableRef}
                    onKeyDown={handleKeyDown}
                    onFocus={handleFocus}
                    className="border-separate border-spacing-0 text-sm"
                >
                    <caption className="sr-only">
                        {`Grades for ${courseName}. Each row is a student and each column an assignment. Use the arrow keys to move between grades, and Enter to open one.`}
                    </caption>

                    <thead ref={headerRef}>
                        <tr>
                            <th
                                scope="col"
                                style={studentColumnStyle}
                                className={`sticky left-0 top-0 z-30 border-r bg-gray-50 px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-gray-700 dark:bg-gray-800 dark:text-zinc-200 ${stickyCellBase}`}
                            >
                                Student
                            </th>

                            {assignments.map((assignment, col) => {
                                const href = `/classes/${gradebook.class.id}/assignments/${assignment.id}`;
                                const columnFilter = filter?.assignmentId === assignment.id ? filter.filter : null;

                                return (
                                    <th
                                        key={assignment.id}
                                        scope="col"
                                        style={{ ...columnStyle, scrollSnapAlign: "none start" }}
                                        className={`sticky top-0 z-20 border-l px-2 py-1.5 text-left align-top font-normal ${stickyCellBase} ${
                                            columnFilter ? filteredHeader : "bg-gray-50 dark:bg-gray-800"
                                        }`}
                                    >
                                        {/* The menu's Open assignment page item takes this link's place for the keyboard */}
                                        <Link
                                            href={href}
                                            title={`${assignment.name} (out of ${assignment.points})`}
                                            tabIndex={-1}
                                            className="line-clamp-3 break-words rounded-sm text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
                                        >
                                            {assignment.name}
                                        </Link>

                                        <span className="sr-only">Out of {assignment.points}.</span>

                                        <p className="text-sm leading-5 text-gray-700 dark:text-zinc-300">
                                            {shortDue(assignment)}
                                        </p>

                                        <ColumnFilterMenu
                                            assignment={assignment}
                                            href={href}
                                            counts={filterCounts(gradebook.students, col)}
                                            active={columnFilter}
                                            onChoose={(chosen: StudentFilter | null) =>
                                                onFilterChange(
                                                    chosen ? { assignmentId: assignment.id, filter: chosen } : null
                                                )
                                            }
                                            tabIndex={tabIndexAt(-1, col)}
                                            col={col}
                                            className={`${headerButton} ${headerFocusRing}`}
                                        />
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {students.map((student, row) => {
                            const name = displayStudentName(student);

                            return (
                                <tr key={student.id} className="group" style={{ scrollSnapAlign: "start none" }}>
                                    <th
                                        scope="row"
                                        style={studentColumnStyle}
                                        className={`sticky left-0 z-10 border-r px-3 py-1 text-left align-middle font-normal ${stickyCellBase} ${bodyBackground}`}
                                    >
                                        <StudentHeader student={student} />
                                    </th>

                                    {assignments.map((assignment, col) => {
                                        const cell = student.cells[col];
                                        const display = describeCell(
                                            cell,
                                            assignment,
                                            canGradeSubmissions
                                        );
                                        const key = { studentId: student.id, assignmentId: assignment.id };
                                        const isSelected =
                                            selected?.studentId === student.id &&
                                            selected.assignmentId === assignment.id;

                                        return (
                                            <td
                                                key={assignment.id}
                                                className={`border-l p-px align-middle ${stickyCellBase} ${bodyBackground}`}
                                            >
                                                {cell ? (
                                                    <button
                                                        type="button"
                                                        aria-haspopup="dialog"
                                                        aria-label={`${display.srText}. ${name}, ${assignment.name}`}
                                                        aria-describedby={HINT_ID}
                                                        tabIndex={tabIndexAt(row, col)}
                                                        data-grid-row={row}
                                                        data-grid-col={col}
                                                        data-cell={cellDataKey(key)}
                                                        onClick={() => onSelect(key)}
                                                        className={`flex min-h-10 w-full items-center justify-center rounded-md px-1 py-1 ${cellInteraction} ${focusRing} ${
                                                            isSelected
                                                                ? "bg-blue-50 ring-2 ring-inset ring-blue-500 dark:bg-blue-950 dark:ring-blue-400"
                                                                : ""
                                                        }`}
                                                    >
                                                        <GradeCellContent display={display} points={assignment.points} />
                                                    </button>
                                                ) : (
                                                    <span className="flex min-h-10 items-center justify-center text-base text-gray-500 dark:text-zinc-400">
                                                        <span aria-hidden="true">–</span>
                                                        <span className="sr-only">{display.srText}</span>
                                                    </span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}

                        {students.length === 0 && (
                            <tr>
                                <td colSpan={assignments.length + 1} className={stickyCellBase}>
                                    <div className="sticky left-0 flex w-fit flex-wrap items-center gap-x-3 gap-y-1 px-3 py-4">
                                        <p className="font-medium text-gray-900 dark:text-white">No students match</p>
                                        <button
                                            type="button"
                                            onClick={() => onFilterChange(null)}
                                            className={`rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950 ${headerFocusRing}`}
                                        >
                                            Show all students
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {overflows && !atStart && (
                <div
                    aria-hidden="true"
                    data-shade="start"
                    className="pointer-events-none absolute z-40 w-4 bg-linear-to-r from-gray-900/15 to-transparent dark:from-black/60"
                    style={{ ...shadeInset, left: 1 + studentWidth }}
                />
            )}

            {!atBottom && (
                <div
                    aria-hidden="true"
                    data-shade="bottom"
                    className="pointer-events-none absolute z-40 h-6 bg-linear-to-t from-gray-900/15 to-transparent dark:from-black/60"
                    style={{ left: 1, right: 1 + scrollbarWidth, bottom: 1 + scrollbarHeight }}
                />
            )}

            {overflows && !atEnd && (
                <div
                    aria-hidden="true"
                    data-shade="end"
                    className="pointer-events-none absolute z-40 w-6 bg-linear-to-l from-gray-900/15 to-transparent dark:from-black/60"
                    style={{ ...shadeInset, right: 1 + scrollbarWidth }}
                />
            )}
        </div>
    );
}
