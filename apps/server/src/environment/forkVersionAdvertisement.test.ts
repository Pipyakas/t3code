import { describe, expect, it } from "vite-plus/test";

import { advertisedServerVersion } from "./forkVersionAdvertisement.ts";

describe("advertisedServerVersion", () => {
  it("keeps the real version until an upstream client is newer", () => {
    expect(advertisedServerVersion("0.0.46-nightly.20261010.2948", null)).toBe(
      "0.0.46-nightly.20261010.2948",
    );
    expect(
      advertisedServerVersion("0.0.46-nightly.20261010.2948", "0.0.46-nightly.20261010.2945"),
    ).toBe("0.0.46-nightly.20261010.2948");
  });

  it("reports the newest upstream client version when it is ahead", () => {
    expect(
      advertisedServerVersion("0.0.46-nightly.20261010.2948", "0.0.46-nightly.20261011.2954"),
    ).toBe("0.0.46-nightly.20261011.2954");
    expect(advertisedServerVersion("0.0.46-nightly.20261010.2948", "0.0.47")).toBe("0.0.47");
  });
});
