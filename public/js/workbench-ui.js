import { assetHref } from "./assets.js";
import { compareRunKey, selectedCompareRuns } from "./compare.js";
import { renderComparePreviewGrid } from "./compare-ui.js";
import { icon } from "./icons.js";
import { displayRunError, hasCapturedVideo, needsDsScoring, needsMediaCapture, runCardIdentity, runCardMediaMessage, runCardState, runKind, stackAttemptIdentity } from "./runs.js";
import { renderStackSummary } from "./stack-pills.js";
import { escapeAttribute, escapeHtml, formatDateShort } from "./utils.js";

export function renderRunsTable(runs, context) {
  const totalPages = Math.max(1, Math.ceil(runs.length / context.runsPerPage));
  const runPage = Math.min(Math.max(context.runPage, 1), totalPages);
  const startIndex = (runPage - 1) * context.runsPerPage;
  const pageRuns = runs.slice(startIndex, startIndex + context.runsPerPage);
  const showingStart = runs.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(runs.length, startIndex + pageRuns.length);

  return {
    runPage,
    totalPages,
    html:
      '<div class="runs-table-wrap">' +
        '<table class="runs-table">' +
          '<thead>' +
            '<tr>' +
              '<th class="runs-table-select"><span class="sr-only">Compare</span></th>' +
              '<th>Prompt</th>' +
              '<th>Model</th>' +
              '<th>Stack</th>' +
              '<th>Status</th>' +
              '<th>Message</th>' +
              '<th>Updated</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' +
            pageRuns.map((run) => renderRunsTableRow(run, context)).join("") +
          '</tbody>' +
        '</table>' +
      '</div>' +
      renderRunsPagination(showingStart, showingEnd, runs.length, totalPages, runPage) +
      renderComparePreviewGrid(selectedCompareRuns(runs, context.compareSelection ?? []), context)
  };
}

export function renderGroupedRuns(groups, mode, context) {
  return '<div class="grouped-runs">' + groups.map((group) =>
    '<section class="group">' +
      '<div class="group-head">' +
        "<div>" +
          '<span class="group-title-row">' +
            '<h3 class="text-base font-semibold tracking-[-0.01em]">' + escapeHtml(group.title) + "</h3>" +
            renderPromptPill(group, mode) +
          "</span>" +
          '<p class="muted-copy mt-1 text-sm">' + escapeHtml(groupSummary(group, mode)) + "</p>" +
        "</div>" +
        '<span class="badge-outline">' + group.runs.length + "</span>" +
      "</div>" +
      '<div class="run-grid">' + group.runs.map((run) => renderRunCard(run, mode, context)).join("") + "</div>" +
    "</section>"
  ).join("") + "</div>";
}

function renderRunsTableRow(run, context) {
  const isCapturing = context.captureRunDirectory && run.runDirectory === context.captureRunDirectory;
  const isScoring = context.scoreRunDirectory && run.runDirectory === context.scoreRunDirectory;
  const stateLabel = isCapturing
    ? { status: "prepared", label: "Capturing" }
    : isScoring
      ? { status: "prepared", label: "Scoring" }
      : runCardState(run);
  const title = run.benchmark?.title ?? run.benchmark?.id ?? run.runner?.metricSource ?? "Untitled run";
  const model = run.model?.id ?? run.runner?.model ?? "Unknown model";
  const stack = stackAttemptIdentity(run);
  const compareKey = compareRunKey(run);
  const selected = (context.compareSelection ?? []).includes(compareKey);
  const compareLabel = "Compare " + title + " " + model + " " + stack.harness;
  return (
    '<tr class="run-row" data-open-run data-run-id="' + escapeAttribute(run.runId) + '" tabindex="0" role="button" aria-label="' +
      escapeAttribute(title + " " + model) + '">' +
      '<td class="runs-table-select">' +
        '<input type="checkbox" data-compare-select="' + escapeAttribute(compareKey) + '" aria-label="' + escapeAttribute(compareLabel) + '" ' + (selected ? "checked" : "") + " />" +
      "</td>" +
      '<td class="run-title-cell"><strong class="truncate-line">' + escapeHtml(title) + "</strong></td>" +
      '<td class="truncate-cell">' + escapeHtml(model) + "</td>" +
      '<td class="truncate-cell">' + renderStackSummary(stack) + "</td>" +
      '<td><span class="run-state-pill"><span class="status-dot" data-status="' + escapeAttribute(stateLabel.status) + '"></span>' + escapeHtml(stateLabel.label) + "</span></td>" +
      '<td class="truncate-cell">' + escapeHtml(runCardMediaMessage(run, isCapturing, isScoring)) + "</td>" +
      '<td class="truncate-cell">' + escapeHtml(formatDateShort(run.updatedAt ?? run.createdAt)) + "</td>" +
    "</tr>"
  );
}

function renderRunCard(run, mode, context) {
  const isCapturing = context.captureRunDirectory && run.runDirectory === context.captureRunDirectory;
  const isScoring = context.scoreRunDirectory && run.runDirectory === context.scoreRunDirectory;
  const stateLabel = isCapturing
    ? { status: "prepared", label: "Capturing" }
    : isScoring
      ? { status: "prepared", label: "Scoring" }
      : runCardState(run);
  const identity = runCardIdentity(run, mode);
  const stack = stackAttemptIdentity(run);
  const kind = runKind(run);
  const isScoredDs = kind === "data-science" && Boolean(run.dsScorecard);
  const hasVideo = kind === "visual" && hasCapturedVideo(run);

  return (
    '<article class="run-card" data-open-run data-run-id="' + escapeAttribute(run.runId) + '" tabindex="0" role="button" aria-label="' +
    escapeAttribute(run.benchmark?.title ?? "Run") + " " + escapeAttribute(run.model?.id ?? "") + '">' +
      renderPreview(run, { capturing: isCapturing, scoring: isScoring }) +
      '<span class="run-card-body">' +
        '<span class="run-card-title-row">' +
          '<strong class="truncate-line">' + escapeHtml(identity.primary) + "</strong>" +
        "</span>" +
        '<span class="run-card-meta">' +
          renderMetaPills(run, stack) +
        "</span>" +
        '<span class="run-card-footer">' +
          '<span class="status-label">' +
            '<span class="status-dot" data-status="' + escapeAttribute(stateLabel.status) + '"></span>' +
            escapeHtml(stateLabel.label) +
          "</span>" +
          '<span class="card-date">' + escapeHtml(formatDateShort(run.updatedAt ?? run.createdAt)) + "</span>" +
        "</span>" +
      "</span>" +
    "</article>"
  );
}

function renderMetaPills(run, stack) {
  const model = escapeHtml(run.model?.id ?? run.model?.slug ?? "unknown");
  const harness = escapeHtml(stack.harness ?? "");
  const backend = escapeHtml(stack.backend ?? "");
  let pills = '<span class="meta-pill meta-pill-model">' + model + "</span>";
  if (harness) {
    pills += '<span class="meta-pill meta-pill-harness">' + harness + "</span>";
  }
  if (backend && backend !== harness) {
    pills += '<span class="meta-pill meta-pill-backend">' + backend + "</span>";
  }
  return pills;
}

function renderRunCaptureAction(run, isCapturing, context) {
  const kind = runKind(run);

  // Data-science: score button
  if (kind === "data-science") {
    const canScore = context.canOperate &&
      needsDsScoring(run);
    const hasScorecard = run.assets?.ds?.scorecard;
    const canRescore = context.canOperate &&
      run.runDirectory && hasScorecard;
    if (!canScore && !canRescore) return "";

    const isScoring = context.scoreRunDirectory && run.runDirectory === context.scoreRunDirectory;
    const label = hasScorecard ? "Rescore" : "Score";
    const title = run.benchmark?.title ?? run.benchmark?.id ?? "run";
    const model = run.model?.id ?? "unknown model";
    return (
      '<span class="run-card-actions" data-placement="card">' +
        '<button type="button" class="btn-sm-outline run-card-score operational-control" data-score-run-id="' + escapeAttribute(run.runId) + '" ' +
          'aria-label="' + escapeAttribute(label + " " + title + " on " + model) + '"' +
          (isScoring || context.scoreBusy ? " disabled" : "") + '>' +
          icon("check-circle") + escapeHtml(isScoring ? "Scoring..." : label) +
        '</button>' +
      '</span>'
    );
  }

  // Visual: capture button
  const canCapture = context.canOperate &&
    needsMediaCapture(run);
  if (!canCapture) {
    return "";
  }

  const label = "Capture preview";
  const title = run.benchmark?.title ?? run.benchmark?.id ?? "run";
  const model = run.model?.id ?? "unknown model";
  return (
    '<span class="run-card-actions" data-placement="card">' +
      '<button type="button" class="btn-sm-outline run-card-capture operational-control" data-capture-run-id="' + escapeAttribute(run.runId) + '" ' +
        'aria-label="' + escapeAttribute(label + " for " + title + " on " + model) + '"' +
        (isCapturing || context.captureBusy ? " disabled" : "") + '>' +
        icon("camera") + escapeHtml(isCapturing ? "Capturing..." : label) +
      '</button>' +
    '</span>'
  );
}

function renderRunsPagination(showingStart, showingEnd, totalRuns, totalPages, runPage) {
  return (
    '<div class="runs-pagination" aria-label="Runs pagination">' +
      '<span class="muted-copy text-sm">' +
        "Showing " + String(showingStart) + "-" + String(showingEnd) + " of " + String(totalRuns) +
      "</span>" +
      '<div class="pagination-controls">' +
        '<button type="button" class="btn-sm-outline" id="runsPrevPage" ' + (runPage <= 1 ? "disabled" : "") + ">" + icon("chevron-left") + "Previous</button>" +
        '<span class="badge-outline">Page ' + String(runPage) + " of " + String(totalPages) + "</span>" +
        '<button type="button" class="btn-sm-outline" id="runsNextPage" ' + (runPage >= totalPages ? "disabled" : "") + ">Next" + icon("chevron-right") + "</button>" +
      "</div>" +
    "</div>"
  );
}

function renderCaptureOverlay(capturing) {
  if (!capturing) {
    return "";
  }

  return '<span class="capture-overlay" aria-live="polite"><span class="capture-spinner" aria-hidden="true"></span><strong>Capturing</strong></span>';
}

function renderPreview(run, options = {}) {
  if (runKind(run) === "data-science") {
    return renderDsPreview(run, options);
  }
  const previewHref = assetHref(run, run.assets?.preview);
  const hasVideo = hasCapturedVideo(run);
  if (previewHref) {
    let html = '<span class="preview">' +
      '<img src="' + escapeAttribute(previewHref) + '" alt="" loading="lazy" />';
    if (hasVideo && !options.capturing) {
      html += '<div class="video-ring"></div>' +
        '<div class="play-overlay"><div class="play-btn"></div></div>';
    }
    html += '<div class="preview-fade"></div>';
    html += renderCaptureOverlay(options.capturing);
    html += '</span>';
    return html;
  }

  return (
    '<span class="preview">' + renderCaptureOverlay(options.capturing) +
      '<span class="preview-placeholder">' +
        "<strong>" + escapeHtml(run.assets?.html ? "HTML source saved" : "No preview yet") + '</strong>' +
      '<span class="muted-copy max-w-60 text-sm leading-5">' + escapeHtml(run.status === "prepared" ? "Paste the prompt into your tool." : displayRunError(run) ?? "Add preview.png for gallery thumbnails.") + '</span>' +
    '</span>' +
    '</span>'
  );
}

function renderDsPreview(run, options = {}) {
  const thumbnail = assetHref(run, run.assets?.ds?.chartTreatmentEffect ?? run.assets?.ds?.chartDistribution);
  const isScored = Boolean(run.dsScorecard);
  let scoreOverlay = "";
  if (isScored && !options.scoring) {
    var sc = run.dsScorecard;
    var pct = sc.pct ?? 0;
    var tone = pct >= 90 ? 'great' : pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'low';
    scoreOverlay = '<div class="ds-score-float" data-tone="' + escapeAttribute(tone) + '">' + String(sc.earned ?? 0) + '/' + String(sc.total ?? 0) + '</div>';
  }
  if (thumbnail) {
    return '<span class="preview"><img src="' + escapeAttribute(thumbnail) + '" alt="" loading="lazy" />' + scoreOverlay + renderCaptureOverlay(options.capturing) + '</span>';
  }
  const hasDsOutput = run.assets?.ds?.summary;
  const label = hasDsOutput ? "Analysis in progress" : "No output yet";
  return (
    '<span class="preview">' + renderCaptureOverlay(options.capturing) + scoreOverlay +
      '<span class="preview-placeholder">' +
        '<strong>' + escapeHtml(label) + '</strong>' +
        '<span class="muted-copy max-w-60 text-sm leading-5">' + escapeHtml(run.status === "prepared" ? "Paste the prompt into your harness." : displayRunError(run) ?? "Run the analysis to generate charts.") + '</span>' +
      '</span>' +
    '</span>'
  );
}

function renderPromptPill(group, mode) {
  const prompt = mode === "benchmark" ? group.runs.find((run) => run.benchmark?.prompt)?.benchmark?.prompt : "";
  if (!prompt) return "";
  const title = group.runs.find((run) => run.benchmark?.title)?.benchmark?.title ?? group.title;
  return (
    '<button type="button" class="prompt-preview-pill" data-tooltip="Benchmark prompt" data-tooltip-kind="prompt" data-tooltip-html="' +
      escapeAttribute(renderPromptTooltip(title, prompt)) +
      '" aria-label="See benchmark prompt for ' + escapeAttribute(title) + '">' +
      'See prompt' +
    "</button>"
  );
}

function renderPromptTooltip(title, prompt) {
  return (
    '<div class="prompt-tooltip-card">' +
      '<div class="prompt-tooltip-kicker">BENCHMARK PROMPT</div>' +
      '<div class="prompt-tooltip-title">' + escapeHtml(title) + "</div>" +
      '<div class="prompt-tooltip-body">' + escapeHtml(prompt) + "</div>" +
    "</div>"
  );
}

function groupSummary(group, mode) {
  const count = group.subtitles.length;
  const item = mode === "model" ? "prompt" : "model";
  return String(count) + " " + item + (count === 1 ? "" : "s");
}
