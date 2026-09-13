import type { APIRoute } from "astro";
import {
  apiJsonResponse,
  assertTrustedWriteRequest,
  getDefaultLocalApi,
  readJsonRequest,
  type CaptureMediaRequest
} from "../../server/api";

export const prerender = false;

export const POST: APIRoute = async ({ request }) =>
  apiJsonResponse(
    Promise.resolve()
      .then(() => assertTrustedWriteRequest(request))
      .then(() => readJsonRequest(request))
      .then((body) =>
        getDefaultLocalApi().captureMissingMedia(body as CaptureMediaRequest)
      )
  );
