import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  fetchClaudeGatewayEffortLevels,
  resolveClaudeGatewayConnection,
  withClaudeGatewayEffortLevels,
} from "./claudeGatewayModels.ts";

describe("resolveClaudeGatewayConnection", () => {
  it("reads Claude's settings env over the process env, as Claude Code does", () => {
    const connection = resolveClaudeGatewayConnection(
      { ANTHROPIC_BASE_URL: "http://process.invalid", ANTHROPIC_AUTH_TOKEN: "from-process" },
      {
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        ANTHROPIC_BASE_URL: "http://gateway.test:6767/",
        ANTHROPIC_CUSTOM_HEADERS: "X-Gateway-Key: secret\nmalformed line",
      },
    );
    assert.deepStrictEqual(connection, {
      baseUrl: "http://gateway.test:6767",
      headers: {
        "anthropic-version": "2023-06-01",
        authorization: "Bearer from-process",
        "x-gateway-key": "secret",
      },
    });
  });

  it("stays off unless discovery is enabled and a base URL is set", () => {
    assert.strictEqual(
      resolveClaudeGatewayConnection({ ANTHROPIC_BASE_URL: "http://gateway.test" }, {}),
      undefined,
    );
    assert.strictEqual(
      resolveClaudeGatewayConnection(
        { ANTHROPIC_BASE_URL: "http://gateway.test" },
        { CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "false" },
      ),
      undefined,
    );
    assert.strictEqual(
      resolveClaudeGatewayConnection({ CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1" }, {}),
      undefined,
    );
  });
});

describe("fetchClaudeGatewayEffortLevels", () => {
  it.effect("keeps each model's own ladder, and leaves reasoning models without one alone", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          assert.strictEqual(request.url, "http://gateway.test/v1/models");
          assert.strictEqual(request.headers["x-gateway-key"], "secret");
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                data: [
                  { id: "flash", supported_effort: ["max", "low", "high"] },
                  {
                    id: "bunny",
                    reasoning_options: [{ type: "effort", values: ["low", "medium", "xhigh"] }],
                  },
                  { id: "odd", supported_effort: ["minimal", "ultra"] },
                  { id: "thinker", reasoning: true },
                  { id: "plain" },
                ],
              }),
            ),
          );
        }),
      );
      const levels = yield* fetchClaudeGatewayEffortLevels({
        baseUrl: "http://gateway.test",
        headers: { "x-gateway-key": "secret" },
      }).pipe(Effect.provideService(HttpClient.HttpClient, http));

      assert.deepStrictEqual(Object.fromEntries(levels), {
        flash: ["low", "high", "max"],
        bunny: ["low", "medium", "xhigh"],
        plain: null,
      });
    }),
  );

  it.effect("fails on a non-200 answer so the caller keeps Claude Code's report", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("no key", { status: 401 })),
        ),
      );
      const result = yield* fetchClaudeGatewayEffortLevels({
        baseUrl: "http://gateway.test",
        headers: {},
      }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.flip);
      assert.strictEqual(result._tag, "ClaudeGatewayModelsError");
    }),
  );
});

describe("withClaudeGatewayEffortLevels", () => {
  it("replaces Claude Code's generic ladder only for models the gateway lists", () => {
    const generic = ["low", "medium", "high", "xhigh", "max"] as const;
    const reported = [
      {
        value: "flash",
        displayName: "Flash",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: [...generic],
      },
      {
        value: "plain",
        displayName: "Plain",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: [...generic],
      },
      {
        value: "claude-opus-5-5",
        displayName: "Opus",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: [...generic],
      },
    ];
    const merged = withClaudeGatewayEffortLevels(
      reported,
      new Map([
        ["flash", ["low", "high", "max"] as const],
        ["plain", null],
      ]),
    );

    assert.deepStrictEqual(merged[0]?.supportedEffortLevels, ["low", "high", "max"]);
    assert.strictEqual(merged[1]?.supportsEffort, false);
    assert.strictEqual(merged[1]?.supportedEffortLevels, undefined);
    assert.strictEqual(merged[2], reported[2]);
  });
});
