import { expect, it, vi } from "vite-plus/test";
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
import {
  hasCloudPublicConfig,
  hasTracingPublicConfig,
  resolveCloudPublicConfig,
} from "./publicConfig";

it("ignores supplied mobile Connect and telemetry configuration", () => {
  const config = resolveCloudPublicConfig({
    clerk: { publishableKey: "configured", jwtTemplate: "relay" },
    relay: { url: "https://relay.example.test" },
    observability: {
      tracesUrl: "https://collector.example.test",
      tracesDataset: "data",
      tracesToken: "token",
    },
  });
  expect(hasCloudPublicConfig()).toBe(false);
  expect(config.clerk.publishableKey).toBeNull();
  expect(config.relay.url).toBeNull();
  expect(hasTracingPublicConfig(config)).toBe(false);
});
