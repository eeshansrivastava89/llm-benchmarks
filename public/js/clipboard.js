import { setButtonLabel } from "./icons.js";

export async function copyTextToClipboard(text, button, label) {
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
  if (!button) {
    return;
  }

  setButtonLabel(button, "Copied", "check-circle");
  window.setTimeout(() => {
    setButtonLabel(button, label);
  }, 1200);
}
