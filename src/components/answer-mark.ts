import { Mark, mergeAttributes } from "@tiptap/react";

/**
 * Big, bold and green: the look a picture card's label has when it is turned
 * over ("Mitochondria"), for the word or number a written answer is really
 * about, so it stands out above the working around it.
 *
 * Stored as `<span data-answer>`, a tag that means nothing to any other mark,
 * and drawn by `globals.css` wherever the card's HTML is shown.
 */
export const AnswerMark = Mark.create({
  name: "answerText",

  parseHTML() {
    return [{ tag: "span[data-answer]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-answer": "" }), 0];
  },
});
