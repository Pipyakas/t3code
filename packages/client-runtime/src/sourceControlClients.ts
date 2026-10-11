/**
 * The source control host definitions web and mobile ship, and the one lookup they use.
 *
 * Adding a host means writing its `@t3tools/source-control-<host>` package with a
 * `./client/definition` entry and adding it here; clients then label, list, and check out its
 * change requests without further branches.
 *
 * @module client-runtime/sourceControlClients
 */
import {
  makeSourceControlClientRegistry,
  readSourceControlHostSettings,
} from "@t3tools/source-control-core/client/definition";
import type { ServerSettings } from "@t3tools/contracts";

export {
  UNKNOWN_SOURCE_CONTROL_CLIENT,
  type ChangeRequestTerminology,
  type SourceControlClientDefinition,
} from "@t3tools/source-control-core/client/definition";
import * as GitHub from "@t3tools/source-control-github/client/definition";
import * as GitLab from "@t3tools/source-control-gitlab/client/definition";

/**
 * GitHub comes first because a repository that has not reported its host yet reads as GitHub,
 * which is what clients have always shown there. The offline build ships GitHub and GitLab only;
 * other hosts render through the unknown-host fallback. Pickers sort by readiness and label.
 */
const BUILT_IN_SOURCE_CONTROL_CLIENTS = [GitHub.definition, GitLab.definition];

/** `definitions` lists the built-in hosts in that order, for pickers that offer every host. */
export const sourceControlClients = makeSourceControlClientRegistry(
  BUILT_IN_SOURCE_CONTROL_CLIENTS,
);

export type { GitHubSettings } from "@t3tools/source-control-github/client/definition";

/**
 * An environment's GitHub host choices and tokens, decoded with GitHub's settings schema. GitHub's
 * settings panels are its own, since its logins come from `gh` at runtime.
 */
export function readGitHubSettings(settings: Pick<ServerSettings, "sourceControlHosts">) {
  return readSourceControlHostSettings(GitHub.settings, settings.sourceControlHosts.github);
}
