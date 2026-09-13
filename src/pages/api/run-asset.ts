import type { APIRoute } from "astro";
import { readRunAsset } from "../../lib/run-assets";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const runDirectory = url.searchParams.get("runDirectory");
  const asset = url.searchParams.get("asset");

  if (!runDirectory || !asset) {
    return jsonError(400, "runDirectory and asset are required.");
  }

  try {
    const file = await readRunAsset({
      runDirectory,
      asset
    });

    const body = file.body.buffer.slice(
      file.body.byteOffset,
      file.body.byteOffset + file.body.byteLength
    ) as ArrayBuffer;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : String(error));
  }
};

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message
      }
    }),
    {
      status,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}
