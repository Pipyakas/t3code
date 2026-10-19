import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";

/**
 * List continuation and indentation for the composer.
 *
 * Implemented once at the ChatComposer level (store replacement), so both
 * composer modes behave identically and serialize identically:
 * Shift+Enter on a list item continues it, Enter on an empty item exits the
 * list, and Tab indents the item. Plain Markdown markers only — no real list
 * nodes anywhere.
 */

export interface ComposerListEdit {
  /** Expanded (plain string) offsets into the prompt. */
  start: number;
  end: number;
  replacement: string;
  /** Expanded caret offset after the edit is applied. */
  cursorAfter: number;
}

type ListMarker =
  | { kind: "ordered"; indent: string; numberText: string; delimiter: "." | ")"; space: string }
  | { kind: "task"; indent: string; space: string }
  | { kind: "bullet"; indent: string; bullet: string; space: string };

function parseListMarker(line: string): { marker: ListMarker; markerEnd: number } | null {
  const indent = line.match(/^[ \t]*/)?.[0] ?? "";
  const rest = line.slice(indent.length);
  const ordered = rest.match(/^(\d+)([.)])((?:[ \t]+)|\s*$)/);
  if (ordered && ordered[1] !== undefined && ordered[2] !== undefined) {
    return {
      marker: {
        kind: "ordered",
        indent,
        numberText: ordered[1],
        delimiter: ordered[2] === ")" ? ")" : ".",
        space: ordered[3] ?? "",
      },
      markerEnd: indent.length + ordered[0].length,
    };
  }
  const task = rest.match(/^-\s\[[ xX]\]((?:[ \t]+)|\s*$)/);
  if (task) {
    return {
      marker: { kind: "task", indent, space: task[1] ?? "" },
      markerEnd: indent.length + task[0].length,
    };
  }
  const bullet = rest.match(/^([-*+])((?:[ \t]+)|\s*$)/);
  if (bullet && bullet[1] !== undefined) {
    return {
      marker: { kind: "bullet", indent, bullet: bullet[1], space: bullet[2] ?? "" },
      markerEnd: indent.length + bullet[0].length,
    };
  }
  return null;
}

/**
 * The ordered marker that follows `3.` or `09)`: one higher, same delimiter,
 * zero padding kept, and a number too large to count left as typed. Shared
 * with the rich editor's native split so both modes count the same way.
 */
export function nextOrderedMarkerText(marker: string): string {
  const numberText = marker.slice(0, -1);
  const delimiter = marker.slice(-1);
  const number = Number.parseInt(numberText, 10);
  const next = Number.isSafeInteger(number)
    ? String(number + 1).padStart(numberText.length, "0")
    : numberText;
  return `${next}${delimiter}`;
}

function nextMarkerText(marker: ListMarker): string {
  if (marker.kind === "ordered") {
    return `${marker.indent}${nextOrderedMarkerText(`${marker.numberText}${marker.delimiter}`)} `;
  }
  if (marker.kind === "task") {
    return `${marker.indent}- [ ] `;
  }
  return `${marker.indent}${marker.bullet} `;
}

// Markdown tabs advance to the next four-column stop.
function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

function renumberFollowingItems(
  value: string,
  afterLineEnd: number,
  marker: Extract<ListMarker, { kind: "ordered" }>,
  tokens: ReturnType<typeof inlineTokenRanges>,
): { end: number; text: string } | null {
  const baseWidth = indentWidth(marker.indent);
  const parts: string[] = [];
  let expected = Number.parseInt(marker.numberText, 10) + 2;
  let position = afterLineEnd;
  let copiedUntil = afterLineEnd;
  let tokenIndex = 0;
  while (position < value.length && Number.isSafeInteger(expected)) {
    const lineStart = position + 1;
    const nextBreak = value.indexOf("\n", lineStart);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    position = lineEnd;
    let token = tokens[tokenIndex];
    while (token && token.end <= lineStart) {
      tokenIndex += 1;
      token = tokens[tokenIndex];
    }
    // A newline inside a chip does not start a list item.
    if (token && token.start < lineStart) continue;

    const line = value.slice(lineStart, lineEnd);
    const width = indentWidth(line);
    if (line.trim() === "" || width < baseWidth) break;
    if (width > baseWidth) continue;
    const parsed = parseListMarker(line);
    if (parsed?.marker.kind !== "ordered" || parsed.marker.delimiter !== marker.delimiter) break;

    const current = parsed.marker;
    const numberStart = lineStart + current.indent.length;
    const numberEnd = numberStart + current.numberText.length;
    const replacement = current.numberText.startsWith("0")
      ? String(expected).padStart(current.numberText.length, "0")
      : String(expected);
    if (replacement !== current.numberText) {
      parts.push(value.slice(copiedUntil, numberStart), replacement);
      copiedUntil = numberEnd;
    }
    expected += 1;
  }
  return parts.length === 0 ? null : { end: copiedUntil, text: parts.join("") };
}

function inlineTokenRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const segment of splitPromptIntoComposerSegments(value)) {
    const end = offset + (segment.type === "text" ? segment.text : segment.source).length;
    if (segment.type !== "text") ranges.push({ start: offset, end });
    offset = end;
  }
  return ranges;
}

/** True when splitting at the caret would cut an inline chip in two. */
function isInsideInlineToken(
  tokens: ReturnType<typeof inlineTokenRanges>,
  cursor: number,
): boolean {
  return tokens.some((range) => cursor > range.start && cursor < range.end);
}

function currentLine(value: string, cursor: number): { start: number; end: number; text: string } {
  const start = value.lastIndexOf("\n", cursor - 1) + 1;
  const endIndex = value.indexOf("\n", cursor);
  const end = endIndex === -1 ? value.length : endIndex;
  return { start, end, text: value.slice(start, end) };
}

/**
 * Enter on a list item line: continue the list, or exit it when the item is
 * empty. Returns null for non-list lines, carets inside the marker, and
 * carets inside an inline chip — all fall through to a plain newline.
 */
export function listContinuationForEnter(value: string, cursor: number): ComposerListEdit | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > value.length) return null;
  const line = currentLine(value, cursor);
  const parsed = parseListMarker(line.text);
  if (!parsed) return null;
  const markerEnd = line.start + parsed.markerEnd;
  if (cursor < markerEnd) return null;
  const tokens = inlineTokenRanges(value);
  if (isInsideInlineToken(tokens, cursor)) return null;
  if (value.slice(markerEnd, line.end).trim() === "") {
    // Empty item: Enter exits the list by removing the marker.
    return {
      start: line.start,
      end: Math.max(cursor, markerEnd),
      replacement: "",
      cursorAfter: line.start,
    };
  }
  const insertion = `\n${nextMarkerText(parsed.marker)}`;
  const cursorAfter = cursor + insertion.length;
  const { marker } = parsed;
  if (marker.kind === "ordered") {
    const renumbered = renumberFollowingItems(value, line.end, marker, tokens);
    if (renumbered) {
      return {
        start: cursor,
        end: renumbered.end,
        replacement: insertion + value.slice(cursor, line.end) + renumbered.text,
        cursorAfter,
      };
    }
  }
  return { start: cursor, end: cursor, replacement: insertion, cursorAfter };
}

/**
 * Tab on a list item line: indent by two spaces. Ranged selections, non-list
 * lines, and carets inside an inline chip fall through (Shift+Tab stays the
 * plan-mode toggle and is handled before this is consulted).
 */
export function listIndentForTab(
  value: string,
  start: number,
  end: number,
): ComposerListEdit | null {
  if (!Number.isInteger(start) || start !== end || start < 0 || start > value.length) return null;
  const line = currentLine(value, start);
  if (!parseListMarker(line.text)) return null;
  if (isInsideInlineToken(inlineTokenRanges(value), start)) return null;
  return { start: line.start, end: line.start, replacement: "  ", cursorAfter: start + 2 };
}
