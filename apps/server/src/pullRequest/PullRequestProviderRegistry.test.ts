import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SourceControlProviderKind } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as AzureDevOpsCli from "@t3tools/source-control-azure-devops/server/AzureDevOpsCli";
import * as AzureDevOpsPullRequestCli from "@t3tools/source-control-azure-devops/server/AzureDevOpsPullRequestCli";
import * as BitbucketApi from "@t3tools/source-control-bitbucket/server/BitbucketApi";
import * as BitbucketPullRequestApi from "@t3tools/source-control-bitbucket/server/BitbucketPullRequestApi";
import * as ForgejoCli from "@t3tools/source-control-forgejo/server/ForgejoCli";
import * as GitCafeApi from "@t3tools/source-control-gitcafe/server/GitCafeApi";
import * as GitCafeCredentials from "@t3tools/source-control-gitcafe/server/GitCafeCredentials";
import * as GitHubApi from "@t3tools/source-control-github/server/GitHubApi";
import * as GitHubCredentials from "@t3tools/source-control-github/server/GitHubCredentials";
import * as GitHubPullRequestApi from "@t3tools/source-control-github/server/GitHubPullRequestApi";
import * as GitLabCli from "@t3tools/source-control-gitlab/server/GitLabCli";
import * as GitLabPullRequestCli from "@t3tools/source-control-gitlab/server/GitLabPullRequestCli";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ServerSourceControlHost from "../sourceControl/ServerSourceControlHost.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PullRequestProviderRegistry from "./PullRequestProviderRegistry.ts";

const makeRegistry = (settings: ServerSettings.ServerSettingsService["Service"]) => {
  const layerSettings = Layer.succeed(ServerSettings.ServerSettingsService, settings);
  const layerVcs = Layer.mergeAll(
    Layer.mock(VcsProcess.VcsProcess)({ run: () => Effect.die("unused in this test") }),
    Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({}),
    layerSettings,
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
  );
  return PullRequestProviderRegistry.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        layerSettings,
        ServerSourceControlHost.layer.pipe(Layer.provide(layerVcs)),
        Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
        Layer.mock(AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCli)({}),
        Layer.mock(BitbucketApi.BitbucketApi)({}),
        Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({}),
        Layer.mock(ForgejoCli.ForgejoCli)({ listLogins: () => Effect.succeed([]) }),
        Layer.mock(GitCafeApi.GitCafeApi)({}),
        Layer.mock(GitCafeCredentials.GitCafeCredentials)({
          cliEnv: () => Effect.succeed({}),
        }),
        Layer.mock(GitHubApi.GitHubApi)({
          // Registration does not depend on a signed-in account; only the calls do.
          credential: (host) => Effect.fail(new GitHubCredentials.GitHubNotSignedInError({ host })),
        }),
        Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({}),
        Layer.mock(GitLabCli.GitLabCli)({}),
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({}),
      ),
    ),
  );
};

const settingsWith = (sourceControlHosts: Record<string, Record<string, unknown>>) =>
  ServerSettings.ServerSettingsService.pipe(
    Effect.provide(ServerSettings.ServerSettingsService.layerTest({ sourceControlHosts })),
  );

it.effect("withholds the change request provider for a host Settings has switched off", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(yield* settingsWith({ forgejo: { enabled: false } }));
    const forgejo = SourceControlProviderKind.make("forgejo");

    assert.isNull(yield* registry.get(forgejo));
    // Hosts this build starts on are untouched by one host's switch.
    assert.isNotNull(yield* registry.get(SourceControlProviderKind.make("github")));
    assert.isNotNull(yield* registry.get(SourceControlProviderKind.make("gitlab")));
  }),
);

it.effect("answers with the host a Settings switch turns on, without a restart", () =>
  Effect.gen(function* () {
    const settings = yield* settingsWith({ forgejo: { baseUrl: "https://codeberg.org" } });
    const registry = yield* makeRegistry(settings);
    const forgejo = SourceControlProviderKind.make("forgejo");

    assert.isNull(yield* registry.get(forgejo));

    yield* settings.updateSettings({ sourceControlHosts: { forgejo: { enabled: true } } });

    assert.isNotNull(yield* registry.get(forgejo));
  }),
);

it.effect("still answers null for a host this build does not ship", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(yield* settingsWith({}));

    assert.isNull(yield* registry.get(SourceControlProviderKind.make("gitea")));
  }),
);
