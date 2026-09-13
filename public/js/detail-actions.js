import { els } from "./dom.js";
import { wireChartClicks } from "./chart-lightbox.js";
import { state } from "./state.js";
import { escapeAttribute, escapeHtml } from "./utils.js";
import { deleteJson, patchJson, postJson } from "./api.js";
import { detailActionAvailability, detailViewModel } from "./detail-ui.js";
import { runKind } from "./runs.js";
import { closeModal, openModal } from "./modals.js";
import { canUseOperationalControls, setOperationalAvailability, syncOperationalControls } from "./operational-controls.js";
import { copyTextToClipboard } from "./clipboard.js";
import { setButtonLabel } from "./icons.js";
import { scoreDsRun } from "./score-controller.js";
import { renderHarnesses, renderModelSources, renderModels, renderRuns } from "./workbench-controller.js";

export async function copyDetailPrompt() {
  const text = els.detailPrompt.textContent ?? "";
  await copyTextToClipboard(text, els.copyDetailPrompt, "Copy prompt");
}

export function requestDeleteSelectedRun() {
  const run = state.selectedRun;
  if (!run?.runDirectory || !canUseOperationalControls()) {
    return;
  }

  els.deleteRunPath.textContent = run.runDirectory;
  openModal("deleteConfirm");
}

export async function confirmDeleteSelectedRun() {
  const run = state.selectedRun;
  if (!run?.runDirectory || !canUseOperationalControls()) {
    closeModal("deleteConfirm");
    return;
  }

  els.confirmDeleteRun.disabled = true;
  if (els.deleteRun) els.deleteRun.disabled = true;
  try {
    await deleteJson("/api/runs", { runDirectory: run.runDirectory });
    state.runs = state.runs.filter((item) => item.runDirectory !== run.runDirectory);
    closeModal("deleteConfirm");
    closeModal("detail");
    state.selectedRun = null;
    renderModels();
    renderHarnesses();
    renderModelSources();
    renderRuns();
  } catch (error) {
    window.alert("Delete failed: " + error.message);
  } finally {
    els.confirmDeleteRun.disabled = false;
    if (els.deleteRun) els.deleteRun.disabled = false;
  }
}

export async function openSelectedRunHtml() {
  const run = state.selectedRun;
  if (!run?.runDirectory || !run.assets?.html || !canUseOperationalControls()) {
    return;
  }

  els.openHtml.disabled = true;
  try {
    await postJson("/api/open-html", {
      runDirectory: run.runDirectory,
      asset: run.assets.html
    });
  } catch (error) {
    els.detailMeta.innerHTML +=
      '<span class="meta-label">Open HTML</span><strong>' + escapeHtml(error.message) + "</strong>";
  } finally {
    updateDetailActions(run);
  }
}

export async function copySelectedRunPath() {
  const run = state.selectedRun;
  if (!run?.runDirectory) {
    return;
  }

  await copyTextToClipboard(run.runDirectory, els.copyDetailPath, "Copy path");
}

export async function openSelectedRunFolder(button = els.openRunFolder, errorTarget = els.detailMeta) {
  const run = state.selectedRun;
  if (!run?.runDirectory || !canUseOperationalControls()) {
    return;
  }

  button.disabled = true;
  try {
    await postJson("/api/open-run-folder", {
      runDirectory: run.runDirectory
    });
  } catch (error) {
    errorTarget.innerHTML +=
      '<span class="meta-label">Open folder</span><strong>' + escapeHtml(error.message) + "</strong>";
  } finally {
    updateDetailActions(run);
  }
}

export function openDetail(run) {
  state.selectedRun = run;
  renderDetail(run);
  openModal("detail");
}

export function renderDetail(run) {
  const detail = detailViewModel(run);
  els.detailBackdrop.querySelector(".detail-shell")?.setAttribute("data-detail-kind", "visual");
  els.detailTitle.textContent = detail.title;
  els.detailSubtitle.textContent = detail.subtitle;
  els.detailPreview.innerHTML = detail.previewHtml;
  if (runKind(run) === "data-science") {
    els.detailPreview.dataset.ds = "";
    wireChartClicks(els.detailPreview);
  } else {
    delete els.detailPreview.dataset.ds;
  }
  updateDetailActions(run);
  els.detailTextTitle.textContent = detail.textRecord.title;
  els.detailPrompt.textContent = detail.promptText;
  els.promptLength.textContent = detail.promptLength;
  setButtonLabel(els.copyDetailPrompt, detail.textRecord.copyLabel, "copy");
  els.copyDetailPrompt.disabled = !detail.canCopyPrompt;
  els.detailMeta.innerHTML = detail.metaHtml + renderMetadataEditor(run);
  wireMetadataEditor(run);
}

function renderMetadataEditor(run) {
  if (!canUseOperationalControls() || !run?.runDirectory) {
    return "";
  }

  return (
    '<form class="metadata-editor" id="detailMetadataEditor">' +
      '<div class="metadata-editor-head">' +
        '<span class="meta-label">Edit metadata</span>' +
        '<span class="metadata-editor-status" id="detailMetadataEditorStatus" aria-live="polite"></span>' +
      '</div>' +
      '<label class="metadata-editor-field">' +
        '<span>Model</span>' +
        '<input class="input" name="modelId" value="' + escapeAttribute(run.model?.id ?? "") + '" placeholder="Model name" />' +
      '</label>' +
      '<label class="metadata-editor-field">' +
        '<span>Backend</span>' +
        '<select class="input" name="backend">' + renderBackendOptions(currentBackendValue(run)) + '</select>' +
      '</label>' +
      '<label class="metadata-editor-field">' +
        '<span>Coding harness</span>' +
        '<select class="input" name="harness">' + renderHarnessOptions(currentHarnessValue(run)) + '</select>' +
      '</label>' +
      '<button type="submit" class="btn-sm-outline">Save metadata</button>' +
    '</form>'
  );
}

function wireMetadataEditor(run) {
  const form = document.querySelector("#detailMetadataEditor");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveMetadataEditor(run, form);
  });
}

async function saveMetadataEditor(run, form) {
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector("#detailMetadataEditorStatus");
  button.disabled = true;
  status.textContent = "Saving…";
  try {
    const data = await patchJson("/api/runs", {
      runDirectory: run.runDirectory,
      backend: form.elements.backend.value,
      harness: form.elements.harness.value,
      modelId: form.elements.modelId.value
    });
    const nextRun = data.run;
    state.runs = state.runs.map((item) =>
      item.runDirectory === nextRun.runDirectory ? nextRun : item
    );
    state.selectedRun = nextRun;
    renderHarnesses();
    renderModelSources();
    renderRuns();
    renderDetail(nextRun);
    document.querySelector("#detailMetadataEditorStatus").textContent = "Saved.";
  } catch (error) {
    status.textContent = "Save failed: " + error.message;
  } finally {
    button.disabled = false;
  }
}

function renderBackendOptions(selected) {
  return [
    ["llama-cpp", "llama.cpp"],
    ["llama-cpp-mtp", "llama.cpp MTP"],
    ["ollama", "Ollama"],
    ["omlx", "oMLX"],
    ["cloud", "Cloud API"],
    ["unrecorded", "Source unrecorded"]
  ].map(([value, label]) => renderOption(value, label, selected)).join("");
}

function renderHarnessOptions(selected) {
  return [
    ["manual", "Manual chat"],
    ["pi", "Pi"],
    ["opencode", "OpenCode"],
    ["hermes", "Hermes"]
  ].map(([value, label]) => renderOption(value, label, selected)).join("");
}

function renderOption(value, label, selected) {
  return '<option value="' + escapeAttribute(value) + '" ' + (value === selected ? "selected" : "") + ">" + escapeHtml(label) + "</option>";
}

function currentBackendValue(run) {
  const source = run.runner?.modelSource;
  if (source === "ollama") return "ollama";
  if (source === "omlx") return "omlx";
  if (source === "llama-cpp") return "llama-cpp";
  if (source === "llama-cpp-mtp") return "llama-cpp-mtp";
  if (source === "cloud") return "cloud";
  // Fallback for unrecorded or old data
  const backend = String(run.runner?.backendLabel ?? "").toLowerCase();
  if (/omlx/u.test(backend)) return "omlx";
  if (/llama\.cpp|llamacpp/u.test(backend)) return "llama-cpp";
  if (/lm\s*studio|lmstudio/u.test(backend)) return "llama-cpp";
  if (/ollama/u.test(backend)) return "ollama";
  if (/mlx/u.test(backend)) return "mlx";
  if (/cloud/u.test(backend)) return "cloud";
  return "unrecorded";
}

function currentBackendLabel(run) {
  const value = currentBackendValue(run);
  if (value === "cloud") return run.runner?.backendLabel ?? "";
  return "";
}

function currentHarnessValue(run) {
  const harness = String(run.runner?.harnessLabel ?? run.runner?.actualRunner ?? run.runner?.intendedRunner ?? run.tool ?? run.runner?.mode ?? "manual").toLowerCase();
  if (/opencode/u.test(harness)) return "opencode";
  if (/hermes/u.test(harness)) return "hermes";
  if (/\bpi\b/u.test(harness)) return "pi";
  return "manual";
}

export function updateDetailActions(run) {
  const availability = detailActionAvailability(run);
  setOperationalAvailability(els.openHtml, availability.openHtml);
  setOperationalAvailability(els.copyDetailPath, availability.copyPath);
  setOperationalAvailability(els.openRunFolder, availability.openRunFolder);
  setOperationalAvailability(els.recaptureRun, availability.showCapture || availability.showScore);
  setOperationalAvailability(els.deleteRun, availability.deleteRun);
  syncOperationalControls();

  const canOperate = canUseOperationalControls();
  els.openHtml.disabled = !canOperate || !availability.openHtml;
  els.copyDetailPath.disabled = !canOperate || !availability.copyPath;
  els.openRunFolder.disabled = !canOperate || !availability.openRunFolder;
  els.deleteRun.disabled = !canOperate || !availability.deleteRun;

  if (availability.showScore) {
    const isScoring = state.scoreBusy && state.scoreRunDirectory === run.runDirectory;
    els.recaptureRun.disabled = !canOperate || isScoring;
    els.recaptureRun.title = availability.showScore ? "" : "Score needs summary.json in the run folder.";
    setButtonLabel(els.recaptureRun, isScoring ? "Scoring…" : availability.recaptureLabel, "check-circle");
    return;
  }

  els.recaptureRun.disabled = !canOperate || !availability.capture || state.captureBusy;
  els.recaptureRun.title = availability.capture
    ? ""
    : "Recapture needs index.html in this run folder. Click Refresh after adding the file.";
  if (state.captureBusy && state.captureRunDirectory === run.runDirectory) {
    setButtonLabel(els.recaptureRun, "Capturing…", "camera");
    return;
  }
  setButtonLabel(els.recaptureRun, availability.recaptureLabel, "camera");
}
