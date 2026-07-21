// Mobile tab gestures: a horizontal swipe across the main area moves to the
// adjacent tab, so the apps navigate the way a phone / iPad user expects.
// Shared byte-for-byte with the sibling app.

import { useRef, type TouchEvent } from "react";

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: TouchEvent<HTMLElement>) => void;
}

/** Minimum horizontal travel, and how far it must beat vertical travel, for a
 *  drag to count as a tab swipe rather than a scroll. */
const MIN_DX = 60;
const H_OVER_V = 1.4;

/**
 * Horizontal swipe → tab change: onSwipe(1) on a left swipe (next tab),
 * onSwipe(-1) on a right swipe (previous). Ignores multi-touch, vertical
 * scrolls, and gestures that start on a control where a horizontal drag already
 * means something — inputs, the number steppers, or anything inside a modal
 * sheet or otherwise marked `data-noswipe`.
 */
export function useSwipeNav(onSwipe: (dir: -1 | 1) => void, enabled = true): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e) => {
      start.current = null;
      if (!enabled || e.touches.length !== 1) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, .stepper, [data-noswipe]")) return;
      const touch = e.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (e) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * H_OVER_V) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
