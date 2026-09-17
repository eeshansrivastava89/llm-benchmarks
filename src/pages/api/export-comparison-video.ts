import {
  getDefaultLocalApi,
  writeJsonRoute,
  type ExportComparisonVideoRequest
} from "../../server/api";

export const prerender = false;

export const POST = writeJsonRoute<ExportComparisonVideoRequest>((body) =>
  getDefaultLocalApi().exportComparisonVideo(body)
);
