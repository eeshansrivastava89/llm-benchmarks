import {
  getDefaultLocalApi,
  writeJsonRoute,
  type CaptureMediaRequest
} from "../../server/api";

export const prerender = false;

export const POST = writeJsonRoute<CaptureMediaRequest>((body) =>
  getDefaultLocalApi().captureMissingMedia(body)
);
