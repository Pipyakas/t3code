import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RELEASE_REPOSITORY } from "@t3tools/shared/cliRelease";

import { npmReleasePublishedAtom } from "./npmRelease";

const version = "0.1.0-fork.6";

const release = (assets: ReadonlyArray<{ name: string; state: string }>) =>
  Response.json({ tag_name: `v${version}`, assets });

// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck() {
  const atom = npmReleasePublishedAtom(version);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("npmReleasePublishedAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks the fork release without tracing headers, so the browser skips a preflight", async () => {
    fetchMock.mockImplementation(async () =>
      release([
        { name: `t3-${version}-linux-x64.tar.gz`, state: "uploaded" },
        { name: "SHA256SUMS", state: "uploaded" },
      ]),
    );

    const result = await settledCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/tags/v${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => false)).toBe(true);
  });

  it("waits for the checksum file, which the release uploads with its archives", async () => {
    fetchMock.mockImplementation(async () =>
      release([
        { name: `t3-${version}-linux-x64.tar.gz`, state: "uploaded" },
        { name: "SHA256SUMS", state: "starter" },
      ]),
    );

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  it("reports a version without a release as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  // regression: #18709 update-everything skipped npm-installed servers
  it("leaves a failed first check unknown, which callers read as unpublished", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck();

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(false);
  });
});
