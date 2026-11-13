"use client";

import { createContext, useContext } from "react";

/**
 * The right-hand end of the phone top bar, published while that bar is on
 * screen.
 *
 * A page that owns a control for the bar portals it into this slot instead of
 * floating one over the bar. A floating control is placed by constants, so it
 * lands on top of whatever the bar already draws: the ☰ course toggle parked at
 * `left-12` sat squarely on the "Panel" wordmark (END-179). In the slot the
 * bar's own flex row does the placing, which cannot collide at any width.
 *
 * One control at a time: a second consumer would have to share this box, so it
 * needs an ordering rule before anyone adds one.
 */
export const TopbarActionsContext = createContext<HTMLDivElement | null>(null);

/** Where the page should portal its own phone control, or `null` for no bar. */
export function useTopbarActions(): HTMLDivElement | null {
  return useContext(TopbarActionsContext);
}
