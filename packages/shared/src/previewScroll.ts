/**
 * A workspace HTML preview reloads whenever the workspace changes. The asset
 * route injects a small script into pages requested with this query parameter:
 * it reports the page's scroll position to the parent and restores the position
 * the parameter carries, so a reload lands where the reader was.
 */
export const PREVIEW_SCROLL_PARAM = "t3-preview-scroll";

const PREVIEW_SCROLL_MESSAGE = "t3:preview-scroll";
const MAX_SCROLL_OFFSET = 10_000_000;

export interface PreviewScroll {
  readonly x: number;
  readonly y: number;
}

const clampOffset = (value: number) => Math.min(MAX_SCROLL_OFFSET, Math.max(0, Math.round(value)));

export function formatPreviewScroll(scroll: PreviewScroll | null): string {
  return scroll === null ? "" : `${clampOffset(scroll.x)},${clampOffset(scroll.y)}`;
}

export function readPreviewScrollParam(value: string): PreviewScroll | null {
  const match = /^(\d{1,8}),(\d{1,8})$/.exec(value);
  if (!match) return null;
  return { x: clampOffset(Number(match[1])), y: clampOffset(Number(match[2])) };
}

export function readPreviewScrollMessage(data: unknown): PreviewScroll | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const message = data as { type?: unknown; x?: unknown; y?: unknown };
  if (message.type !== PREVIEW_SCROLL_MESSAGE) return undefined;
  if (typeof message.x !== "number" || typeof message.y !== "number") return undefined;
  if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return undefined;
  return { x: clampOffset(message.x), y: clampOffset(message.y) };
}

/**
 * Goes ahead of everything after the doctype, so a page's own CSP meta tag
 * cannot block it and a page without a doctype keeps its rendering mode.
 */
export function injectPreviewScrollBootstrap(html: string, restore: PreviewScroll | null): string {
  const script = `<script>(() => {
  const restore = ${restore === null ? "null" : JSON.stringify([restore.x, restore.y])};
  if (restore) {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const apply = () => window.scrollTo(restore[0], restore[1]);
    document.addEventListener("DOMContentLoaded", apply, { once: true });
    window.addEventListener("load", apply, { once: true });
  }
  let frame = 0;
  window.addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_SCROLL_MESSAGE)}, x: window.scrollX, y: window.scrollY }, "*");
    });
  }, { passive: true });
})();</script>`;
  const doctype = /^﻿?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return `${doctype}${script}${html.slice(doctype.length)}`;
}
