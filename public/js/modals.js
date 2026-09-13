import { els } from "./dom.js";

export function openModal(name) {
  const map = {
    detail: els.detailBackdrop,
    prep: els.prepBackdrop,
    setup: els.setupBackdrop,
    deleteConfirm: els.deleteConfirmBackdrop
  };
  const el = map[name];
  if (el) {
    // store focus before opening
    const key = "modalFocusReturn_" + name;
    if (!window[key]) window[key] = document.activeElement;
    el.setAttribute("open", "");
    syncBodyOverflow();
    queueMicrotask(() => focusFirstModalControl(el));
  }
}

export function closeModal(name) {
  const map = {
    detail: els.detailBackdrop,
    prep: els.prepBackdrop,
    setup: els.setupBackdrop,
    deleteConfirm: els.deleteConfirmBackdrop
  };
  const el = map[name];
  if (el) {
    el.removeAttribute("open");
    syncBodyOverflow();
    restoreModalFocus(name);
  }
}

export function currentModal() {
  const entries = [
    ["deleteConfirm", els.deleteConfirmBackdrop],
    ["detail", els.detailBackdrop],
    ["prep", els.prepBackdrop],
    ["setup", els.setupBackdrop]
  ];
  const entry = entries.find(([, element]) => element?.hasAttribute("open"));
  return entry ? { name: entry[0], element: entry[1] } : null;
}

export function handleModalKeydown(event) {
  const modal = currentModal();
  if (!modal) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeModal(modal.name);
    return;
  }

  if (event.key === "Tab") {
    trapModalFocus(event, modal.element);
  }
}

function syncBodyOverflow() {
  document.body.style.overflow = currentModal() ? "hidden" : "";
}

function focusFirstModalControl(modal) {
  const focusable = modalFocusableElements(modal);
  (focusable[0] ?? modal).focus();
}

function restoreModalFocus(name) {
  const key = "modalFocusReturn_" + name;
  const target = window[key];
  delete window[key];
  if (target && typeof target.focus === "function" && !currentModal()) {
    target.focus();
  }
}

function trapModalFocus(event, modal) {
  const focusable = modalFocusableElements(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function modalFocusableElements(modal) {
  return Array.from(
    modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden && element.offsetParent !== null);
}
