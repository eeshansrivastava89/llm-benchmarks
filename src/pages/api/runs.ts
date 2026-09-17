import type { APIRoute } from "astro";
import {
  apiJsonResponse,
  getDefaultLocalApi,
  writeJsonRoute,
  type DeleteRunRequest,
  type UpdateRunMetadataRequest
} from "../../server/api";

export const prerender = false;

export const GET: APIRoute = () =>
  apiJsonResponse(getDefaultLocalApi().getSavedRuns());

export const PATCH = writeJsonRoute<UpdateRunMetadataRequest>((body) =>
  getDefaultLocalApi().updateSavedRunMetadata(body)
);

export const DELETE = writeJsonRoute<DeleteRunRequest>((body) =>
  getDefaultLocalApi().deleteSavedRun(body)
);
