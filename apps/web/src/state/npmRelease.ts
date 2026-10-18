import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

import { CLI_RELEASE_CHECKSUMS_FILE, RELEASE_REPOSITORY } from "@t3tools/shared/cliRelease";

/**
 * Whether the fork's GitHub release for `<version>` is ready to install from.
 * Fork builds never reach npm; boot-service servers download the CLI archive
 * from this fork's release, so the release counts once its checksum file is
 * uploaded. A 404 is false; network and API errors (including the
 * unauthenticated rate limit) stay unknown. Both re-check every few minutes,
 * so a release that lands later shows up without a reload.
 */
export const npmReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/tags/v${encodeURIComponent(version)}`,
      );
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      if (typeof body !== "object" || body === null || !("assets" in body)) return false;
      const assets: unknown = body.assets;
      return (
        Array.isArray(assets) &&
        assets.some(
          (asset: unknown) =>
            typeof asset === "object" &&
            asset !== null &&
            "name" in asset &&
            asset.name === CLI_RELEASE_CHECKSUMS_FILE &&
            "state" in asset &&
            asset.state === "uploaded",
        )
      );
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight for a plain GET.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`npm-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("npm-release-published:none"),
);

/** True only once the release is confirmed, so callers can hide work that
    would download it until then. */
export function useNpmReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? npmReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
