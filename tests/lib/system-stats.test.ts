import { describe, expect, it } from "vitest";
import { getSystemStats } from "../../src/lib/system-stats";

describe("getSystemStats", () => {
  it("returns best-effort local OS, CPU, RAM, platform, and GPU stats", () => {
    const stats = getSystemStats(new Date("2026-05-06T12:00:00.000Z"));

    expect(stats).toMatchObject({
      collectedAt: "2026-05-06T12:00:00.000Z",
      platform: {
        node: expect.any(String),
        platform: expect.any(String),
        arch: expect.any(String)
      },
      os: {
        type: expect.any(String),
        release: expect.any(String),
        hostname: expect.any(String)
      },
      cpu: {
        model: expect.any(String),
        cores: expect.any(Number)
      },
      memory: {
        totalBytes: expect.any(Number),
        availableBytes: expect.any(Number),
        freeBytes: expect.any(Number),
        usedBytes: expect.any(Number),
        source: expect.any(String)
      },
      hardware: expect.any(Object),
      gpu: {
        available: expect.any(Boolean),
        telemetryAvailable: expect.any(Boolean),
        devices: expect.any(Array),
        reason: expect.any(String)
      }
    });
    expect(stats.cpu.cores).toBeGreaterThan(0);
    expect(stats.cpu.usagePercent === null || stats.cpu.usagePercent >= 0).toBe(true);
    expect(stats.memory.totalBytes).toBeGreaterThanOrEqual(stats.memory.freeBytes);
    expect(stats.memory.totalBytes).toBeGreaterThanOrEqual(stats.memory.usedBytes);
  });

  it("samples CPU usage on the second call", () => {
    getSystemStats(new Date("2026-05-06T12:00:00.000Z"));
    const stats = getSystemStats(new Date("2026-05-06T12:00:01.000Z"));

    expect(stats.cpu.usagePercent === null || stats.cpu.usagePercent >= 0).toBe(true);
  });
});
