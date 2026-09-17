import {
  getDefaultLocalApi,
  writeJsonRoute,
  type ScoreDsRunRequest
} from "../../server/api";

export const prerender = false;

export const POST = writeJsonRoute<ScoreDsRunRequest>((body) =>
  getDefaultLocalApi().scoreDsRun(body)
);
