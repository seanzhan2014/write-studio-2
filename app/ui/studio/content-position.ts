import getCaretCoordinates from "textarea-caret";

type ContentSurface = HTMLDivElement | HTMLTextAreaElement;
export type ContentScrollPosition = { offset: number; inset: number; atEnd: boolean };

export function readerOffsetAtPoint(reader: HTMLDivElement, x: number, y: number) {
  const caretDocument = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const caret = caretDocument.caretPositionFromPoint?.(x, y);
  const range = caret ? null : document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !reader.contains(node)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(reader);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

function textTop(surface: ContentSurface, offset: number) {
  if (surface instanceof HTMLTextAreaElement) return getCaretCoordinates(surface, offset).top - surface.scrollTop;
  // Walk text nodes directly, including highlighted fragments.
  const nodes = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let node = nodes.nextNode();
  let remaining = offset;
  while (node && remaining >= (node.textContent?.length ?? 0)) {
    const next = nodes.nextNode();
    if (!next) break;
    remaining -= node.textContent?.length ?? 0;
    node = next;
  }
  if (!node) return 0;
  const length = node.textContent?.length ?? 0;
  const range = document.createRange();
  range.setStart(node, Math.min(remaining, length));
  range.setEnd(node, Math.min(remaining + 1, length));
  const rect = range.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(surface).lineHeight);
  return rect.top - surface.getBoundingClientRect().top - (lineHeight - rect.height) / 2;
}

export function captureContentPosition(surface: ContentSurface): ContentScrollPosition {
  const style = getComputedStyle(surface);
  const top = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
  let offset = 0;
  let clippedTop = 0;
  if (surface instanceof HTMLTextAreaElement) {
    // Find an actual visible character; character counts are not proportional
    // to rendered height when paragraphs have different lengths or wrapping.
    const caret = surface.selectionDirection === "backward" ? surface.selectionStart : surface.selectionEnd;
    const caretTop = textTop(surface, caret);
    if (caretTop >= top && caretTop < surface.clientHeight - parseFloat(style.lineHeight)) offset = caret;
    else {
      let low = 0;
      let high = surface.value.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (textTop(surface, mid) < top) low = mid + 1;
        else high = mid;
      }
      offset = low;
    }
  } else {
    const rect = surface.getBoundingClientRect();
    const container = surface.closest(".writing-scroll")?.getBoundingClientRect();
    clippedTop = Math.max(0, (container?.top ?? rect.top) - rect.top);
    const y = Math.max(rect.top + top, container?.top ?? 0) + parseFloat(style.lineHeight) / 2;
    offset = readerOffsetAtPoint(surface, rect.left + parseFloat(style.paddingLeft) + 2, y) ?? 0;
  }
  const max = surface.scrollHeight - surface.clientHeight;
  return { offset, inset: textTop(surface, offset) - clippedTop, atEnd: max > 0 && max - surface.scrollTop < 2 };
}

export function restoreContentPosition(surface: ContentSurface, position: ContentScrollPosition) {
  if (position.atEnd) surface.scrollTop = surface.scrollHeight;
  else surface.scrollTop += textTop(surface, position.offset) - position.inset;
}

export function revealContentSelection(editor: HTMLTextAreaElement) {
  const caret = getCaretCoordinates(editor, editor.selectionEnd);
  const height = parseFloat(getComputedStyle(editor).lineHeight);
  const top = caret.top - editor.scrollTop;
  if (top < 16) editor.scrollTop = caret.top - 16;
  else if (top + height > editor.clientHeight - 24) editor.scrollTop = caret.top + height - editor.clientHeight + 24;
}
