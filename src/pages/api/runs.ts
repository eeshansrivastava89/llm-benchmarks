import type { APIRoute } from "astro";
import {
  apiJsonResponse,
  assertTrustedWriteRequest,
  getDefaultLocalApi,
  readJsonRequest,
  type DeleteRunRequest,
  type UpdateRunMetadataRequest
} from "../../server/api";

export const prerender = false;

export const GET: APIRoute = () =>
  apiJsonResponse(getDefaultLocalApi().getSavedRuns());

export const PATCH: APIRoute = async ({ request }) =>
  apiJsonResponse(
    Promise.resolve()
      .then(() => assertTrustedWriteRequest(request))
      .then(() => readJsonRequest(request))
      .then((body) =>
        getDefaultLocalApi().updateSavedRunMetadata(body as UpdateRunMetadataRequest)
      )
  );

export const DELETE: APIRoute = async ({ request }) =>
  apiJsonResponse(
    Promise.resolve()
      .then(() => assertTrustedWriteRequest(request))
      .then(() => readJsonRequest(request))
      .then((body) =>
        getDefaultLocalApi().deleteSavedRun(body as DeleteRunRequest)
      )
  );
