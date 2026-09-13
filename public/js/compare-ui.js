import { assetHref } from "./assets.js";
import { MAX_COMPARE_SELECTIONS } from "./compare.js";
import { icon } from "./icons.js";
import { stackAttemptIdentity } from "./runs.js";
import { renderStackSummary } from "./stack-pills.js";
import { escapeAttribute, escapeHtml } from "./utils.js";

export function renderComparePreviewGrid(selectedRuns, context = {}) {
  const headingIcon = icon("columns-3");
  const selectionCount = '<span>' + String(selectedRuns.length) + "/" + String(MAX_COMPARE_SELECTIONS) + " selected</span>";

  if (selectedRuns.length === 0) {
    return '<section class="compare-panel" aria-label="Selected compare runs">' +
      '<div class="compare-panel-head"><h3>' + headingIcon + 'Visual comparison</h3><div class="compare-panel-actions">' + selectionCount + '</div></div>' +
      '<p class="compare-panel-empty">Select runs to start comparing outputs.</p></section>';
  }

  // Data-science: score matrix instead of visual grid
  const allDs = selectedRuns.every(function(r) { return (r.kind ?? "visual") === "data-science"; });
  const allHaveScorecards = selectedRuns.every(function(r) { return Boolean(r.dsScorecard); });
  if (allDs && allHaveScorecards && selectedRuns.length >= 2) {
    return renderDsScoreMatrix(selectedRuns, context);
  }

  const exportButton = context.canOperate
    ? '<button type="button" class="btn-sm-outline operational-control" data-export-compare-video ' + exportButtonAttrs(selectedRuns, context) + '>' + headingIcon + (context.comparisonExportBusy ? "Exporting…" : "Export video") + '</button>'
    : "";
  const heading = '<div class="compare-panel-head"><h3>' + headingIcon + 'Visual comparison</h3><div class="compare-panel-actions">' + exportButton + selectionCount + '</div></div>';

  return (
    '<section class="compare-panel" aria-label="Selected compare runs">' +
      heading +
      '<div class="compare-grid" data-count="' + String(selectedRuns.length) + '">' + selectedRuns.map(renderComparePreviewCard).join("") + "</div>" +
    "</section>"
  );
}

function exportButtonAttrs(selectedRuns, context) {
  const missingVideo = selectedRuns.some((run) => !run.assets?.videoMp4 && !run.assets?.video);
  const disabled = !context.canOperate || context.comparisonExportBusy || selectedRuns.length < 2 || missingVideo;
  const title = missingVideo
    ? "Every selected run needs captured video before export."
    : selectedRuns.length < 2
      ? "Select at least two runs."
      : "Export selected videos as one branded MP4.";
  return 'title="' + escapeAttribute(title) + '" ' + (disabled ? "disabled" : "");
}

function renderComparePreviewCard(run) {
  const title = run.benchmark?.title ?? run.benchmark?.id ?? "Untitled run";
  const model = run.model?.id ?? "Unknown model";
  const stack = stackAttemptIdentity(run);
  const kind = run.kind ?? "visual";
  const isDs = kind === "data-science";
  const videoHref = isDs ? null : assetHref(run, run.assets?.videoMp4 ?? run.assets?.video);
  const previewHref = isDs
    ? assetHref(run, run.assets?.ds?.chartTreatmentEffect ?? run.assets?.ds?.chartDistribution)
    : assetHref(run, run.assets?.preview);

  let mediaHtml = '';
  let overlayHtml = '';
  if (videoHref) {
    mediaHtml = '<video class="h-full w-full object-cover" data-managed-loop-video autoplay muted playsinline preload="auto" ' +
      (previewHref ? 'poster="' + escapeAttribute(previewHref) + '" ' : '') +
      'src="' + escapeAttribute(videoHref) + '"></video>';
    overlayHtml = '<div class="video-ring"></div><div class="play-overlay"><div class="play-btn"></div></div>';
  } else if (previewHref) {
    const objectFit = isDs ? 'object-contain' : 'object-cover';
    mediaHtml = '<img class="h-full w-full ' + objectFit + '" src="' + escapeAttribute(previewHref) + '" alt="" loading="lazy" />';
  } else {
    mediaHtml = '<div class="preview-placeholder"><strong>No captured media</strong></div>';
  }

  // DS score badge overlay
  let scoreOverlay = '';
  if (isDs && run.dsScorecard) {
    var sc = run.dsScorecard;
    var pct = sc.pct ?? 0;
    var tone = pct >= 90 ? 'great' : pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'low';
    scoreOverlay = '<div class="ds-score-float" data-tone="' + escapeAttribute(tone) + '">' + String(sc.earned ?? 0) + '/' + String(sc.total ?? 0) + '</div>';
  }

  // Compact meta pills
  var pills = '<span class="meta-pill meta-pill-model">' + escapeHtml(model) + '</span>';
  if (stack.harness) {
    pills += '<span class="meta-pill meta-pill-harness">' + escapeHtml(stack.harness) + '</span>';
  }
  if (stack.backend && stack.backend !== stack.harness) {
    pills += '<span class="meta-pill meta-pill-backend">' + escapeHtml(stack.backend) + '</span>';
  }

  const ribbon = isDs && run.dsSummary ? renderCompareRibbon(run.dsSummary) : '';

  return (
    '<article class="compare-card" data-compare-run>' +
      '<div class="compare-media">' + mediaHtml + overlayHtml + scoreOverlay + '</div>' +
      (ribbon ? '<div class="compare-card-ribbon">' + ribbon + '</div>' : '') +
      '<div class="compare-card-meta">' +
        '<strong class="compare-card-title truncate-line">' + escapeHtml(title) + '</strong>' +
        '<span class="compare-card-prompt truncate-line">' + escapeHtml(model) + '</span>' +
        '<div class="compare-card-pills">' + pills + '</div>' +
      '</div>' +
    '</article>'
  );
}
function renderCompareRibbon(summary) {
  const tone = summary.status === 'significant'
    ? (summary.recommended_variant === 'B' ? 'safe' : 'danger')
    : summary.status === 'not_significant'
      ? 'caution'
      : 'caution';
  const label = summary.status === 'significant'
    ? (summary.recommended_variant === 'B' ? 'Ship B' : 'Ship A')
    : 'Inconclusive';
  return '<span class="verdict-pill verdict-pill-sm" data-verdict="' + escapeAttribute(tone) + '">' + escapeHtml(label) + '</span>';
}

function renderDsScoreMatrix(selectedRuns, context) {
  // Collect all check IDs across all runs (union), sorted by max weight (high to low)
  var checkMeta = new Map();
  selectedRuns.forEach(function(run) {
    var checks = run.dsScorecard?.checks ?? {};
    Object.entries(checks).forEach(function(entry) {
      var id = entry[0];
      var c = entry[1];
      if (!checkMeta.has(id)) {
        checkMeta.set(id, { label: c.label, max: c.max });
      }
    });
  });
  var checkIds = Array.from(checkMeta.keys()).sort(function(a, b) {
    return checkMeta.get(b).max - checkMeta.get(a).max;
  });

  if (checkIds.length === 0) {
    return '<section class="compare-panel" aria-label="Score comparison">' +
      '<div class="compare-panel-head"><h3>' + icon("columns-3") + 'Score comparison</h3><div class="compare-panel-actions"><span>' + String(selectedRuns.length) + '/' + String(MAX_COMPARE_SELECTIONS) + ' selected</span></div></div>' +
      '<p class="compare-panel-empty">No scorecard checks to compare.</p></section>';
  }

  var heading = '<div class="compare-panel-head"><h3>' + icon("table-2") + 'Score comparison</h3><div class="compare-panel-actions"><span>' + String(selectedRuns.length) + '/' + String(MAX_COMPARE_SELECTIONS) + ' selected</span></div></div>';

  // Table header
  var thead = '<thead><tr><th class="ds-matrix-check-col">Check</th>' +
    selectedRuns.map(function(run) {
      return '<th class="ds-matrix-run-col">' + renderDsMatrixRunHeader(run) + '</th>';
    }).join('') +
    '</tr></thead>';

  // Table body — one row per check
  var tbody = '<tbody>' +
    checkIds.map(function(checkId) {
      return '<tr>' +
        '<td class="ds-matrix-check-col"><span class="ds-matrix-check-label">' + escapeHtml(checkMeta.get(checkId).label) + '</span><span class="ds-matrix-check-max">' + String(checkMeta.get(checkId).max) + ' pts</span></td>' +
        selectedRuns.map(function(run) {
          var checks = run.dsScorecard?.checks ?? {};
          var c = checks[checkId];
          return renderDsMatrixCell(c);
        }).join('') +
        '</tr>';
    }).join('') +
    '</tbody>';

  // Totals row
  var tfoot = '<tfoot><tr>' +
    '<td class="ds-matrix-check-col"><strong>Total</strong></td>' +
    selectedRuns.map(function(run) {
      var sc = run.dsScorecard;
      var pct = sc?.pct ?? 0;
      var earned = sc?.earned ?? 0;
      var total = sc?.total ?? 0;
      var tone = pct >= 80 ? 'safe' : pct >= 50 ? 'caution' : 'danger';
      return '<td class="ds-matrix-run-col"><span class="ds-matrix-total" data-tone="' + escapeAttribute(tone) + '">' +
        String(earned) + '/' + String(total) + ' (' + String(pct) + '%)' +
        '</span></td>';
    }).join('') +
    '</tr></tfoot>';

  return '<section class="compare-panel" aria-label="Score comparison">' +
    heading +
    '<div class="ds-matrix-wrap">' +
      '<table class="ds-score-matrix">' + thead + tbody + tfoot + '</table>' +
    '</div>' +
    '</section>';
}

function renderDsMatrixRunHeader(run) {
  var model = escapeHtml(run.model?.id ?? "Unknown model");
  var bench = escapeHtml(run.benchmark?.title ?? run.benchmark?.id ?? "Untitled");
  var verdict = '';
  if (run.dsSummary) {
    var tone = run.dsSummary.status === 'significant'
      ? (run.dsSummary.recommended_variant === 'B' ? 'safe' : 'danger')
      : 'caution';
    var label = run.dsSummary.status === 'significant'
      ? (run.dsSummary.recommended_variant === 'B' ? 'Ship B' : 'Ship A')
      : 'Inconclusive';
    verdict = '<span class="verdict-pill verdict-pill-sm" data-verdict="' + escapeAttribute(tone) + '">' + escapeHtml(label) + '</span>';
  }
  return '<div class="ds-matrix-run-header">' +
    '<strong class="ds-matrix-run-model">' + model + '</strong>' +
    '<span class="ds-matrix-run-bench">' + bench + '</span>' +
    verdict +
    '</div>';
}

function renderDsMatrixCell(check) {
  if (!check) {
    return '<td class="ds-matrix-run-col ds-matrix-na"><span class="ds-matrix-cell">—</span></td>';
  }
  var passClass = check.pass ? 'ds-matrix-pass' : 'ds-matrix-fail';
  var icon = check.pass ? '\u2713' : '\u2717';
  var detail = check.detail ? ' title="' + escapeAttribute(check.detail) + '"' : '';
  return '<td class="ds-matrix-run-col ' + passClass + '"' + detail + '>' +
    '<span class="ds-matrix-cell"><span class="ds-matrix-icon">' + icon + '</span>' + String(check.earned) + '/' + String(check.max) + '</span>' +
    '</td>';
}

export function syncManagedCompareVideos(root = document) {
  root.querySelectorAll("[data-managed-loop-video]").forEach((video) => {
    if (video.dataset.loopManaged === "true") return;
    video.dataset.loopManaged = "true";

    const resetNearLoopBoundary = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (video.currentTime >= video.duration - 0.18) {
        video.currentTime = Math.min(0.05, Math.max(0, video.duration - 0.25));
        void video.play().catch(() => {});
      }
    };

    video.addEventListener("timeupdate", resetNearLoopBoundary);
    video.addEventListener("ended", () => {
      video.currentTime = 0.05;
      void video.play().catch(() => {});
    });
  });
}