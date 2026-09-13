import { state } from "./state.js";
import { staticExportUrl } from "./api.js";

function assetPath(run, asset) {
  if (!asset || !run.runDirectory) return "";
  return String(run.runDirectory).replace(/\/+$/u, "") + "/" + asset;
}

export function assetHref(run, asset) {
  const path = assetPath(run, asset);
  if (!path) return null;
  const version = assetVersion(run, asset);
  if (/^[a-z][a-z0-9+.-]*:/iu.test(path)) return path;
  if (state.staticMode || path.startsWith("export/")) {
    return appendAssetVersion(staticExportUrl(path), version);
  }
  return "/api/run-asset?runDirectory=" + encodeURIComponent(run.runDirectory) +
    "&asset=" + encodeURIComponent(asset) +
    (version ? "&v=" + encodeURIComponent(version) : "");
}

function assetVersion(run, asset) {
  if (!asset) return "";
  if (asset === run.assets?.preview) {
    return run.capture?.preview?.capturedAt ?? run.updatedAt ?? "";
  }
  if (asset === run.assets?.video || asset === run.assets?.videoMp4) {
    return run.capture?.video?.capturedAt ?? run.updatedAt ?? "";
  }
  return run.updatedAt ?? "";
}

function appendAssetVersion(path, version) {
  if (!version) return path;
  return path + (path.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(version);
}
