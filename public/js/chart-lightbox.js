import { els } from "./dom.js";

const CHART_LABELS = [
  { key: "chartDistribution", label: "Completion time distribution" },
  { key: "chartTreatmentEffect", label: "Treatment effect" },
  { key: "chartCompletionRates", label: "Guardrail metrics" }
];

let charts = [];
let currentIndex = 0;

export function initChartLightbox() {
  els.closeChartLightbox.addEventListener("click", closeLightbox);
  els.chartLightboxPrev.addEventListener("click", () => navigate(-1));
  els.chartLightboxNext.addEventListener("click", () => navigate(1));
  els.chartLightbox.addEventListener("click", (e) => {
    if (e.target === els.chartLightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (els.chartLightbox.hasAttribute("open")) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") navigate(-1);
      if (e.key === "ArrowRight") navigate(1);
    }
  });
}

export function wireChartClicks(container) {
  container.querySelectorAll(".ds-chart-card img").forEach((img, i) => {
    img.style.cursor = "pointer";
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      const allCharts = container.querySelectorAll(".ds-chart-card img");
      charts = Array.from(allCharts).map(function (el, idx) {
        const labelEl = el.closest(".ds-chart-card").querySelector(".ds-chart-label");
        return {
          src: el.src,
          label: labelEl ? labelEl.textContent : CHART_LABELS[idx]?.label ?? ""
        };
      });
      openLightbox(i);
    });
  });
}

function openLightbox(index) {
  currentIndex = index;
  showCurrent();
  els.chartLightbox.setAttribute("open", "");
}

function closeLightbox() {
  els.chartLightbox.removeAttribute("open");
}

function navigate(delta) {
  currentIndex = (currentIndex + delta + charts.length) % charts.length;
  showCurrent();
}

function showCurrent() {
  const chart = charts[currentIndex];
  els.chartLightboxImg.src = chart.src;
  els.chartLightboxLabel.textContent = chart.label;
}
