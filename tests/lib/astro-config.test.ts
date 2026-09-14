import { describe, expect, it } from "vitest";
import astroConfig from "../../astro.config.mjs";

describe("Astro development server", () => {
  it("does not reload the viewer for generated benchmark artifacts", () => {
    const config = astroConfig as {
      vite?: { server?: { watch?: { ignored?: string[] } } };
    };
    const ignored = config.vite?.server?.watch?.ignored ?? [];

    expect(ignored).toContain("**/runs/**");
    expect(ignored).toContain("**/logs/**");
    expect(ignored).toContain("**/.bench-runtime/**");
    expect(ignored).toContain("**/dist-static/**");
    expect(ignored).toContain("**/public/export/**");
  });
});
