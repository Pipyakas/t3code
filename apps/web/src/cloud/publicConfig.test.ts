import { expect, it, vi } from "vite-plus/test";
import {
  hasCloudPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayTracingConfig,
} from "./publicConfig";

it("ignores cloud and telemetry configuration even when supplied by the build", () => {
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_configured");
  vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "relay");
  vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
  try {
    expect(hasCloudPublicConfig()).toBe(false);
    expect(resolveCloudPublicConfig().relayUrl).toBeNull();
    expect(resolveCloudPublicConfig().clerkPublishableKey).toBeNull();
    expect(resolveRelayTracingConfig()).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
