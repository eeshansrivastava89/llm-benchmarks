import { escapeAttribute, escapeHtml } from "./utils.js";

export function icon(name) {
  const basePath = document.body?.dataset.basePath ?? "/";
  const href = basePath.replace(/\/*$/u, "/") + "assets/icons/" + name + ".svg";
  return '<span class="ui-icon" aria-hidden="true" style="--icon: url(' + escapeAttribute(href) + ')"></span>';
}

export function buttonLabel(label, iconName) {
  return (iconName ? icon(iconName) : "") + escapeHtml(label);
}

export function setButtonLabel(button, label, iconName = button?.dataset?.icon) {
  if (!button) return;
  button.innerHTML = buttonLabel(label, iconName);
}
