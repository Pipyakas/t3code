import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { providerClients } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("derives visible provider config fields from the client definition schema", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"));

    expect(opencode).toBeDefined();
    // Order comes from the schema's `providerSettingsFormSchema.order`; `enabled`
    // and `customModels` are annotated hidden, so neither appears.
    expect(deriveProviderSettingsFields(opencode!).map((field) => field.key)).toEqual([
      "binaryPath",
      "serverUrl",
      "serverPassword",
    ]);
  });

  it("sources labels and descriptions from schema annotations", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"));
    expect(opencode).toBeDefined();

    const serverPassword = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverPassword",
    );

    expect(serverPassword).toMatchObject({
      label: "Server password",
      description: "Stored in plain text on disk.",
      control: "password",
    });
  });

  it("exposes ACP Registry as an instance-only configurable driver", () => {
    const acpRegistry = providerClients.get(ProviderDriverKind.make("acpRegistry"));

    expect(acpRegistry).toBeDefined();
    expect(acpRegistry?.hasDefaultInstance).toBe(false);
    expect(deriveProviderSettingsFields(acpRegistry!).map((field) => field.key)).toEqual([
      "source",
      "agentId",
      "commandPath",
      "authMethodId",
    ]);
  });

  it("shows the local executable without registry identity or authentication fields", () => {
    const acpRegistry = providerClients.get(ProviderDriverKind.make("acpRegistry"));
    expect(
      deriveProviderSettingsFields(acpRegistry!, { source: "local" }).map((field) => field.key),
    ).toEqual(["source", "commandPath"]);
  });

  it("derives a select control with its choices for the ACP source", () => {
    const acpRegistry = providerClients.get(ProviderDriverKind.make("acpRegistry"));
    expect(acpRegistry).toBeDefined();

    const fields = deriveProviderSettingsFields(acpRegistry!);
    const source = fields.find((field) => field.key === "source");
    expect(source).toMatchObject({
      control: "select",
      clearWhenEmpty: "omit",
      label: "ACP source",
    });
    expect(source?.options).toEqual([
      { value: "registry", label: "ACP Registry" },
      { value: "local", label: "Local command" },
    ]);
    // Every other field falls back to a plain text control.
    for (const field of fields.filter((candidate) => candidate.key !== "source")) {
      expect(field.control).toBe("text");
    }
  });

  it("shows the auto-compaction threshold for Claude providers", () => {
    const claude = providerClients.get(ProviderDriverKind.make("claudeAgent"));
    expect(claude).toBeDefined();

    expect(deriveProviderSettingsFields(claude!).map((field) => field.key)).toEqual([
      "binaryPath",
      "homePath",
      "autoCompactWindow",
      "launchArgs",
    ]);
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"));
    expect(opencode).toBeDefined();

    const serverUrl = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverUrl",
    );
    expect(serverUrl).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, serverUrl: "http://127.0.0.1:4096" },
      serverUrl!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits false boolean fields when clearWhenEmpty is omit", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: true },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: false,
      },
      false,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("omits true boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, experimental: false },
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      true,
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });

  it("preserves false boolean fields when clearWhenEmpty is persist", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "persist",
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });
});
