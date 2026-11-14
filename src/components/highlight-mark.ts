import { Mark, mergeAttributes } from "@tiptap/react";

/**
 * A highlighter pen: picks out the bit of an answer that is the point — the
 * "s" that makes "singers" a plural, the digit that carried.
 *
 * Its own mark rather than bold, because a part's answer is already shown bold
 * and green, so bold inside it changed nothing anyone could see. Stored as a
 * plain `<mark>`, which every place a card is shown draws without being told
 * about it; `globals.css` gives it the marker look.
 *
 * Written here rather than added as `@tiptap/extension-highlight`: that
 * package's colours and multicolour option are more than one pen needs.
 */
export const HighlightMark = Mark.create({
  name: "highlight",

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name),
    };
  },
});
