import { spawn } from "node:child_process";
import { platform } from "node:os";

import {
  CancellableLoader,
  Input,
  HStack,
  Key,
  ProcessTerminal,
  ScrollView,
  SelectList,
  Text,
  TuiAltScreen,
  VStack,
  fuzzyFilter,
  matchesKey,
} from "@earendil-works/pi-tui";

import {
  ResponsiveHelp,
  WorkflowHeader,
  benchmarkCategories,
  benchmarkDetails,
  benchmarkListItem,
  cleanLines,
  formatCount,
  listTheme,
  selectorDetails,
  sourceTabs,
  style,
  taskWarning,
} from "./presentation.mjs";

export const BACK = Symbol("back");
export const CANCEL = Symbol("cancel");

function openExternalUrl(url) {
  const command = platform() === "darwin"
    ? ["open", [url]]
    : platform() === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

class SelectorScreen extends VStack {
  constructor(ui, items, options, done) {
    super();
    this.ui = ui;
    this.items = items;
    this.options = options;
    this.done = done;
    this.query = "";
    this.searching = false;
    this.selectedIndex = Math.max(0, items.findIndex((item) => options.isInitial?.(item)));
    this.input = new Input({
      prompt: style.accent("Search  "),
      placeholder: options.searchPlaceholder ?? "type to filter",
      placeholderStyle: style.muted,
    });
    this.detailWideText = new Text("", 1, 0);
    this.detailNarrowText = new Text("", 1, 0);
    this.detailWide = new ScrollView(this.detailWideText, {
      scrollbar: "auto",
      overscroll: "contain",
    });
    this.detailNarrow = new ScrollView(this.detailNarrowText, {
      scrollbar: "auto",
      overscroll: "contain",
    });
    this._focused = false;
    this.rebuild();
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.input.focused = value && this.searching;
  }

  itemLabel(item) {
    return this.options.label?.(item) ?? item.label ?? String(item);
  }

  visibleItems() {
    const indexed = this.items.map((item, index) => ({ item, index }));
    if (!this.query) return indexed;
    return fuzzyFilter(indexed, this.query, ({ item }) => (
      this.options.searchText?.(item)
      ?? [this.itemLabel(item), this.options.summary?.(item), ...selectorDetails(item, this.options)]
        .filter(Boolean)
        .join(" ")
    ));
  }

  updateDetails(item) {
    const value = (item === undefined
      ? [style.muted("No choices match the current search.")]
      : selectorDetails(item, this.options)).join("\n");
    this.detailWideText.setText(value);
    this.detailNarrowText.setText(value);
    this.detailWide.scrollToStart();
    this.detailNarrow.scrollToStart();
    this.ui.requestRender();
  }

  rebuild() {
    const visible = this.visibleItems();
    this.list = new SelectList(
      visible.map(({ item, index }) => ({
        value: String(index),
        label: this.itemLabel(item),
        description: this.options.summary?.(item),
      })),
      Math.max(6, Math.min(18, this.ui.rows - 10)),
      listTheme(),
      { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 48 },
    );
    const visibleIndex = Math.max(0, visible.findIndex(({ index }) => index === this.selectedIndex));
    this.list.setSelectedIndex(visibleIndex);
    this.list.onSelectionChange = ({ value }) => {
      this.selectedIndex = Number(value);
      this.updateDetails(this.items[this.selectedIndex]);
    };
    this.list.onSelect = ({ value }) => this.done(this.items[Number(value)]);
    this.list.onCancel = () => this.done(this.options.allowBack ? BACK : CANCEL);
    this.updateDetails(visible[visibleIndex]?.item);

    this.clear();
    this.addChild(new WorkflowHeader(this.options.step));
    if (this.options.context) this.addChild(new Text(style.muted(this.options.context), 1, 0));
    const title = style.strong(this.options.title);
    this.addChild(new Text(`\n${this.options.tone === "error" ? style.error(title) : this.options.tone === "warning" ? style.warning(title) : title}`, 1, 0));
    if (this.options.message) {
      const message = this.options.tone === "error"
        ? style.error(this.options.message)
        : this.options.tone === "warning" ? style.warning(this.options.message) : style.muted(this.options.message);
      this.addChild(new Text(message, 1, 0));
    }
    if (this.options.searchable) {
      this.addChild(this.searching
        ? this.input
        : new Text(style.muted("Search  press /"), 1, 0));
    }

    const listPane = new VStack([
      new Text(style.muted(this.options.listTitle ?? "Choices"), 1, 0),
      this.list,
    ]);
    const detailPane = new VStack([
      new Text(style.muted(this.options.detailTitle ?? "Details"), 1, 0),
      this.detailWide,
    ]);
    if (this.options.compact) {
      this.addChild(listPane, {
        basis: Math.min(14, Math.max(4, visible.length + 1)),
        minSize: 4,
      });
      if (this.options.details) {
        this.addChild(this.detailNarrow, { basis: "auto", maxSize: 8 });
      }
      this.addChild(new Text("", 0, 0), { basis: 0, grow: 1 });
    } else {
      this.addChild(new HStack([
        { component: listPane, basis: 48, grow: 1, minSize: 28 },
        { component: detailPane, basis: 0, grow: 1, minSize: 36, visible: ({ width }) => width >= 96 },
      ], { gap: 2 }), { basis: 0, grow: 1, minSize: 6 });
      this.addChild(this.detailNarrow, {
        basis: "auto",
        maxSize: 8,
        visible: ({ width }) => width < 96,
      });
    }
    if (this.searching) {
      this.addChild(new ResponsiveHelp(
        "type to filter  ·  enter return to list  ·  esc clear search  ·  ctrl-c quit",
        "type to filter  ·  enter list  ·  esc clear",
      ));
    } else {
      const searchHelp = this.options.searchable ? "  ·  / search" : "";
      const detailHelp = this.options.details ? "  ·  pgup/dn details" : "";
      const shortDetailHelp = this.options.details ? "  ·  pgdn info" : "";
      this.addChild(new ResponsiveHelp(
        `${this.options.allowBack ? "esc back  ·  " : ""}↑↓ navigate  ·  enter select${searchHelp}${detailHelp}  ·  ? help  ·  ctrl-c quit`,
        `${this.options.allowBack ? "esc back  ·  " : ""}↑↓ move  ·  enter${searchHelp}${shortDetailHelp}  ·  ctrl-c quit`,
      ));
    }
    this.input.focused = this.focused && this.searching;
  }

  handleInput(data) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.done(CANCEL);
      return;
    }
    if (data === "?") {
      this.ui.flash("Use ↑↓ to move, Enter to choose, / to search, Esc to go back, and PgUp/PgDn to scroll details.", 6_000);
      return;
    }
    if (this.searching) {
      if (matchesKey(data, Key.escape)) {
        if (this.query) {
          this.query = "";
          this.input.setValue("");
        } else {
          this.searching = false;
        }
        this.rebuild();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.searching = false;
        this.rebuild();
        return;
      }
      this.input.handleInput(data);
      this.query = this.input.getValue();
      this.rebuild();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done(this.options.allowBack ? BACK : CANCEL);
      return;
    }
    if (this.options.searchable && data === "/") {
      this.searching = true;
      this.input.focused = this.focused;
      this.rebuild();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.detailWide.scrollBy(-6);
      this.detailNarrow.scrollBy(-6);
      this.ui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.detailWide.scrollBy(6);
      this.detailNarrow.scrollBy(6);
      this.ui.requestRender();
      return;
    }
    this.list.handleInput(data);
    this.ui.requestRender();
  }
}

class InputScreen extends VStack {
  constructor(ui, options, done) {
    super();
    this.ui = ui;
    this.options = options;
    this.done = done;
    this.input = new Input({
      prompt: style.accent("› "),
      placeholder: options.placeholder ?? "",
      placeholderStyle: style.muted,
    });
    if (options.initialValue) this.input.setValue(options.initialValue);
    this.feedback = new Text("", 1, 0);
    this._focused = false;
    this.input.onSubmit = (value) => this.submit(value);
    this.rebuild();
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.input.focused = value;
  }

  submit(value) {
    const error = this.options.validate?.(value);
    if (error) {
      this.feedback.setText(style.warning(error));
      this.ui.requestRender();
      return;
    }
    this.done(value);
  }

  rebuild() {
    this.clear();
    this.addChild(new WorkflowHeader(this.options.step));
    if (this.options.context) this.addChild(new Text(style.muted(this.options.context), 1, 0));
    const title = style.strong(this.options.title);
    this.addChild(new Text(`\n${this.options.tone === "error" ? style.error(title) : this.options.tone === "warning" ? style.warning(title) : title}`, 1, 0));
    if (this.options.message) {
      const message = this.options.tone === "error"
        ? style.error(this.options.message)
        : this.options.tone === "warning" ? style.warning(this.options.message) : style.muted(this.options.message);
      this.addChild(new Text(message, 1, 0));
    }
    this.addChild(new Text("", 0, 1));
    this.addChild(this.input);
    this.addChild(this.feedback);
    this.addChild(new Text("", 0, 1));
    this.addChild(new ResponsiveHelp(
      `${this.options.allowBack ? "esc back  ·  " : ""}enter continue  ·  ? help  ·  ctrl-c quit`,
      `${this.options.allowBack ? "esc back  ·  " : ""}enter continue  ·  ctrl-c quit`,
    ));
  }

  handleInput(data) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.done(CANCEL);
      return;
    }
    if (data === "?") {
      this.ui.flash("Enter a positive whole number, press Enter to continue, or Esc to go back.", 6_000);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done(this.options.allowBack ? BACK : CANCEL);
      return;
    }
    this.input.handleInput(data);
    this.ui.requestRender();
  }
}

class BenchmarkBrowserScreen extends VStack {
  constructor(ui, sources, options, done) {
    super();
    this.ui = ui;
    this.sources = sources;
    this.options = options;
    this.done = done;
    this.sourceIndex = Math.max(0, sources.findIndex((source) => source.source === options.initialSource));
    this.selectedSpec = options.initialTaskSpec ?? null;
    const initialTask = this.source.benchmarks.find((task) => task.spec === this.selectedSpec);
    this.activeCategory = initialTask?.group ?? "All";
    this.activePane = this.hasCategories() ? "categories" : "tasks";
    this.query = "";
    this.input = new Input({
      prompt: style.accent("Search  "),
      placeholder: "press / and type a benchmark name",
      placeholderStyle: style.muted,
    });
    this.detailWideText = new Text("", 1, 0);
    this.detailNarrowText = new Text("", 1, 0);
    this.detailWide = new ScrollView(this.detailWideText, { scrollbar: "auto", overscroll: "contain" });
    this.detailNarrow = new ScrollView(this.detailNarrowText, { scrollbar: "auto", overscroll: "contain" });
    this._focused = false;
    this.rebuild();
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.input.focused = value && this.activePane === "search";
  }

  get source() {
    return this.sources[this.sourceIndex];
  }

  categories() {
    return benchmarkCategories(this.source.benchmarks);
  }

  hasCategories() {
    return this.categories().length > 2;
  }

  visibleTasks() {
    const grouped = this.activeCategory === "All"
      ? this.source.benchmarks
      : this.source.benchmarks.filter((task) => (task.group || "Other") === this.activeCategory);
    if (!this.query) return grouped;
    return fuzzyFilter(this.source.benchmarks, this.query, (task) => [
      task.displayName,
      task.title,
      task.group,
      task.description,
    ].filter(Boolean).join(" "));
  }

  setDetails(task) {
    this.selectedSpec = task?.spec ?? null;
    const value = benchmarkDetails(task).join("\n");
    this.detailWideText.setText(value);
    this.detailNarrowText.setText(value);
    this.detailWide.scrollToStart();
    this.detailNarrow.scrollToStart();
    this.ui.requestRender();
  }

  switchSource(index) {
    const normalized = (index + this.sources.length) % this.sources.length;
    if (normalized === this.sourceIndex) return;
    this.sourceIndex = normalized;
    this.activeCategory = "All";
    this.query = "";
    this.input.setValue("");
    this.selectedSpec = null;
    this.activePane = this.hasCategories() ? "categories" : "tasks";
    this.rebuild();
  }

  selectCategory(category) {
    this.activeCategory = category;
    this.selectedSpec = null;
    this.activePane = "tasks";
    this.rebuild();
  }

  cyclePane(direction) {
    const panes = this.hasCategories()
      ? ["categories", "tasks", "search"]
      : ["tasks", "search"];
    const current = Math.max(0, panes.indexOf(this.activePane));
    this.activePane = panes[(current + direction + panes.length) % panes.length];
    this.input.focused = this.focused && this.activePane === "search";
    this.rebuild();
  }

  rebuild() {
    const categories = this.categories();
    if (!categories.some(({ name }) => name === this.activeCategory)) this.activeCategory = "All";
    this.categoryList = new SelectList(
      categories.map(({ name, count }) => ({ value: name, label: `${name} (${count})` })),
      12,
      listTheme(() => this.activePane === "categories"),
      { minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 20 },
    );
    this.categoryList.setSelectedIndex(Math.max(0, categories.findIndex(({ name }) => name === this.activeCategory)));
    this.categoryList.onSelectionChange = ({ value }) => {
      this.activeCategory = value;
      this.selectedSpec = null;
      this.rebuild();
    };
    this.categoryList.onSelect = ({ value }) => this.selectCategory(value);

    const tasks = this.visibleTasks();
    const taskBySpec = new Map(tasks.map((task) => [task.spec, task]));
    this.taskList = new SelectList(
      tasks.map(benchmarkListItem),
      Math.max(6, Math.min(22, this.ui.rows - 10)),
      listTheme(() => this.activePane === "tasks"),
      { minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 42 },
    );
    const selectedIndex = Math.max(0, tasks.findIndex((task) => task.spec === this.selectedSpec));
    this.taskList.setSelectedIndex(selectedIndex);
    this.taskList.onSelectionChange = ({ value }) => this.setDetails(taskBySpec.get(value));
    this.taskList.onSelect = ({ value }) => this.done({
      task: taskBySpec.get(value),
      source: this.source.source,
    });
    this.setDetails(tasks[selectedIndex]);

    this.clear();
    this.addChild(new WorkflowHeader(this.options.step ?? "3 Benchmark"));
    if (this.options.context) this.addChild(new Text(style.muted(this.options.context), 1, 0));
    this.addChild(new Text(`\n${sourceTabs(this.sources, this.sourceIndex)}`, 1, 0));
    const sourceDescription = this.source.detail
      ?? `${this.source.benchmarks.length} available task${this.source.benchmarks.length === 1 ? "" : "s"}`;
    this.addChild(new Text(style.muted(sourceDescription), 1, 0));
    this.addChild(new Text(
      style.muted(this.query
        ? `Searching all categories  ·  ${tasks.length} match${tasks.length === 1 ? "" : "es"}`
        : this.hasCategories()
          ? `Category: ${this.activeCategory}  ·  ${tasks.length} shown`
          : `${tasks.length} shown`),
      1,
      0,
    ));
    this.addChild(this.activePane === "search"
      ? this.input
      : new Text(style.muted("Search  press /"), 1, 0));

    const hasCategories = this.hasCategories();
    const categoryPane = new VStack([
      new Text(this.activePane === "categories"
        ? style.accent(style.strong("▸ Categories"))
        : style.muted("  Categories"), 1, 0),
      this.categoryList,
    ]);
    const taskPane = new VStack([
      new Text(this.activePane === "tasks"
        ? style.accent(style.strong("▸ Benchmarks"))
        : style.muted("  Benchmarks"), 1, 0),
      this.taskList,
    ]);
    const detailPane = new VStack([
      new Text(style.muted("DETAILS  ·  pgup/dn to scroll"), 1, 0),
      this.detailWide,
    ]);
    this.addChild(new HStack([
      { component: categoryPane, basis: 24, minSize: 20, visible: () => hasCategories },
      { component: taskPane, basis: 44, grow: 1, minSize: 30 },
      { component: detailPane, basis: 0, grow: 1, minSize: 46 },
    ], { gap: 2 }), {
      basis: 0,
      grow: 1,
      minSize: 8,
      visible: ({ width }) => width >= 122,
    });
    this.addChild(new HStack([
      { component: categoryPane, basis: 24, minSize: 20, visible: () => hasCategories },
      { component: taskPane, basis: 0, grow: 1, minSize: 30 },
    ], { gap: 2 }), {
      basis: 12,
      minSize: 8,
      visible: ({ width }) => width >= 88 && width < 122,
    });
    this.addChild(new HStack([
      { component: categoryPane, basis: 0, grow: 1, minSize: 28, visible: () => hasCategories && this.activePane === "categories" },
      { component: taskPane, basis: 0, grow: 1, minSize: 28, visible: () => !hasCategories || this.activePane !== "categories" },
    ]), {
      basis: 12,
      minSize: 8,
      visible: ({ width }) => width < 88,
    });
    this.addChild(this.detailNarrow, {
      basis: "auto",
      maxSize: 9,
      visible: ({ width }) => width < 122 && (width >= 88 || this.activePane !== "categories"),
    });
    this.addChild(new Text("", 0, 0), {
      basis: 0,
      grow: 1,
      visible: ({ width }) => width < 122,
    });
    const sourceShortcut = `1–${Math.min(9, this.sources.length)} source`;
    this.addChild(new ResponsiveHelp(
      `${sourceShortcut}  ·  tab switch pane  ·  / search  ·  enter select  ·  pgup/dn details  ·  ? help  ·  esc back  ·  ctrl-c quit`,
      `${sourceShortcut}  ·  tab pane  ·  / search  ·  enter  ·  pgdn info  ·  esc back`,
    ));
    this.input.focused = this.focused && this.activePane === "search";
    this.ui.requestRender();
  }

  handleInput(data) {
    if (matchesKey(data, Key.ctrl("c"))) {
      this.done(CANCEL);
      return;
    }
    if (data === "?") {
      this.ui.flash("Use 1–3 for sources, Tab for panes, / to search all categories, Enter to choose, and PgUp/PgDn for details.", 6_000);
      return;
    }
    if (this.activePane === "search") {
      if (matchesKey(data, Key.escape)) {
        if (this.query) {
          this.query = "";
          this.input.setValue("");
        } else {
          this.activePane = "tasks";
        }
        this.rebuild();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.activePane = "tasks";
        this.rebuild();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        this.cyclePane(1);
        return;
      }
      if (matchesKey(data, Key.shift("tab"))) {
        this.cyclePane(-1);
        return;
      }
      this.input.handleInput(data);
      this.query = this.input.getValue();
      this.selectedSpec = null;
      this.rebuild();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.done(BACK);
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.cyclePane(1);
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.cyclePane(-1);
      return;
    }
    if (data === "/") {
      this.activePane = "search";
      this.input.focused = this.focused;
      this.rebuild();
      return;
    }
    if (/^[1-9]$/.test(data)) {
      const index = Number(data) - 1;
      if (this.sources[index]) this.switchSource(index);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.detailWide.scrollBy(-6);
      this.detailNarrow.scrollBy(-6);
      this.ui.requestRender();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.detailWide.scrollBy(6);
      this.detailNarrow.scrollBy(6);
      this.ui.requestRender();
      return;
    }
    if (this.activePane === "categories") this.categoryList.handleInput(data);
    else this.taskList.handleInput(data);
    this.ui.requestRender();
  }
}

export class BenchUI {
  constructor(options = {}) {
    this.terminal = options.terminal ?? new ProcessTerminal();
    this.tui = new TuiAltScreen(this.terminal, true, undefined, {
      mouse: true,
      openUrl: options.openUrl ?? openExternalUrl,
    });
    this.started = false;
    this.loader = null;
    this.cancelLoading = options.cancelLoading ?? (() => {
      this.stop();
      process.exit(130);
    });
    this.interactionCount = 0;
  }

  get rows() {
    return this.terminal.rows;
  }

  get columns() {
    return this.terminal.columns;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.tui.setClearOnShrink(true);
    this.tui.start();
  }

  stop(options = {}) {
    if (!this.started) return;
    this.stopLoader();
    this.tui.stop({ preserveScreen: options.preserveScreen ?? true });
    this.started = false;
  }

  requestRender(force = false) {
    this.tui.requestRender(force);
  }

  flash(message, durationMs = 4_000) {
    this.tui.flash(message, durationMs);
  }

  stopLoader() {
    this.loader?.stop();
    this.loader?.dispose?.();
    this.loader = null;
  }

  setScreen(screen) {
    this.stopLoader();
    this.tui.setLayoutRoot(screen);
    this.tui.setFocus(screen);
    this.tui.requestRender(true);
  }

  showLoading(message, context = "") {
    const loader = new CancellableLoader(this.tui, style.accent, style.muted, message);
    loader.onAbort = this.cancelLoading;
    const root = new VStack([
      new Text(`${style.accent(style.strong("Bench"))}  ${style.muted("Working")}`, 1, 0),
      ...(context ? [new Text(style.muted(context), 1, 0)] : []),
      new Text("", 0, 1),
      loader,
      new Text("", 0, 1),
      new Text(style.muted("esc cancel"), 1, 0),
    ]);
    this.tui.setLayoutRoot(root);
    this.tui.setFocus(loader);
    this.loader = loader;
    loader.start();
    this.tui.requestRender(true);
  }

  select(items, options) {
    this.interactionCount += 1;
    return new Promise((resolve) => {
      const done = (result) => {
        if (result === CANCEL) resolve(CANCEL);
        else resolve(result);
      };
      this.setScreen(new SelectorScreen(this, items, options, done));
    });
  }

  input(options) {
    this.interactionCount += 1;
    return new Promise((resolve) => {
      this.setScreen(new InputScreen(this, options, resolve));
    });
  }

  browseBenchmarks(sources, options = {}) {
    this.interactionCount += 1;
    return new Promise((resolve) => {
      this.setScreen(new BenchmarkBrowserScreen(this, sources, options, resolve));
    });
  }
}

export const benchUiStyle = style;
export {
  benchmarkCategories,
  benchmarkDetails,
  benchmarkListItem,
  formatCount,
  taskWarning,
};
