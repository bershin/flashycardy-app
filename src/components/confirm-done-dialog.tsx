"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DayTodo } from "@/lib/store/types";

/**
 * Asks before an item is ticked off.
 *
 * A tick box is four millimetres across and sits beside a drag handle, so it
 * is easy to hit on the way to something else — and a ticked item drops to the
 * bottom of its day, which reads as the item having vanished.
 *
 * Only on the way to done. Un-ticking is how that mistake is undone, and a
 * question in front of the undo would be a question in front of the answer.
 *
 * Shared because two places tick items — the day list on the calendar and the
 * strip on the dashboard — and a confirmation that appears in one of them is
 * arguably worse than none, since it teaches that ticking asks first.
 */
export function ConfirmDoneDialog({
  todo,
  onOpenChange,
  onConfirm,
}: {
  /** The item awaiting confirmation, or null when nothing is. */
  todo: DayTodo | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (todo: DayTodo) => void;
}) {
  return (
    <AlertDialog open={todo !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark this as done?</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Quoted so the dialog says which item, for a mis-hit on a list
                where every row looks the same. */}
            &ldquo;{todo?.text}&rdquo; settles to the bottom of its day. You can
            tick it back open afterwards if it turns out it is not.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction onClick={() => todo && onConfirm(todo)}>
            Mark done
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
