import { state } from "./state.js";
import { hasCapturedVideo } from "./runs.js";

export function renderViewTabs() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
}

export function updateOnboarding() {
  const panel = document.querySelector("#onboardingPanel");
  if (!panel) return;
  if (state.workspace !== "visual" || state.staticMode) {
    panel.hidden = true;
    return;
  }
  const dismissed = state.onboardingDismissed || (() => {
    try { return localStorage.getItem("onboardingDismissed") === "1"; } catch { return false; }
  })();
  if (dismissed) {
    panel.hidden = true;
    return;
  }
  const completedStep = onboardingCompletedStep();
  if (completedStep >= 5) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const steps = panel.querySelectorAll("[data-onboarding-step]");
  steps.forEach((step) => {
    const num = Number(step.dataset.onboardingStep);
    const done = num <= completedStep;
    step.dataset.onboardingStepCompleted = String(done);
  });
}

function onboardingCompletedStep() {
  let step = 0;
  if (state.runs.length > 0) step = 1;
  if (state.runs.some((r) => r.status === "prepared")) step = 2;
  if (state.runs.some((r) => r.assets?.html)) step = 3;
  return step;
}

export function showHtmlDetectToast(count) {
  if (document.querySelector(".html-detect-toast")) return;
  const toast = document.createElement("div");
  toast.className = "html-detect-toast";
  toast.innerHTML =
    '<span>' + String(count) + " run" + (count === 1 ? "" : "s") + " " + (count === 1 ? "has" : "have") + " index.html ready.</span>" +
    '<button type="button" id="toastCaptureBtn">Capture now</button>' +
    '<button type="button" id="toastDismissBtn" class="btn-sm-ghost">Dismiss</button>';
  document.body.appendChild(toast);
  toast.querySelector("#toastCaptureBtn").addEventListener("click", () => {
    toast.remove();
    document.dispatchEvent(new CustomEvent("capture-pending"));
  });
  toast.querySelector("#toastDismissBtn").addEventListener("click", () => toast.remove());
  setTimeout(() => toast.remove(), 15000);
}
