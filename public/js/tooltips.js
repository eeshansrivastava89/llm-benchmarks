import { els } from "./dom.js";
import { clamp } from "./utils.js";

export function wireHelpTooltips() {
  let currentAnchor = null;
  let hideTimer = null;

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (currentAnchor?.dataset.tooltipKind === "prompt" && els.helpTooltip.matches(":hover")) return;
      currentAnchor = null;
      hideHelpTooltip();
    }, 120);
  };

  document.addEventListener("mouseover", (event) => {
    const anchor = event.target.closest?.("[data-tooltip]");
    if (!anchor || currentAnchor === anchor) return;
    clearTimeout(hideTimer);
    currentAnchor = anchor;
    showHelpTooltip(anchor);
  });
  document.addEventListener("mousemove", (event) => {
    const anchor = event.target.closest?.(".source-status-pill[data-tooltip]");
    if (anchor) showHelpTooltip(anchor);
  });
  document.addEventListener("mouseout", (event) => {
    if (!currentAnchor) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (currentAnchor.contains(next) || els.helpTooltip.contains(next))) return;
    scheduleHide();
  });
  els.helpTooltip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  els.helpTooltip.addEventListener("mouseleave", scheduleHide);
  document.addEventListener("focusin", (event) => {
    const anchor = event.target.closest?.("[data-tooltip]");
    if (!anchor) return;
    clearTimeout(hideTimer);
    currentAnchor = anchor;
    showHelpTooltip(anchor);
  });
  document.addEventListener("focusout", (event) => {
    if (!currentAnchor) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (currentAnchor.contains(next) || els.helpTooltip.contains(next))) return;
    scheduleHide();
  });
  window.addEventListener("resize", hideHelpTooltip);
  document.addEventListener("scroll", (event) => {
    if (event.target && els.helpTooltip.contains(event.target)) return;
    hideHelpTooltip();
  }, true);
}

function showHelpTooltip(anchor) {
  const text = anchor.dataset.tooltip?.trim();
  if (!text) return;
  if ((anchor.dataset.tooltipKind === "machine" || anchor.dataset.tooltipKind === "prompt") && anchor.dataset.tooltipHtml) {
    els.helpTooltip.innerHTML = anchor.dataset.tooltipHtml;
    els.helpTooltip.dataset.kind = anchor.dataset.tooltipKind;
  } else {
    els.helpTooltip.textContent = text;
    delete els.helpTooltip.dataset.kind;
  }
  els.helpTooltip.hidden = false;

  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = els.helpTooltip.getBoundingClientRect();
  const gap = 8;
  const viewportGap = 12;
  if (anchor.dataset.tooltipKind === "machine" || anchor.dataset.tooltipKind === "prompt") {
    const rawLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    const rawTop = anchorRect.bottom + gap;
    const left = clamp(rawLeft, viewportGap, window.innerWidth - tooltipRect.width - viewportGap);
    const top = clamp(rawTop, viewportGap, window.innerHeight - tooltipRect.height - viewportGap);
    els.helpTooltip.style.left = left + "px";
    els.helpTooltip.style.top = top + "px";
    return;
  }

  if (anchor.classList.contains("source-status-pill")) {
    const canPlaceAbove = anchorRect.top - tooltipRect.height - gap >= viewportGap;
    const rawLeft = anchorRect.left;
    const rawTop = canPlaceAbove
      ? anchorRect.top - tooltipRect.height - gap
      : anchorRect.bottom + gap;
    const left = clamp(rawLeft, viewportGap, window.innerWidth - tooltipRect.width - viewportGap);
    const top = clamp(rawTop, viewportGap, window.innerHeight - tooltipRect.height - viewportGap);
    els.helpTooltip.style.left = left + "px";
    els.helpTooltip.style.top = top + "px";
    return;
  }
  const spaceRight = window.innerWidth - anchorRect.right;
  const side = spaceRight >= tooltipRect.width + gap + viewportGap ? "right" : "left";
  const rawLeft = side === "right"
    ? anchorRect.right + gap
    : anchorRect.left - tooltipRect.width - gap;
  const rawTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
  const left = clamp(rawLeft, viewportGap, window.innerWidth - tooltipRect.width - viewportGap);
  const top = clamp(rawTop, viewportGap, window.innerHeight - tooltipRect.height - viewportGap);

  els.helpTooltip.style.left = left + "px";
  els.helpTooltip.style.top = top + "px";
}

function hideHelpTooltip() {
  els.helpTooltip.hidden = true;
  delete els.helpTooltip.dataset.kind;
}
