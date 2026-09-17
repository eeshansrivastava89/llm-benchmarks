import {
  getDefaultLocalApi,
  writeJsonRoute,
  type OpenRunFolderRequest
} from "../../server/api";

export const prerender = false;

export const POST = writeJsonRoute<OpenRunFolderRequest>((body) =>
  getDefaultLocalApi().openRunFolder(body)
);
