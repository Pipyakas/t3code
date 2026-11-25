import { describe, expect, it } from "vite-plus/test";

import {
  parseConfiguredProviderNames,
  parseOpenCodeModelList,
  reconcileOpenCode2Catalog,
} from "./openCode2CliCatalog.ts";
import type { OpenCode2Model } from "./status.ts";

const serverModel = (
  providerID: string,
  id: string,
  overrides: Partial<OpenCode2Model> = {},
): OpenCode2Model => ({
  providerID,
  id,
  name: `${providerID} ${id}`,
  variants: [],
  ...overrides,
});

describe("parseOpenCodeModelList", () => {
  it("keeps slashes inside model ids and drops duplicates", () => {
    expect(
      parseOpenCodeModelList(
        "opencode-go/beam-free\r\nopenrouter/~anthropic/claude-sonnet-latest\n\nopencode-go/beam-free\nnoise",
      ),
    ).toEqual([
      { providerID: "opencode-go", id: "beam-free" },
      { providerID: "openrouter", id: "~anthropic/claude-sonnet-latest" },
    ]);
  });
});

describe("parseConfiguredProviderNames", () => {
  it("reads provider names from JSONC config", () => {
    expect([
      ...parseConfiguredProviderNames(`{
          // "not a provider": { "name": "comment" }
          "providers": {
            "gameloft": { "name": "Gameloft AI" },
            "han_studio": { "name": "Han Studio" }
          }
        }`),
    ]).toEqual([
      ["gameloft", "Gameloft AI"],
      ["han_studio", "Han Studio"],
    ]);
  });
});

describe("reconcileOpenCode2Catalog", () => {
  it("keeps only CLI-listed models and rewrites gateway prefixes", () => {
    const result = reconcileOpenCode2Catalog({
      cliModels: [
        { providerID: "gitlab", id: "duo-pro" },
        { providerID: "opencode-go", id: "beam-free" },
        { providerID: "gameloft", id: "ask" },
      ],
      serverModels: [
        serverModel("gitlab", "duo-pro", {
          name: "Duo Pro",
          providerName: "GitLab Duo",
          variants: [{ id: "high" }],
        }),
        serverModel("opencode", "beam-free", {
          name: "Beam Free",
          providerName: "OpenCode Zen",
          variants: [{ id: "medium" }],
        }),
        serverModel("opencode", "hidden-by-policy"),
      ],
      providerNames: new Map([
        ["opencode-go", "OpenCode Go"],
        ["gameloft", "Gameloft AI"],
      ]),
    });

    expect(result.map((model) => `${model.providerID}/${model.id}`)).toEqual([
      "gitlab/duo-pro",
      "opencode-go/beam-free",
      "gameloft/ask",
    ]);
    expect(result[0]).toMatchObject({ name: "Duo Pro", providerName: "GitLab Duo" });
    expect(result[1]).toMatchObject({
      name: "Beam Free",
      providerName: "OpenCode Go",
      variants: [{ id: "medium" }],
    });
    expect(result[2]).toMatchObject({ name: "Ask", providerName: "Gameloft AI" });
  });
});
