export function applyStoredTheme() {
  const theme = localStorage.getItem("theme") === "dark" ? "dark" : "light";
  setTheme(theme);
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  setTheme(next);
}

export function setTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.toggleAttribute("data-theme", isDark);
  if (isDark) {
    document.documentElement.dataset.theme = "dark";
  }
  const themeToggle = document.querySelector("#themeToggle");
  const themeIcon = document.querySelector("#themeIcon");
  const themeLabel = document.querySelector("#themeLabel");
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", isDark ? "Use light theme" : "Use dark theme");
    themeToggle.title = isDark ? "Use light theme" : "Use dark theme";
  }
  if (themeIcon) themeIcon.textContent = isDark ? "☼" : "☾";
  if (themeLabel) themeLabel.textContent = isDark ? "Light" : "Dark";
}
