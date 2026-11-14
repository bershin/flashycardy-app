/**
 * The checks every app-wide shortcut makes before acting on a key.
 *
 * Shared so the global keys and the dashboard's deck keys agree on when to
 * stay out of the way: a letter typed into a card, a todo or the search box is
 * text, and a key pressed while a dialog or menu is open belongs to it.
 */

/** Whether the key landed somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Whether a dialog, confirmation or menu is open and owns the keyboard. */
export function overlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"]',
    ) !== null
  );
}

/**
 * Whether a plain key press is free for a shortcut.
 *
 * Modified presses are left alone so the browser's own (Cmd+[, Ctrl+F, …) keep
 * working. Shift is allowed, since "?" needs it.
 */
export function shortcutAllowed(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTypingTarget(e.target)) return false;
  if (overlayOpen()) return false;
  return true;
}
