import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkOmlxConnection,
  listOmlxModels,
  normalizeOmlxBaseUrl
} from "../../src/lib/omlx";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OMLX_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.OMLX_API_KEY;
  } else {
    process.env.OMLX_API_KEY = originalApiKey;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response
) {
  globalThis.fetch = vi.fn(handler) as typeof fetch;
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

describe("normalizeOmlxBaseUrl", () => {
  it("defaults to oMLX localhost v1 and trims trailing slashes", () => {
    expect(normalizeOmlxBaseUrl()).toBe("http://127.0.0.1:8000/v1");
    expect(normalizeOmlxBaseUrl(" http://127.0.0.1:8000/v1/// ")).toBe(
      "http://127.0.0.1:8000/v1"
    );
  });

  it("adds /v1 when the user provides the oMLX server root", () => {
    expect(normalizeOmlxBaseUrl("http://127.0.0.1:8000")).toBe(
      "http://127.0.0.1:8000/v1"
    );
  });
});

describe("listOmlxModels", () => {
  it("lists model IDs through the OpenAI-compatible /models endpoint", async () => {
    mockFetch((input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:8000/v1/models");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      return jsonResponse({
        data: [
          { id: "Qwen3.6-35B-A3B-4bit", object: "model" },
          { id: "second-model" }
        ]
      });
    });

    await expect(
      listOmlxModels(undefined, {
        apiKey: "test-key",
        settingsPath: false
      })
    ).resolves.toEqual([
      { id: "Qwen3.6-35B-A3B-4bit", object: "model" },
      { id: "second-model" }
    ]);
  });

  it("uses the local oMLX settings API key when no explicit key is provided", async () => {
    delete process.env.OMLX_API_KEY;
    const dir = await mkdtemp(join(tmpdir(), "omlx-settings-"));
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ auth: { api_key: "settings-key" } }), "utf8");
    mockFetch((_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer settings-key");
      return jsonResponse({ data: [] });
    });

    try {
      await expect(listOmlxModels(undefined, { settingsPath })).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns connection errors without throwing from checkOmlxConnection", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    await expect(
      checkOmlxConnection(undefined, {
        apiKey: false,
        settingsPath: false
      })
    ).resolves.toEqual({
      ok: false,
      baseUrl: "http://127.0.0.1:8000/v1",
      error: expect.stringMatching(/network error.*fetch failed/i)
    });
  });
});
