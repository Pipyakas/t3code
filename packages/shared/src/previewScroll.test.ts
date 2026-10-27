import { describe, expect, it } from "vite-plus/test";
import {
  formatPreviewScroll,
  injectPreviewScrollBootstrap,
  readPreviewScrollMessage,
  readPreviewScrollParam,
} from "./previewScroll.ts";

describe("preview scroll", () => {
  it("round-trips a position through the query parameter and rejects anything else", () => {
    expect(readPreviewScrollParam(formatPreviewScroll({ x: 12.4, y: 1859.6 }))).toEqual({
      x: 12,
      y: 1860,
    });
    expect(formatPreviewScroll(null)).toBe("");
    for (const value of ["", "1", "-1,2", "1,2,3", "1.5,2", "a,b"]) {
      expect(readPreviewScrollParam(value)).toBeNull();
    }
  });

  it("reads only its own messages", () => {
    expect(readPreviewScrollMessage({ type: "t3:preview-scroll", x: 0, y: 40 })).toEqual({
      x: 0,
      y: 40,
    });
    expect(readPreviewScrollMessage({ type: "other", x: 0, y: 40 })).toBeUndefined();
    expect(readPreviewScrollMessage({ type: "t3:preview-scroll", x: 0 })).toBeUndefined();
    expect(readPreviewScrollMessage({ type: "t3:preview-scroll", x: 0, y: NaN })).toBeUndefined();
  });

  it("goes after the doctype and ahead of the page's own policy", () => {
    const page =
      '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><p>hi</p>';
    const injected = injectPreviewScrollBootstrap(page, { x: 0, y: 40 });
    expect(injected.startsWith("<!DOCTYPE html><script>")).toBe(true);
    expect(injected.indexOf("[0,40]")).toBeLessThan(injected.indexOf("Content-Security-Policy"));
    expect(injected.endsWith(page.slice("<!DOCTYPE html>".length))).toBe(true);
    expect(injectPreviewScrollBootstrap("<p>hi</p>", null)).toMatch(
      /^<script>\(\(\) => \{\n {2}const restore = null;[\s\S]*<\/script><p>hi<\/p>$/,
    );
  });
});
