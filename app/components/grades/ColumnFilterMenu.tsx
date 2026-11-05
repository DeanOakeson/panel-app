"use client";

import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
    filterLabel,
    gradingProgress,
    STUDENT_FILTERS,
    type GradebookAssignment,
    type StudentFilter,
} from "@/lib/gradebook";

type Props = {
    assignment: GradebookAssignment;
    /** The assignment's page, which the menu also offers. */
    href: string;
    /** How many students each filter matches on this assignment. */
    counts: Record<StudentFilter, number>;
    /** The filter applied to this column, or null when it shows every student. */
    active: StudentFilter | null;
    /** Applies a filter to this column, or null to show every student. */
    onChoose: (filter: StudentFilter | null) => void;
    /** The grid's roving tab index and position, which make the button one of its stops. */
    tabIndex: number;
    col: number;
    className: string;
};

/** The gap between the button and its menu, and the menu and the window's edges, in pixels. */
const MENU_GAP = 4;

/** The progress bar's fill and the count line's color for each grading state. */
const PROGRESS_STYLE = {
    "to-grade": { fill: "bg-amber-500 dark:bg-amber-400", text: "font-semibold text-amber-700 dark:text-amber-400" },
    "all-graded": { fill: "bg-green-600 dark:bg-green-500", text: "font-semibold text-green-700 dark:text-green-400" },
    "none-turned-in": { fill: "", text: "text-gray-600 dark:text-zinc-300" },
} as const;

/** Returns how a screen reader hears the column's grading, like "5 of 6 graded, 1 to grade". */
function spokenProgress({ grading }: GradebookAssignment): string {
    const progress = gradingProgress(grading);

    switch (progress.state) {
        case "to-grade":
            return `${progress.label}, ${progress.toGrade} to grade`;
        case "all-graded":
            return `${progress.label}, all graded`;
        case "none-turned-in":
            return "none turned in";
    }
}

/** Places a menu under its button, or above it when the window has no room below, inside the window. */
function placeMenu(menu: HTMLElement, button: HTMLElement) {
    const anchor = button.getBoundingClientRect();
    const below = anchor.bottom + MENU_GAP;
    const fitsBelow = below + menu.offsetHeight <= window.innerHeight - MENU_GAP;
    const top = fitsBelow ? below : Math.max(MENU_GAP, anchor.top - MENU_GAP - menu.offsetHeight);
    const left = Math.min(anchor.left, window.innerWidth - MENU_GAP - menu.offsetWidth);

    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(MENU_GAP, left)}px`;
}

/** Shows a small chevron pointing down. */
function ChevronDownIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
    );
}

/** Shows a funnel, which marks a filtered column. */
function FunnelIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
            <path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 .8 1.6L12 10.9V16a1 1 0 0 1-1.5.9l-2-1.2A1 1 0 0 1 8 14.8v-3.9L3.2 4.6A1 1 0 0 1 3 4Z" />
        </svg>
    );
}

/** Shows a check mark beside the chosen filter. */
function CheckIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
        </svg>
    );
}

const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 outline-none hover:bg-gray-100 focus:bg-blue-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 aria-disabled:cursor-not-allowed aria-disabled:text-gray-400 aria-disabled:hover:bg-transparent dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus:bg-blue-950 dark:focus-visible:outline-blue-400 dark:aria-disabled:text-zinc-500";

/**
 * Shows a column's grading progress, a bar with a count like "5 of 6 graded",
 * as a menu button that filters the grid's students by their work on the
 * assignment. Enter, Space or Alt+Down opens
 * the menu, whose items the arrow keys move between. Escape, Tab or a click
 * outside closes it, and choosing an item puts focus back on the button.
 */
export default function ColumnFilterMenu({
    assignment,
    href,
    counts,
    active,
    onChoose,
    tabIndex,
    col,
    className,
}: Props) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const progress = gradingProgress(assignment.grading);
    const style = PROGRESS_STYLE[progress.state];
    const percent = progress.turnedIn === 0 ? 0 : (progress.graded / progress.turnedIn) * 100;
    const filtering = active !== null;

    /** Returns the menu's items in order. */
    function items(): HTMLElement[] {
        return Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);
    }

    /** Closes the menu, putting focus back on its button unless the person moved elsewhere. */
    function close(refocus: boolean) {
        setOpen(false);
        if (refocus) buttonRef.current?.focus();
    }

    // Places the menu at its button and focuses the chosen item, or the first
    useLayoutEffect(() => {
        const button = buttonRef.current;
        const menu = menuRef.current;
        if (!open || !button || !menu) return;

        placeMenu(menu, button);

        const all = Array.from(menu.querySelectorAll<HTMLElement>("[role^='menuitem']"));
        (all.find((item) => item.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
    }, [open]);

    // Closes on a click outside, and keeps the menu at its button as the page scrolls or resizes
    useEffect(() => {
        if (!open) return;

        function onPointerDown(event: PointerEvent) {
            const target = event.target as Node;

            if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
                setOpen(false);
            }
        }

        function follow() {
            if (menuRef.current && buttonRef.current) placeMenu(menuRef.current, buttonRef.current);
        }

        document.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("scroll", follow, true);
        window.addEventListener("resize", follow);

        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("scroll", follow, true);
            window.removeEventListener("resize", follow);
        };
    }, [open]);

    /** Opens the menu with Alt+Down, leaving plain Down to move through the grid. */
    function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
        }
    }

    /** Moves between the menu's items, and closes it with Escape or Tab. */
    function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const all = items();
        const current = all.indexOf(document.activeElement as HTMLElement);
        const focusAt = (index: number) => all[(index + all.length) % all.length]?.focus();

        switch (event.key) {
            case "ArrowDown":
                focusAt(current + 1);
                break;
            case "ArrowUp":
                focusAt(current - 1);
                break;
            case "Home":
                focusAt(0);
                break;
            case "End":
                focusAt(all.length - 1);
                break;
            case "Escape":
            case "Tab":
                close(true);
                break;
            case " ":
                // Space presses a button by itself, but not a link
                if (!(document.activeElement instanceof HTMLAnchorElement)) return;
                document.activeElement.click();
                break;
            default:
                return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    /** Applies a filter unless its item is disabled, then closes the menu. */
    function choose(filter: StudentFilter | null, disabled: boolean) {
        if (disabled) return;

        onChoose(filter);
        close(true);
    }

    const filteredText = filtering ? `, showing ${filterLabel(active).toLowerCase()}` : "";

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={`Filter students by ${assignment.name}, ${spokenProgress(assignment)}${filteredText}`}
                title="Filter students by this assignment"
                tabIndex={tabIndex}
                data-grid-row={-1}
                data-grid-col={col}
                data-filter-for={assignment.id}
                onClick={() => setOpen(!open)}
                onKeyDown={handleButtonKeyDown}
                className={className}
            >
                <span className="block h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
                    <span className={`block h-full rounded-full ${style.fill}`} style={{ width: `${percent}%` }} />
                </span>

                <span className="mt-1.5 flex items-center gap-0.5">
                    <span className={`min-w-0 flex-1 truncate text-xs leading-4 ${style.text}`}>{progress.label}</span>
                    <span
                        className={`flex shrink-0 ${
                            filtering ? "text-blue-700 dark:text-blue-300" : "text-gray-500 dark:text-zinc-400"
                        }`}
                    >
                        {filtering ? <FunnelIcon /> : <ChevronDownIcon />}
                    </span>
                </span>
            </button>

            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        id={menuId}
                        role="menu"
                        aria-label={`Filter students by ${assignment.name}`}
                        onKeyDown={handleMenuKeyDown}
                        className="fixed z-50 min-w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-gray-900"
                    >
                        {STUDENT_FILTERS.map((option) => {
                            const count = counts[option.value];
                            const disabled = count === 0;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={active === option.value}
                                    aria-disabled={disabled}
                                    aria-label={`${option.label}, ${count} ${count === 1 ? "student" : "students"}`}
                                    tabIndex={-1}
                                    onClick={() => choose(option.value, disabled)}
                                    className={itemClass}
                                >
                                    <span className="w-4">{active === option.value && <CheckIcon />}</span>
                                    <span className="flex-1">{option.label}</span>
                                    <span className="tabular-nums text-gray-600 dark:text-zinc-300">{count}</span>
                                </button>
                            );
                        })}

                        <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={!filtering}
                            tabIndex={-1}
                            onClick={() => choose(null, false)}
                            className={itemClass}
                        >
                            <span className="w-4">{!filtering && <CheckIcon />}</span>
                            <span className="flex-1">All students</span>
                        </button>

                        <div role="separator" className="my-1 border-t border-gray-200 dark:border-zinc-700" />

                        <Link role="menuitem" href={href} tabIndex={-1} className={itemClass}>
                            <span className="w-4" />
                            <span className="flex-1">Open assignment page</span>
                        </Link>
                    </div>,
                    document.body
                )}
        </>
    );
}
