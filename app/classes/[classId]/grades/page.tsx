"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { DEADLINE_TIME_ZONE } from "@/lib/assignmentDeadline";
import { onGradeSaved } from "@/lib/gradeEvents";
import { useStoredFlag } from "@/lib/storedFlag";
import {
    filterLabel,
    filterStudents,
    STUDENT_FILTERS,
    type Gradebook,
    type GradebookFilter,
} from "@/lib/gradebook";
import ColumnPager from "../../../components/grades/ColumnPager";
import GradebookLegend from "../../../components/grades/GradebookLegend";
import GradebookTable, {
    cellDataKey,
    GRID_SCROLLER_ID,
    revealInGrid,
    type CellKey,
    type ColumnView,
    type GradebookTableHandle,
} from "../../../components/grades/GradebookTable";
import GradeDetailsPanel, {
    type CellDetails,
} from "../../../components/grades/GradeDetailsPanel";
import StudentGradesPointer from "../../../components/grades/StudentGradesPointer";

type PageState =
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "forbidden"; message: string }
    | { kind: "student" }
    | { kind: "ready"; gradebook: Gradebook };

/** Where the browser remembers whether the professor hid the key. */
const KEY_HIDDEN_STORAGE = "panel-gradebook-key-hidden";

const LEGEND_ID = "gradebook-key";

/** Where the tab remembers a class's column filter, so it outlasts a trip to grade work. */
const FILTER_STORAGE_PREFIX = "panel-gradebook-filter:";

const HINT = "Select a grade for details · Select a column's status to filter · Arrow keys move";

/** How long after a load the page waits before refreshing on focus. */
const FOCUS_REFRESH_INTERVAL = 30_000;

const secondaryButtonClass =
    "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 dark:border-zinc-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-zinc-800";

/** Formats a load time like "3:05 PM MT". */
function formatLoadedAt(time: number): string {
    const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: DEADLINE_TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(time));

    return `${formatted} MT`;
}

/** Returns "1 student" or "2 students". */
function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Returns the column filter this tab stored for a gradebook's class. A filter
 * for an assignment the gradebook no longer has is dropped and forgotten.
 */
function readStoredFilter(gradebook: Gradebook): GradebookFilter | null {
    const key = FILTER_STORAGE_PREFIX + gradebook.class.id;

    try {
        const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
        const valid =
            gradebook.assignments.some((assignment) => assignment.id === stored?.assignmentId) &&
            STUDENT_FILTERS.some((option) => option.value === stored?.filter);

        if (valid) return { assignmentId: stored.assignmentId, filter: stored.filter };

        window.sessionStorage.removeItem(key);
    } catch {
        // Blocked or unreadable storage holds no filter
    }

    return null;
}

/** Remembers a class's column filter for this tab, or forgets it for null. */
function storeFilter(classId: string, filter: GradebookFilter | null) {
    const key = FILTER_STORAGE_PREFIX + classId;

    try {
        if (filter) {
            window.sessionStorage.setItem(key, JSON.stringify(filter));
        } else {
            window.sessionStorage.removeItem(key);
        }
    } catch {
        // The filter then lasts only while the page is open
    }
}

/** Returns the open cell with its student and assignment, or null when it no longer exists. */
function findDetails(gradebook: Gradebook, key: CellKey | null): CellDetails | null {
    if (!key) return null;

    const student = gradebook.students.find((row) => row.id === key.studentId);
    const index = gradebook.assignments.findIndex(
        (assignment) => assignment.id === key.assignmentId
    );
    const cell = student && index >= 0 ? student.cells[index] : null;

    return student && cell ? { student, assignment: gradebook.assignments[index], cell } : null;
}

/**
 * Shows the course's gradebook to its professor and admins, a pointer to the
 * assignments to a student, and a no-permission message to anyone else. The
 * grid refreshes when a grade is saved in another tab and on returning to the page.
 */
export default function GradesPage() {
    const { classId } = useParams<{ classId: string }>();
    const router = useRouter();

    const [state, setState] = useState<PageState>({ kind: "loading" });
    const [loadedAt, setLoadedAt] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState("");
    const [selected, setSelected] = useState<CellKey | null>(null);
    const latestRequest = useRef(0);
    const lastLoadTime = useRef(0);

    /**
     * Loads the gradebook. A background load keeps the current grid on screen
     * and reports a failure beside it. Only the latest request's answer is used.
     */
    const load = useCallback(
        async (user: User, background: boolean) => {
            const request = ++latestRequest.current;

            if (background) {
                setRefreshing(true);
            } else {
                setState({ kind: "loading" });
            }

            try {
                const token = await user.getIdToken();
                const headers = { Authorization: `Bearer ${token}` };
                const [gradebookResponse, profileResponse] = await Promise.all([
                    fetch(`/api/classes/${classId}/gradebook`, { headers, cache: "no-store" }),
                    background ? null : fetch("/api/users", { headers, cache: "no-store" }),
                ]);

                if (request !== latestRequest.current) return;

                if (profileResponse) {
                    if (!profileResponse.ok) {
                        throw new Error("Failed to load your user profile.");
                    }

                    const profile: { role?: string } = await profileResponse.json();

                    if (profile.role === "student") {
                        setState({ kind: "student" });
                        return;
                    }
                }

                const data = await gradebookResponse.json();

                if (request !== latestRequest.current) return;

                if (gradebookResponse.status === 403) {
                    setState({
                        kind: "forbidden",
                        message: data.error || "You do not have permission to view these grades.",
                    });
                    return;
                }

                if (!gradebookResponse.ok) {
                    throw new Error(data.error || "Failed to load the gradebook.");
                }

                setState({ kind: "ready", gradebook: data });
                setLoadedAt(Date.now());
                setRefreshError("");
            } catch (error) {
                if (request !== latestRequest.current) return;

                const message =
                    error instanceof Error ? error.message : "Something went wrong.";

                if (background) {
                    setRefreshError(message);
                } else {
                    setState({ kind: "error", message });
                }
            } finally {
                if (request === latestRequest.current) {
                    lastLoadTime.current = Date.now();
                    setRefreshing(false);
                }
            }
        },
        [classId]
    );

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }

            void load(user, false);
        });

        return unsubscribe;
    }, [load, router]);

    const showsGradebook = state.kind === "ready";

    // Refreshes when another tab saves a grade, and on coming back to a page
    // that has not loaded for a while
    useEffect(() => {
        if (!showsGradebook) return;

        function refresh() {
            const user = getFirebaseAuth().currentUser;

            if (user) void load(user, true);
        }

        function refreshIfStale() {
            if (
                document.visibilityState === "visible" &&
                Date.now() - lastLoadTime.current > FOCUS_REFRESH_INTERVAL
            ) {
                refresh();
            }
        }

        const stopListening = onGradeSaved(classId, refresh);
        window.addEventListener("focus", refreshIfStale);
        document.addEventListener("visibilitychange", refreshIfStale);

        return () => {
            stopListening();
            window.removeEventListener("focus", refreshIfStale);
            document.removeEventListener("visibilitychange", refreshIfStale);
        };
    }, [classId, load, showsGradebook]);

    /** Loads the gradebook again, in the background when it is already on screen. */
    function reload() {
        const user = getFirebaseAuth().currentUser;

        if (user) void load(user, state.kind === "ready");
    }

    /**
     * Clears the open cell and puts focus back on its button, or on the grid
     * when a filter no longer shows the cell's row.
     */
    function handlePanelClosed() {
        if (selected) {
            const cell =
                document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellDataKey(selected))}"]`) ??
                document.querySelector<HTMLElement>(`#${GRID_SCROLLER_ID} [data-grid-row][tabindex="0"]`);

            cell?.focus({ preventScroll: true });
            if (cell) revealInGrid(cell);
        }

        setSelected(null);
    }

    const gradebook = state.kind === "ready" ? state.gradebook : null;

    return (
        <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3">
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Grades</h1>

                    {gradebook && <CourseLine gradebook={gradebook} />}
                </div>

                {gradebook && (
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-gray-600 dark:text-zinc-300">
                            {refreshing
                                ? "Refreshing..."
                                : loadedAt !== null && `Updated ${formatLoadedAt(loadedAt)}`}
                        </p>

                        <button
                            type="button"
                            onClick={reload}
                            disabled={refreshing}
                            className={secondaryButtonClass}
                        >
                            Refresh
                        </button>
                    </div>
                )}
            </header>

            {refreshError && (
                <p
                    role="status"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                >
                    {`Could not refresh: ${refreshError} Showing grades from ${
                        loadedAt !== null ? formatLoadedAt(loadedAt) : "earlier"
                    }.`}
                </p>
            )}

            {state.kind === "loading" ? (
                <p className="text-gray-600 dark:text-gray-300">Loading grades...</p>
            ) : state.kind === "error" ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
                    <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>

                    <button
                        type="button"
                        onClick={reload}
                        className="mt-2 text-sm font-semibold text-red-700 underline dark:text-red-300"
                    >
                        Try again
                    </button>
                </div>
            ) : state.kind === "forbidden" ? (
                <p className="rounded-lg border border-gray-200 bg-white p-6 text-gray-600 dark:border-zinc-800 dark:bg-gray-900 dark:text-zinc-300">
                    {state.message}
                </p>
            ) : state.kind === "student" ? (
                <StudentGradesPointer classId={classId} />
            ) : (
                <GradebookView
                    gradebook={state.gradebook}
                    selected={selected}
                    onSelect={setSelected}
                />
            )}

            {gradebook && (
                <GradeDetailsPanel
                    classId={classId}
                    details={findDetails(gradebook, selected)}
                    canGradeSubmissions={gradebook.canGradeSubmissions}
                    onClose={handlePanelClosed}
                />
            )}
        </div>
    );
}

/** Shows the course code, name, term and section under the page title. */
function CourseLine({ gradebook }: { gradebook: Gradebook }) {
    const course = gradebook.class;
    const term = [course.term, course.year].filter(Boolean).join(" ");
    const details = [term, course.section && `Section ${course.section}`].filter(Boolean);

    return (
        <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">
            <span className="font-medium text-gray-900 dark:text-white">
                {[course.courseCode, course.name].filter(Boolean).join(" · ")}
            </span>
            {details.length > 0 && ` · ${details.join(" · ")}`}
        </p>
    );
}

/** Shows the counts above the grid: students, assignments and work to grade. */
function Summary({ gradebook }: { gradebook: Gradebook }) {
    const enrolled = gradebook.students.filter((student) => student.enrolled).length;
    const left = gradebook.students.length - enrolled;
    const toGrade = gradebook.assignments.reduce(
        (total, assignment) => total + assignment.grading.toGrade,
        0
    );

    const parts = [
        plural(enrolled, "student"),
        ...(left > 0 ? [`${left} no longer enrolled`] : []),
        plural(gradebook.assignments.length, "assignment"),
    ];

    return (
        <p className="text-sm text-gray-700 dark:text-zinc-300">
            {parts.join(" · ")}
            {" · "}
            {toGrade > 0 ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {`${plural(toGrade, "submission")} to grade`}
                </span>
            ) : (
                <span className="font-semibold text-green-700 dark:text-green-400">
                    Nothing to grade
                </span>
            )}
        </p>
    );
}

/** Shows an empty state's message, with an optional link. */
function EmptyState({
    title,
    body,
    link,
}: {
    title: string;
    body: string;
    link?: { href: string; label: string };
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-gray-900">
            <p className="font-medium text-gray-900 dark:text-white">{title}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">{body}</p>

            {link && (
                <Link
                    href={link.href}
                    className="mt-3 inline-block text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                    {link.label}
                </Link>
            )}
        </div>
    );
}

/**
 * Shows which students a column filter leaves in the grid, with a button
 * that shows them all again.
 */
function FilterStatus({
    gradebook,
    filter,
    shown,
    onClear,
}: {
    gradebook: Gradebook;
    filter: GradebookFilter;
    shown: number;
    onClear: () => void;
}) {
    const assignment = gradebook.assignments.find((each) => each.id === filter.assignmentId);

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-blue-50 py-1 pl-3 pr-1 text-sm text-blue-950 dark:bg-blue-950 dark:text-blue-100">
            <p>
                {`Showing ${plural(shown, "student")} · `}
                <span className="font-semibold">{filterLabel(filter.filter)}</span>
                {` · ${assignment?.name ?? ""}`}
            </p>

            <button
                type="button"
                onClick={onClear}
                className="rounded-md px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:bg-blue-900"
            >
                Show all students
            </button>
        </div>
    );
}

/**
 * Shows the gradebook's summary, key and grid, or the empty state that fits.
 * While the grid scrolls sideways, the toolbar shows which assignments are in
 * view with buttons that move between them. A column filter, which this tab
 * remembers per class, limits the rows and is announced as it changes.
 */
function GradebookView({
    gradebook,
    selected,
    onSelect,
}: {
    gradebook: Gradebook;
    selected: CellKey | null;
    onSelect: (key: CellKey) => void;
}) {
    const assignmentsHref = `/classes/${gradebook.class.id}/assignments`;
    const hasStudents = gradebook.students.length > 0;
    const hasAssignments = gradebook.assignments.length > 0;
    const hasDropped = gradebook.students.some((student) =>
        student.cells.some((cell) => cell === null)
    );
    const [keyHidden, setKeyHidden] = useStoredFlag(KEY_HIDDEN_STORAGE);
    const [columnView, setColumnView] = useState<ColumnView | null>(null);
    const [storedFilter, setStoredFilter] = useState(() => readStoredFilter(gradebook));
    const [announcement, setAnnouncement] = useState("");
    const tableRef = useRef<GradebookTableHandle>(null);
    const filter =
        storedFilter && gradebook.assignments.some((assignment) => assignment.id === storedFilter.assignmentId)
            ? storedFilter
            : null;
    const shown = filterStudents(gradebook, filter).length;

    /**
     * Applies a column filter, or clears it with null, and announces the rows
     * it leaves. Clearing puts focus on the column's filter button.
     */
    function changeFilter(next: GradebookFilter | null) {
        const cleared = filter;

        setStoredFilter(next);
        storeFilter(gradebook.class.id, next);

        if (next) {
            const assignment = gradebook.assignments.find((each) => each.id === next.assignmentId);
            const count = filterStudents(gradebook, next).length;

            setAnnouncement(`Showing ${plural(count, "student")}: ${filterLabel(next.filter)} on ${assignment?.name}.`);
            return;
        }

        setAnnouncement("Showing all students.");

        if (cleared) {
            requestAnimationFrame(() =>
                document
                    .querySelector<HTMLElement>(`[data-filter-for="${CSS.escape(cleared.assignmentId)}"]`)
                    ?.focus()
            );
        }
    }

    if (!hasStudents && !hasAssignments) {
        return (
            <EmptyState
                title="No students or assignments yet."
                body="Grades appear here once students enroll and assignments are created."
                link={{ href: assignmentsHref, label: "Go to assignments" }}
            />
        );
    }

    if (!hasStudents) {
        return (
            <EmptyState
                title="No students are enrolled yet."
                body={`This course has ${plural(gradebook.assignments.length, "assignment")}. Grades appear here once students enroll.`}
            />
        );
    }

    return (
        <>
            <p role="status" className="sr-only">
                {announcement}
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Summary gradebook={gradebook} />

                {filter && (
                    <FilterStatus
                        gradebook={gradebook}
                        filter={filter}
                        shown={shown}
                        onClear={() => changeFilter(null)}
                    />
                )}

                {hasAssignments && (
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                        <ColumnPager
                            view={columnView}
                            controls={GRID_SCROLLER_ID}
                            onStep={(step) => tableRef.current?.scrollColumns(step)}
                        />

                        {keyHidden && (
                            <p aria-hidden="true" className="text-sm text-gray-600 dark:text-zinc-300">
                                {HINT}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={() => setKeyHidden(!keyHidden)}
                            aria-expanded={!keyHidden}
                            aria-controls={keyHidden ? undefined : LEGEND_ID}
                            className="-my-1 rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:bg-blue-950"
                        >
                            {keyHidden ? "Show key" : "Hide key"}
                        </button>
                    </div>
                )}
            </div>

            {!gradebook.canGradeSubmissions && (
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                    You are viewing as an admin. You can grade missing work, but only the
                    course&apos;s professor grades submissions.
                </p>
            )}

            {hasAssignments ? (
                !keyHidden && <GradebookLegend id={LEGEND_ID} showDropped={hasDropped} hint={HINT} />
            ) : (
                <EmptyState
                    title="No assignments yet."
                    body="Grades appear here once the course has an assignment."
                    link={{
                        href: assignmentsHref,
                        label: gradebook.canGradeSubmissions
                            ? "Create an assignment"
                            : "Go to assignments",
                    }}
                />
            )}

            <GradebookTable
                ref={tableRef}
                gradebook={gradebook}
                selected={selected}
                onSelect={onSelect}
                filter={filter}
                onFilterChange={changeFilter}
                onColumnViewChange={setColumnView}
            />
        </>
    );
}
