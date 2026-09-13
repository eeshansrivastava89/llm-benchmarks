import { els } from "./dom.js";
import { state } from "./state.js";
import { fetchJson } from "./api.js";
import { escapeHtml, formatBytes } from "./utils.js";

export async function loadMachineProfile() {
  if (state.staticMode) {
    renderMachineProfile(state.machineProfile);
    return;
  }

  try {
    const data = await fetchJson("/api/system-stats");
    state.machineProfile = data.stats ?? null;
    renderMachineProfile(state.machineProfile);
  } catch (error) {
    els.statsDot.dataset.state = "offline";
    els.statsCompact.textContent = "Machine unknown";
    els.statsPill.dataset.tooltip = "Machine profile unavailable: " + error.message;
    delete els.statsPill.dataset.tooltipHtml;
  }
}

export function renderMachineProfile(profile) {
  if (!profile) {
    els.statsDot.dataset.state = "checking";
    els.statsCompact.textContent = "Machine";
    els.statsPill.dataset.tooltip = "Machine profile loading.";
    return;
  }

  const chip = profile.hardware?.chipType ?? profile.cpu?.model ?? "Local machine";
  const memory = profile.hardware?.physicalMemory ?? formatBytes(profile.memory?.totalBytes);
  const gpu = profile.gpu?.devices?.[0];
  const gpuLabel = gpu?.name ?? "GPU telemetry unavailable";
  const gpuCores = gpu?.cores ? gpu.cores + " GPU cores" : "GPU cores unavailable";
  const vram = gpu?.vram ?? "Unified memory (shared)";
  const display = gpu?.displays?.[0] ?? "Display details unavailable";
  const metal = gpu?.metalSupport ?? "Metal support unknown";

  els.statsDot.dataset.state = "online";
  els.statsCompact.textContent = shortChip(chip) + " · " + memory;
  els.statsPill.dataset.tooltip = chip + " · " + memory;
  els.statsPill.dataset.tooltipKind = "machine";
  els.statsPill.dataset.tooltipHtml = renderMachineTooltip({
    chip,
    memory,
    gpuLabel,
    gpuCores,
    vram,
    display,
    metal,
    machine: profile.hardware?.machineName || profile.os?.hostname || "local host",
    modelId: profile.hardware?.machineModel || "Model ID unavailable",
    cpu: String(profile.cpu?.cores ?? "-") + " CPU cores",
    os: [profile.os?.type, profile.os?.release, profile.platform?.arch].filter(Boolean).join(" · "),
    node: profile.platform?.node ?? "-",
    captured: profile.collectedAt ?? "-"
  });
}

function renderMachineTooltip(profile) {
  return (
    '<div class="machine-tooltip-card">' +
      '<div class="machine-tooltip-kicker">LOCAL RIG PROFILE</div>' +
      '<div class="machine-tooltip-title">' + escapeHtml(profile.chip) + "</div>" +
      '<div class="machine-tooltip-grid">' +
        metric("Machine", profile.machine) +
        metric("Model ID", profile.modelId) +
        metric("CPU", profile.cpu) +
        metric("GPU", profile.gpuLabel) +
        metric("GPU cores", profile.gpuCores) +
        metric("VRAM", profile.vram) +
        metric("Memory", profile.memory) +
        metric("Display", profile.display) +
        metric("Metal", profile.metal) +
        metric("Node", profile.node) +
      "</div>" +
      '<div class="machine-tooltip-footer"><span>Profile captured ' + escapeHtml(formatDate(profile.captured)) + "</span></div>" +
    "</div>"
  );
}

function metric(label, value) {
  return '<div class="machine-tooltip-metric"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
}

function shortChip(chip) {
  return String(chip).replace(/^Apple\s+/iu, "");
}

function formatDate(value) {
  return value && value !== "-" ? new Date(value).toLocaleString() : "-";
}
