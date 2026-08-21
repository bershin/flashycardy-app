/**
 * Dragging a day's item onto another day.
 *
 * The list lives in the panel below the grid and the days are squares above it,
 * so the drag crosses two components that share no state. A custom MIME type on
 * the drag itself carries everything the drop needs — which item — and doubles
 * as the test for whether a square should light up at all: a file dragged in
 * from the desktop, or a selection dragged from the page, carries a different
 * type and is ignored.
 *
 * Drag-and-drop is the shortcut, never the only way. It does not exist on touch
 * and is awkward with a keyboard, so every item also carries a day back, a day
 * forward, and a date picker.
 */

export const TODO_MIME = "application/x-cue-todo";

export function startTodoDrag(event: React.DragEvent, id: number): void {
  event.dataTransfer.setData(TODO_MIME, String(id));
  // Some browsers refuse a drag with no plain-text payload.
  event.dataTransfer.setData("text/plain", String(id));
  event.dataTransfer.effectAllowed = "move";
}

/** The dragged item's id, or null when this drag isn't one of ours. */
export function readTodoDrag(event: React.DragEvent): number | null {
  const raw = event.dataTransfer.getData(TODO_MIME);
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Whether a drag in progress is carrying an item.
 *
 * `getData` returns nothing during dragover — the browser hides the payload
 * until the drop — so the type list is all there is to go on.
 */
export function isTodoDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(TODO_MIME);
}
