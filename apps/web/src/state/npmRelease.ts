import { useAtomValue } from "@effect/atom-react";
import {
  CLI_RELEASE_CHECKSUMS_FILE,
  RELEASE_REPOSITORY,
  npmReleaseDatabaseMigration,
} from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

export interface NpmRelease {
  readonly version: string;
  /** Absent on releases published before npm manifests carried it. */
  readonly databaseMigration: number | undefined;
}

/** `spec` is an exact version or a dist-tag such as `nightly`. Null when npm has no such release.
 * Refreshes only while mounted; the published check below keeps its own versions alive. */
export const npmReleaseAtom = Atom.family((spec: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        `https://registry.npmjs.org/t3/${encodeURIComponent(spec)}`,
      );
      if (response.status === 404) return null;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      if (
        typeof body !== "object" ||
        body === null ||
        !("version" in body) ||
        typeof body.version !== "string"
      ) {
        return null;
      }
      return {
        version: body.version,
        databaseMigration: npmReleaseDatabaseMigration(body),
      } satisfies NpmRelease;
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight, which npm rejects.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`npm-release:${spec}`)),
);

// Fork builds never reach npm: boot-service servers download the CLI archive from this fork's
// GitHub release, which counts once its checksum file is uploaded. A 404 is false; network and
// API errors (including the unauthenticated rate limit) stay unknown until the next refresh.
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
    Atom.withLabel(`fork-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("npm-release-published:none"),
);

export function useNpmReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? npmReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
