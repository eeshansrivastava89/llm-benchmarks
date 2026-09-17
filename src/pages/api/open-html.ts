import {
  getDefaultLocalApi,
  writeJsonRoute,
  type OpenRunHtmlRequest
} from "../../server/api";

export const prerender = false;

export const POST = writeJsonRoute<OpenRunHtmlRequest>((body) =>
  getDefaultLocalApi().openRunHtml(body)
);
