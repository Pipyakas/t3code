import { PreviewCaptureFailure, type PreviewCaptureFailureEncoded } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeCaptureFailure = Schema.decodeUnknownOption(PreviewCaptureFailure);

// Decode here because contextBridge strips custom properties from rejected Errors.
function unwrapPreviewCaptureResult<A>(result: A | PreviewCaptureFailureEncoded): A {
  const failure = decodeCaptureFailure(result);
  if (Option.isSome(failure)) throw failure.value;
  return result as A;
}

/**
 * Module-level handle to the desktop preview bridge.
 *
 * Resolved once at import time so React hooks don't pay for repeated
 * `window.desktopBridge?.preview` lookups on every render. `null` on the web
 * build where there's no Electron host.
 */
const nativePreviewBridge =
  typeof window === "undefined" ? null : (window.desktopBridge?.preview ?? null);

export const previewBridge = nativePreviewBridge
  ? {
      ...nativePreviewBridge,
      captureScreenshot: async (tabId: string) =>
        unwrapPreviewCaptureResult(await nativePreviewBridge.captureScreenshot(tabId)),
      recording: {
        ...nativePreviewBridge.recording,
        startScreencast: async (tabId: string) =>
          unwrapPreviewCaptureResult(await nativePreviewBridge.recording.startScreencast(tabId)),
      },
    }
  : null;
