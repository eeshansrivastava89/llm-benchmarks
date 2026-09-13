import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkLmStudioConnection,
  discoverLocalGgufModels,
  listLmStudioModels,
  normalizeLmStudioBaseUrl
} from "../../src/lib/lmstudio";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

describe("normalizeLmStudioBaseUrl", () => {
  it("defaults to localhost v1 and trims trailing slashes", () => {
    expect(normalizeLmStudioBaseUrl()).toBe("http://localhost:1234/v1");
    expect(normalizeLmStudioBaseUrl(" http://localhost:1234/v1/// ")).toBe(
      "http://localhost:1234/v1"
    );
  });

  it("adds /v1 when the user provides the LM Studio server root", () => {
    expect(normalizeLmStudioBaseUrl("http://localhost:1234")).toBe(
      "http://localhost:1234/v1"
    );
  });
});

describe("checkLmStudioConnection", () => {
  it("checks reachability without mutating LM Studio state", async () => {
    const fetchMock = mockFetch((input, init) => {
      expect(String(input)).toBe("http://localhost:1234/v1/models");
      expect(init?.method).toBe("GET");
      return jsonResponse({ data: [] });
    });

    await expect(checkLmStudioConnection()).resolves.toEqual({
      ok: true,
      baseUrl: "http://localhost:1234/v1"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns network failure context for unreachable servers", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    await expect(checkLmStudioConnection("http://localhost:1234")).resolves.toEqual({
      ok: false,
      baseUrl: "http://localhost:1234/v1",
      error: expect.stringMatching(/network error.*fetch failed/i)
    });
  });
});

describe("listLmStudioModels", () => {
  it("returns exact model IDs from the /models response", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          { id: "lmstudio-community/Qwen2.5 Coder:7B Instruct" },
          { id: "second-model" }
        ]
      })
    );

    await expect(listLmStudioModels("http://localhost:1234", { localModelRoot: false })).resolves.toEqual([
      { id: "lmstudio-community/Qwen2.5 Coder:7B Instruct" },
      { id: "second-model" }
    ]);
  });

  it("adds a local GGUF path only when there is one clear model match", async () => {
    const root = await mkdtemp(join(tmpdir(), "lmstudio-models-"));
    const modelDir = join(root, "lmstudio-community", "gemma-4-E4B-it-GGUF");
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, "gemma-4-E4B-it-Q8_0.gguf"), "");
    await writeFile(join(modelDir, "mmproj-gemma-4-E4B-it.gguf"), "");
    mockFetch(() =>
      jsonResponse({
        data: [{ id: "google/gemma-4-e4b" }]
      })
    );

    try {
      await expect(listLmStudioModels(undefined, { localModelRoot: root })).resolves.toEqual([
        {
          id: "google/gemma-4-e4b",
          localPath: join(modelDir, "gemma-4-E4B-it-Q8_0.gguf")
        }
      ]);
      await expect(discoverLocalGgufModels(root)).resolves.toEqual([
        join(modelDir, "gemma-4-E4B-it-Q8_0.gguf")
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not attach a local path when matching is ambiguous", async () => {
    const root = await mkdtemp(join(tmpdir(), "lmstudio-models-"));
    await mkdir(join(root, "a"), { recursive: true });
    await mkdir(join(root, "b"), { recursive: true });
    await writeFile(join(root, "a", "qwen2-5-vl-q8.gguf"), "");
    await writeFile(join(root, "b", "qwen2-5-vl-q4.gguf"), "");
    mockFetch(() =>
      jsonResponse({
        data: [{ id: "local/qwen2.5-vl" }]
      })
    );

    try {
      await expect(listLmStudioModels(undefined, { localModelRoot: root })).resolves.toEqual([
        { id: "local/qwen2.5-vl" }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed model responses clearly", async () => {
    mockFetch(() => jsonResponse({ data: [{ id: 123 }] }));

    await expect(listLmStudioModels()).rejects.toThrow(/malformed.*models/i);
  });

  it("rejects failed model list responses with HTTP status", async () => {
    mockFetch(() => jsonResponse({ error: "Nope" }, { status: 500 }));

    await expect(listLmStudioModels()).rejects.toThrow(/HTTP 500.*models/i);
  });
});

describe("passive LM Studio requests", () => {
  it("rejects aborted requests with abort context", async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
    });

    await expect(
      listLmStudioModels(undefined, { signal: controller.signal })
    ).rejects.toThrow(/aborted/i);
  });
});
