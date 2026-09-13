import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { RingGauge } from "./ring_gauge.js";
import { Sparkline } from "./sparkline.js";
import { WidgetRegistry } from "./widgets/widget-registry.js";
import { MetricCard } from "./widgets/metric-card.js";
import { createCpuWidget } from "./widgets/cpu-widget.js";
import { createMemoryWidget } from "./widgets/memory-widget.js";
import { createGpuWidget } from "./widgets/gpu-widget.js";
import { createFanWidget } from "./widgets/fan-widget.js";
import { createNetworkWidget } from "./widgets/network-widget.js";
import { createDiskWidget } from "./widgets/disk-widget.js";
import { createHistoryWidget } from "./widgets/history-widget.js";
import { createProcessesWidget } from "./widgets/processes-widget.js";

const SCHEMA_ID = "org.gnome.shell.extensions.sparkline-monitor";
const SERVICE_SOCKET = "codenotch-monitor.service.sock";
const CHILD_SOCKET = "codenotch-monitor.child.sock";

// Dynamic-Island morph timings. Open overshoots with EASE_OUT_BACK and lets
// the inner content cross-fade in only after the shape is mostly expanded.
const MORPH_OPEN_MS = 420;
const MORPH_CLOSE_MS = 260;
const MORPH_FADE_START = 0.42;
const CAPSULE_RADIUS = 15;
const CARD_RADIUS = 24;

export default class SparklineMonitorExtension extends Extension {
  enable() {
    this._cancellable = new Gio.Cancellable();
    this._proc = null;
    this._stream = null;
    this._conn = null;
    this._writeStream = null;
    this._ownsDaemon = false;
    this._daemonPaused = false;
    this._restartTimer = 0;
    this._restartBackoff = 2000;
    this._disabling = false;
    this._intentionalExit = false;
    this._manualPaused = false;
    this._pauseWanted = false;

    this._coreBars = [];
    this._menuOpen = false;
    this._latestData = null;
    this._telemetryCounter = 0;

    // Dynamic-Island morph state
    this._morphTimers = [];
    this._morphActive = false;
    this._morphRadius = null;

    this._loadSettings();
    this._setupWidgetRegistry();

    // 1. Create Panel Indicator Button
    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

    // 2. Codenotch Notch Capsule (horizontal layout)
    this._buildPanelCapsule();

    // 3. Build Liquid Glass Popover Card
    this._buildGlassCard();

    // 4. Add to GNOME Shell status area
    Main.panel.addToStatusArea(this.uuid, this._indicator);
    Main.panel.add_style_class_name("codenotch-vertical-panel");

    // 5. Apply settings
    this._applyUiSettings();
    this._applyPalette();

    // 6. Pause telemetry while locked
    this._updatePauseState();
    this._lockWatchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      this._updatePauseState();
      return GLib.SOURCE_CONTINUE;
    });

    // 7. Re-detect sensors after suspend/wake
    this._setupSleepListener();

    // 8. Connect to daemon
    this._startDaemon();
  }

  // ----------------------------- Widget Registry -----------------------------

  _setupWidgetRegistry() {
    this._registry = new WidgetRegistry(this._settings);
    this._registry.register(createCpuWidget());
    this._registry.register(createMemoryWidget());
    this._registry.register(createGpuWidget());
    this._registry.register(createFanWidget());
    this._registry.register(createNetworkWidget());
    this._registry.register(createDiskWidget());
    this._registry.register(createHistoryWidget());
    this._registry.register(createProcessesWidget());
    this._registry.loadOrder();
  }

  // ----------------------------- Panel Capsule -----------------------------

  _buildPanelCapsule() {
    const notchBox = new St.BoxLayout({
      style_class: "codenotch-notch-box",
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
      reactive: true,
    });

    // --- CPU Cell ---
    this._cpuCell = this._addPanelCell("cpu");
    notchBox.add_child(this._cpuCell.actor);

    // --- RAM Cell ---
    this._ramCell = this._addPanelCell("ram");
    notchBox.add_child(this._ramCell.actor);

    // --- Fan Cell ---
    this._fanCell = this._addPanelCell("fan");
    notchBox.add_child(this._fanCell.actor);

    // --- Compact status dot ---
    this._compactDot = new St.Widget({
      style_class: "codenotch-dot codenotch-fill-ample",
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.CENTER,
    });
    notchBox.add_child(this._compactDot);

    this._notchBox = notchBox;
    this._indicator.add_child(notchBox);
  }

  _addPanelCell(type) {
    const wrap = new St.BoxLayout({
      style_class: "codenotch-metric-cell",
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });

    let gauge, label, sub;
    const size = 24;
    const sw = 2.4;

    if (type === "cpu") {
      gauge = new RingGauge({ type: "cpu", size, strokeWidth: sw });
      this._cpuGauge = gauge;
    } else if (type === "ram") {
      gauge = new RingGauge({ type: "ram", size, strokeWidth: sw });
      this._ramGauge = gauge;
    } else if (type === "fan") {
      gauge = new RingGauge({ type: "fan", size, strokeWidth: sw });
      this._fanGauge = gauge;
    }

    label = new St.Label({
      text: "0%",
      style_class: "codenotch-value-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    sub = new St.Label({
      text: "",
      style_class: "codenotch-value-sublabel",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const labelsBox = new St.BoxLayout({
      vertical: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: "codenotch-metric-labels",
    });
    labelsBox.add_child(label);
    labelsBox.add_child(sub);

    wrap.add_child(gauge);
    wrap.add_child(labelsBox);

    return { actor: wrap, gauge, label, sub };
  }

  // ----------------------------- Settings -----------------------------

  _loadSettings() {
    if (this._settings) return;
    const schemaDir = GLib.build_filenamev([this.path, "schemas"]);
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
      schemaDir,
      Gio.SettingsSchemaSource.get_default(),
      false,
    );
    const schema = schemaSource.lookup(SCHEMA_ID, true);
    if (schema) {
      this._settings = new Gio.Settings({ settings_schema: schema });
      this._settingsChangedId = this._settings.connect(
        "changed",
        this._onSettingsChanged.bind(this),
      );
    } else {
      console.warn(
        `[${this.metadata.name}] Could not load ${SCHEMA_ID}, using defaults.`,
      );
      this._settings = null;
    }
  }

  _getBool(key, fallback) {
    return this._settings ? this._settings.get_boolean(key) : fallback;
  }

  _getInt(key, fallback) {
    return this._settings ? this._settings.get_int(key) : fallback;
  }

  _getDouble(key, fallback) {
    return this._settings ? this._settings.get_double(key) : fallback;
  }

  _getString(key, fallback) {
    return this._settings ? this._settings.get_string(key) || fallback : fallback;
  }

  _setBool(key, value) {
    if (this._settings) this._settings.set_boolean(key, value);
  }

  _onSettingsChanged(_settings, key) {
    if (key === "poll-interval") {
      this._sendCommand(
        `INTERVAL ${Math.max(200, this._getInt("poll-interval", 1200))}`,
      );
      return;
    }
    if (key === "pause-away") {
      this._updatePauseState();
    }
    if (key === "mono-palette") {
      this._applyPalette();
    }
    if (key === "widget-order") {
      this._registry.loadOrder();
      this._rebuildPopoverCards();
    }
    this._applyUiSettings();
  }

  _applyPalette() {
    const mono = this._getBool("mono-palette", false);
    const palette = mono ? "mono" : "codenotch";
    for (const gauge of [this._cpuGauge, this._ramGauge, this._fanGauge]) {
      if (gauge) gauge.setPalette(palette);
    }
  }

  _applyUiSettings() {
    const compact = this._getBool("compact-mode", false);
    const showCpu = this._getBool("show-cpu", true);
    const showRam = this._getBool("show-ram", true);
    const showFan = this._getBool("show-fan", true);

    // Panel capsule visibility
    if (this._cpuCell) this._cpuCell.actor.visible = !compact && showCpu;
    if (this._ramCell) this._ramCell.actor.visible = !compact && showRam;
    if (this._fanCell) this._fanCell.actor.visible = !compact && showFan;
    if (this._compactDot) this._compactDot.visible = compact;

    // Popover card visibility
    for (const w of this._registry.all()) {
      const enabled = this._registry.isEnabled(w.id);
      w.card.setVisible(enabled);
    }

    // Update glass background transparency (baked into CSS, not actor opacity)
    this._setGlassStyle();

    if (this._compactSwitch) {
      this._compactSwitch.setToggleState(compact);
    }
  }

  // ----------------------------- Liquid Glass Popover -----------------------------

  _buildGlassCard() {
    const menu = this._indicator.menu;
    menu.box.add_style_class_name("codenotch-card-menu");
    menu.actor.add_style_class_name("codenotch-menu-boxpointer");
    menu.connect("open-state-changed", this._onMenuStateChanged.bind(this));

    this._glassMenuBox = menu.box;

    this._menuItems = {};

    // --- Header ---
    const headerItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    headerItem.actor.add_style_class_name("codenotch-structural-item");
    const headerBox = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-glass-header",
    });
    const titleLabel = new St.Label({
      text: "System Monitor",
      style_class: "codenotch-card-header",
    });
    const subLabel = new St.Label({
      text: "Live Hardware Telemetry",
      style_class: "codenotch-card-subtitle",
    });
    headerBox.add_child(titleLabel);
    headerBox.add_child(subLabel);
    headerItem.add_child(headerBox);
    menu.addMenuItem(headerItem);

    // --- Widget grid container ---
    this._widgetGrid = new St.BoxLayout({
      style_class: "codenotch-glass-grid",
      x_expand: true,
    });
    this._widgetGridWrap = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    this._widgetGridWrap.actor.add_style_class_name("codenotch-structural-item");
    this._widgetGridWrap.add_child(this._widgetGrid);
    menu.addMenuItem(this._widgetGridWrap);

    // --- CPU Cores grid (optional, below the grid) ---
    const coresItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    coresItem.actor.add_style_class_name("codenotch-structural-item");
    const coresWrap = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section codenotch-cores-section",
      x_expand: true,
    });
    const coresTitle = new St.Label({
      text: "CPU Cores",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._coresContainer = new St.BoxLayout({ vertical: true, x_expand: true });
    this._coreBars = [];
    coresWrap.add_child(coresTitle);
    coresWrap.add_child(this._coresContainer);
    coresItem.add_child(coresWrap);
    menu.addMenuItem(coresItem);
    this._menuItems.cores = coresItem;

    // Populate widget cards into the grid
    this._populateWidgetGrid();

    // --- Controls ---
    this._pauseSwitch = new PopupMenu.PopupSwitchMenuItem(
      "Pause telemetry",
      this._manualPaused,
    );
    this._pauseSwitch.actor.add_style_class_name("codenotch-controls-start");
    this._pauseSwitch.actor.add_style_class_name("codenotch-glass-control");
    this._pauseSwitch.connect("toggled", (_item, state) => {
      this._manualPaused = state;
      this._updatePauseState();
    });
    menu.addMenuItem(this._pauseSwitch);

    this._compactSwitch = new PopupMenu.PopupSwitchMenuItem(
      "Compact mode (status dot)",
      this._getBool("compact-mode", false),
    );
    this._compactSwitch.actor.add_style_class_name("codenotch-glass-control");
    this._compactSwitch.connect("toggled", (_item, state) => {
      this._setBool("compact-mode", state);
    });
    menu.addMenuItem(this._compactSwitch);

    const reinitItem = new PopupMenu.PopupMenuItem("Reinitialize sensors");
    reinitItem.connect("activate", () => {
      this._sendCommand("RESET");
    });
    menu.addMenuItem(reinitItem);

    const settingsItem = new PopupMenu.PopupMenuItem("Settings\u2026");
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    menu.addMenuItem(settingsItem);
  }

  _populateWidgetGrid() {
    // Clear existing children
    this._widgetGrid.destroy_all_children();

    const enabled = this._registry.enabled();
    const isCompact = this._getBool("compact-mode", false);

    // Build a 2-column horizontal grid layout
    const leftCol = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-glass-column",
      x_expand: true,
    });
    const rightCol = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-glass-column",
      x_expand: true,
    });

    // CPU cores section is part of left column
    if (this._menuItems.cores) {
      this._menuItems.cores.visible = this._registry.isEnabled("cpu");
    }

    enabled.forEach((w, i) => {
      if (isCompact) return;
      const col = i % 2 === 0 ? leftCol : rightCol;
      col.add_child(w.card.actor);
    });

    this._widgetGrid.add_child(leftCol);
    this._widgetGrid.add_child(rightCol);

    // Hide cores in compact mode
    if (this._menuItems.cores) {
      this._menuItems.cores.visible = !isCompact && this._registry.isEnabled("cpu");
    }
  }

  _rebuildPopoverCards() {
    // Rebuild the widget grid when order changes
    this._populateWidgetGrid();
  }

  _buildCoreGrid(count) {
    this._coresContainer.destroy_all_children();
    this._coreBars = [];
    const perRow = 8;
    const rows = Math.ceil(count / perRow);
    for (let r = 0; r < rows; r++) {
      const rowBox = new St.BoxLayout({
        style_class: "codenotch-core-row",
        x_expand: true,
      });
      for (let c = 0; c < perRow; c++) {
        const idx = r * perRow + c;
        if (idx >= count) break;
        const track = new St.BoxLayout({
          style_class: "codenotch-core-track",
          vertical: true,
        });
        const fill = new St.Widget({
          style_class: "codenotch-core-fill codenotch-fill-ample",
          y_align: Clutter.ActorAlign.END,
          height: 2,
        });
        const num = new St.Label({
          text: String(idx),
          style_class: "codenotch-core-num",
        });
        track.add_child(fill);
        track.add_child(num);
        rowBox.add_child(track);
        this._coreBars.push({ fill });
      }
      this._coresContainer.add_child(rowBox);
    }
  }

  _updateCores(cores) {
    if (!Array.isArray(cores)) return;
    if (this._coreBars.length !== cores.length) {
      this._buildCoreGrid(cores.length);
    }
    const CORE_MAX_H = 18;
    for (let i = 0; i < cores.length; i++) {
      const clampPct = Math.max(0, Math.min(100, cores[i]));
      const fill = this._coreBars[i].fill;
      const newH = Math.max(2, Math.round((clampPct / 100.0) * CORE_MAX_H));
      if (fill.height !== newH) fill.height = newH;
      this._applyBandColor(fill, clampPct / 100.0);
    }
  }

  _applyBandColor(widget, fraction) {
    let cls;
    if (fraction < 0.5) cls = "codenotch-fill-ample";
    else if (fraction < 0.75) cls = "codenotch-fill-watch";
    else if (fraction < 0.9) cls = "codenotch-fill-critical";
    else cls = "codenotch-fill-exhausted";

    if (widget._lastBandClass === cls) return;
    if (widget._lastBandClass) widget.remove_style_class_name(widget._lastBandClass);
    widget.add_style_class_name(cls);
    widget._lastBandClass = cls;
  }

  // ----------------------------- Dynamic-Island Morph -----------------------------

  _onMenuStateChanged(menu, open) {
    // During teardown let the stock popup tween run to completion instead of
    // animating actors that are being destroyed.
    if (this._disabling || !this._glassMenuBox) return;

    const animate = this._getBool("animate-popover", true);

    if (open) {
      this._menuOpen = true;
      this._flushLatestData();
      this._resumeUiUpdates();

      if (animate) {
        this._morphOpen();
      } else {
        this._cancelMorph();
        const bp = menu.actor;
        bp.remove_all_transitions();
        bp.opacity = 255;
        bp.scale_x = 1;
        bp.scale_y = 1;
        bp.translation_x = 0;
        bp.translation_y = 0;
        bp._muteKeys = false;
        bp._muteInput = false;
        this._setChildrenFade(255, 0);
      }
    } else {
      this._menuOpen = false;
      this._freezeUi();

      if (animate) {
        this._morphClose();
      } else {
        this._cancelMorph();
      }
    }
  }

  _cancelMorph() {
    for (const t of this._morphTimers) {
      if (t) GLib.source_remove(t);
    }
    this._morphTimers = [];
    this._morphActive = false;
    this._morphRadius = null;
    if (this._glassMenuBox) {
      this._glassMenuBox.remove_all_transitions();
      this._glassMenuBox.width = -1;
      this._glassMenuBox.height = -1;
    }
    this._setGlassStyle();
  }

  /** Start geometry: the top-bar capsule the island morphs out of. */
  _capsuleMorphSize() {
    const box = this._notchBox;
    if (box && box.width > 0 && box.height > 0) {
      return { w: Math.max(18, box.width), h: Math.max(14, box.height) };
    }
    return { w: 96, h: 34 };
  }

  /** Final geometry: the popover's natural (CSS/layout) size. */
  _preferredCardSize() {
    const bin = this._glassMenuBox;
    try {
      const [, natW] = bin.get_preferred_width(-1);
      const [, natH] = bin.get_preferred_height(-1);
      return {
        w: Math.max(natW, 320),
        h: Math.max(natH, 300),
      };
    } catch (_) {
      return { w: 430, h: 480 };
    }
  }

  /**
   * Inline glass style. While a morph is active we neutralise the CSS
   * min-width/min-height so the fixed-size width/height tween is the
   * authority, and we expose a border-radius that is animated in a few
   * cheap discrete steps alongside the shape change.
   */
  _setGlassStyle() {
    if (!this._glassMenuBox) return;
    const alpha = Math.max(
      0.3,
      Math.min(1.0, this._getDouble("glass-opacity", 0.88)),
    );
    let style = `background-color: rgba(16, 16, 22, ${alpha})`;
    if (this._morphRadius) style += `; border-radius: ${this._morphRadius}px`;
    if (this._morphActive)
      style += `; min-width: 0px; min-height: 0px`;
    this._glassMenuBox.style = style;
    this._glassMenuBox.opacity = 255;
  }

  /** Fade the popover's inner items (not the glass shell) in or out. */
  _setChildrenFade(opacity, duration, mode) {
    const bin = this._glassMenuBox;
    if (!bin) return;
    for (const child of bin.get_children()) {
      if (duration > 0) {
        child.ease_property("opacity", opacity, { duration, mode });
      } else {
        child.remove_all_transitions();
        child.opacity = opacity;
      }
    }
  }

  _morphOpen() {
    const bp = this._indicator.menu.actor;
    const bin = this._glassMenuBox;
    this._cancelMorph();

    // Suppress the stock popup tween so the island morph is the only motion:
    // an opaque glass shape, already anchored where the capsule sits.
    bp.remove_all_transitions();
    bp.set_pivot_point(0.5, 0);
    bp.opacity = 255;
    bp.scale_x = 1;
    bp.scale_y = 1;
    bp.translation_x = 0;
    bp.translation_y = 0;
    bp._muteKeys = false;
    bp._muteInput = false;

    const start = this._capsuleMorphSize();
    const fin = this._preferredCardSize();

    this._morphActive = true;
    this._morphRadius = CAPSULE_RADIUS;
    this._setGlassStyle();
    this._setChildrenFade(0, 0);

    bin.remove_all_transitions();
    bin.width = start.w;
    bin.height = start.h;

    // Real geometry morph: width, height and corner radius change together
    // from the capsule's proportions toward the full popover size, with an
    // overshooting spring curve (EASE_OUT_BACK).
    bin.ease_property("width", fin.w, {
      duration: MORPH_OPEN_MS,
      mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });
    bin.ease_property("height", fin.h, {
      duration: MORPH_OPEN_MS,
      mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });

    // Content reveals only after the morph is ~40% complete so the shape
    // change reads first; radius steps up in two cheap CSS cherry picks.
    const fadeAt = Math.round(MORPH_OPEN_MS * MORPH_FADE_START);
    this._morphTimers.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, fadeAt, () => {
        if (!this._morphActive) return GLib.SOURCE_REMOVE;
        this._morphRadius = 20;
        this._setGlassStyle();
        this._setChildrenFade(
          255,
          Math.max(180, MORPH_OPEN_MS - fadeAt - 40),
          Clutter.AnimationMode.EASE_OUT_CUBIC,
        );
        return GLib.SOURCE_REMOVE;
      }),
    );
    this._morphTimers.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(MORPH_OPEN_MS * 0.85), () => {
        if (!this._morphActive) return GLib.SOURCE_REMOVE;
        this._morphRadius = CARD_RADIUS;
        this._setGlassStyle();
        return GLib.SOURCE_REMOVE;
      }),
    );
    this._morphTimers.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, MORPH_OPEN_MS + 80, () => {
        this._morphActive = false;
        this._morphRadius = null;
        bin.width = -1;
        bin.height = -1;
        this._morphTimers = [];
        this._setGlassStyle();
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  _morphClose() {
    const bp = this._indicator.menu.actor;
    const bin = this._glassMenuBox;
    this._cancelMorph();

    // Cancel the stock hide tween: we own the reverse morph below.
    bp.remove_all_transitions();

    const start = this._capsuleMorphSize();

    this._morphActive = true;
    this._morphRadius = 20;
    this._setGlassStyle();
    this._setChildrenFade(0, 110, Clutter.AnimationMode.EASE_IN_CUBIC);

    bin.remove_all_transitions();
    // Reverse is faster and ease-in, collapsing back into the capsule.
    bin.ease_property("width", start.w, {
      duration: MORPH_CLOSE_MS,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
    });
    bin.ease_property("height", start.h, {
      duration: MORPH_CLOSE_MS,
      mode: Clutter.AnimationMode.EASE_IN_CUBIC,
    });

    this._morphTimers.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(MORPH_CLOSE_MS * 0.4), () => {
        if (!this._morphActive) return GLib.SOURCE_REMOVE;
        this._morphRadius = CAPSULE_RADIUS;
        this._setGlassStyle();
        return GLib.SOURCE_REMOVE;
      }),
    );
    this._morphTimers.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, MORPH_CLOSE_MS + 60, () => {
        this._morphActive = false;
        this._morphRadius = null;
        bin.remove_all_transitions();
        bin.width = -1;
        bin.height = -1;
        this._morphTimers = [];
        this._setGlassStyle();
        this._setChildrenFade(255, 0);
        // Restore the stock BoxPointer closed state so the popup stays fully
        // hidden and is clean for its next open.
        if (bp) {
          bp.remove_all_transitions();
          bp.opacity = 0;
          bp.scale_x = 1;
          bp.scale_y = 1;
          bp.translation_x = 0;
          bp.translation_y = 0;
          bp.hide();
          bp._muteKeys = true;
          bp._muteInput = true;
        }
        try {
          this._indicator?.menu?.emit("menu-closed");
        } catch (_) {}
        return GLib.SOURCE_REMOVE;
      }),
    );
  }

  _resumeUiUpdates() {
    if (!this._registry || this._disabling) return;
    for (const w of this._registry.all()) {
      if (w.spark && w.spark.setEnabled) w.spark.setEnabled(true);
    }
  }

  _freezeUi() {
    if (!this._registry || this._disabling) return;
    for (const w of this._registry.all()) {
      if (w.spark && w.spark.setEnabled) w.spark.setEnabled(false);
    }
  }

  /** Push the most recent telemetry sample into the popover widgets. */
  _flushLatestData() {
    if (!this._latestData || !this._registry || this._disabling) return;
    const data = this._latestData;
    for (const w of this._registry.all()) {
      if (this._registry.isEnabled(w.id)) {
        w.update(data, this._settings);
      }
    }
    this._updateCores(data.cpu_cores);
    this._updateCompactDot(data);
  }

  // ----------------------------- Telemetry handling -----------------------------

  _handleTelemetryData(rawJson) {
    let data;
    try {
      data = JSON.parse(rawJson);
    } catch (e) {
      return;
    }

    if (data.hello !== undefined) return;
    if (typeof data.paused === "boolean") return;
    if (data.interval_ms !== undefined && data.cpu === undefined) return;

    this._latestData = data;
    this._telemetryCounter++;

    // Panel capsule is always visible: update it on every sample, but only touch
    // a label when its text actually changed — identical samples shouldn't
    // queue relayouts.
    if (typeof data.cpu === "number" && this._cpuCell) {
      const cpuVal = `${Math.round(data.cpu)}%`;
      if (this._cpuCell.label.text !== cpuVal) {
        this._cpuCell.label.text = cpuVal;
      }
      if (this._cpuCell.sub) {
        const subVal =
          this._getBool("show-cpu-temp", true) &&
          typeof data.cpu_temp === "number"
            ? `${data.cpu_temp}\u00B0C`
            : "";
        if (this._cpuCell.sub.text !== subVal) this._cpuCell.sub.text = subVal;
      }
      this._cpuGauge.setValue(data.cpu);
    }

    if (typeof data.ram === "number" && this._ramCell) {
      const ramVal = `${Math.round(data.ram)}%`;
      if (this._ramCell.label.text !== ramVal) {
        this._ramCell.label.text = ramVal;
      }
      if (this._ramCell.sub) {
        const usedGb =
          data.ram_used_gb !== undefined ? data.ram_used_gb.toFixed(1) : "?";
        const totalGb =
          data.ram_total_gb !== undefined ? data.ram_total_gb.toFixed(1) : "?";
        const subVal = `${usedGb}G/${totalGb}G`;
        if (this._ramCell.sub.text !== subVal) this._ramCell.sub.text = subVal;
      }
      this._ramGauge.setValue(data.ram);
    }

    const fanPct = typeof data.fan_pct === "number" ? data.fan_pct : 0;
    const fanRpm = typeof data.fan_rpm === "number" ? data.fan_rpm : 0;
    if (this._fanCell) {
      const fanVal = `${fanPct}%`;
      if (this._fanCell.label.text !== fanVal) {
        this._fanCell.label.text = fanVal;
      }
      const fanSub = fanRpm > 0 ? `${fanRpm} RPM` : "Stopped";
      if (this._fanCell.sub.text !== fanSub) this._fanCell.sub.text = fanSub;
      this._fanGauge.setValue(fanPct);
    }

    this._updateCompactDot(data);

    // Popover contents only need refreshing while visible.
    if (!this._menuOpen) return;

    // Update each widget
    for (const w of this._registry.all()) {
      if (this._registry.isEnabled(w.id)) {
        w.update(data, this._settings);
      }
    }

    // CPU cores
    this._updateCores(data.cpu_cores);
  }

  _updateCompactDot(data) {
    if (!this._compactDot || !this._compactDot.visible) return;
    const highs = [data.cpu, data.ram, data.gpu_util].filter(
      (v) => typeof v === "number",
    );
    if (highs.length > 0) {
      const max = Math.max(...highs);
      this._applyBandColor(this._compactDot, max / 100.0);
    }
  }

  // ----------------------------- Daemon management -----------------------------

  _findDaemonPath() {
    const candidates = [
      GLib.build_filenamev([this.path, "bin", "sparkline-daemon"]),
      GLib.build_filenamev([this.path, "sparkline-daemon"]),
      GLib.build_filenamev([GLib.get_home_dir(), ".local", "bin", "sparkline-daemon"]),
      GLib.find_program_in_path("sparkline-daemon"),
    ];
    for (const candidate of candidates) {
      if (candidate && GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE)) {
        return candidate;
      }
    }
    return null;
  }

  _socketPath(kind = "service") {
    const base = GLib.get_user_runtime_dir() || GLib.get_tmp_dir();
    return GLib.build_filenamev([
      base,
      kind === "service" ? SERVICE_SOCKET : CHILD_SOCKET,
    ]);
  }

  _ensureRuntimeDir(path) {
    const dir = GLib.path_get_dirname(path);
    if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
      try {
        GLib.dir_make_with_parents(dir, 0o700);
      } catch (_) {}
    }
  }

  _tryConnectSocket(path) {
    if (!this._cancellable || this._cancellable.is_cancelled()) return null;
    try {
      const client = new Gio.SocketClient();
      const conn = client.connect(
        Gio.UnixSocketAddress.new(path),
        this._cancellable,
      );
      return conn;
    } catch (e) {
      return null;
    }
  }

  _startDaemon() {
    this._restartBackoff = 2000;
    const servicePath = this._socketPath("service");
    this._ensureRuntimeDir(servicePath);

    const conn = this._tryConnectSocket(servicePath);
    if (conn) {
      this._adoptSocket(conn, false);
      return;
    }
    this._spawnChild();
  }

  _spawnChild() {
    const daemonPath = this._findDaemonPath();
    if (!daemonPath) {
      console.warn(
        `[${this.metadata.name}] sparkline-daemon binary not found. Running degraded.`,
      );
      return;
    }
    try {
      this._proc = Gio.Subprocess.new(
        [daemonPath, "--listen", this._socketPath("child")],
        Gio.SubprocessFlags.STDERR_SILENCE,
      );
      this._monitorDaemon();
      this._retryConnect(0);
    } catch (err) {
      console.error(
        `[${this.metadata.name}] Failed to spawn daemon: ${err.message}`,
      );
    }
  }

  _retryConnect(attempt) {
    if (this._disabling || !this._proc || this._cancellable?.is_cancelled())
      return;
    const conn = this._tryConnectSocket(this._socketPath("child"));
    if (conn) {
      this._adoptSocket(conn, true);
      return;
    }
    if (attempt >= 20) {
      const svcConn = this._tryConnectSocket(this._socketPath("service"));
      if (svcConn) {
        try {
          this._intentionalExit = true;
          this._proc.force_exit();
        } catch (_) {}
        this._proc = null;
        this._adoptSocket(svcConn, false);
        return;
      }
    }
    const delay = Math.min(100 + attempt * 50, 2000);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._retryConnect(attempt + 1);
      return GLib.SOURCE_REMOVE;
    });
  }

  _adoptSocket(conn, owns) {
    this._ownsDaemon = owns;
    this._conn = conn;
    this._stream = new Gio.DataInputStream({
      base_stream: conn.input_stream,
      close_base_stream: true,
    });
    this._writeStream = conn.output_stream;
    this._restartBackoff = 2000;
    this._sendCommand(
      `INTERVAL ${Math.max(200, this._getInt("poll-interval", 1200))}`,
    );
    this._updatePauseState();
    this._readNextLine();
  }

  _handleDaemonGone() {
    this._conn = null;
    this._writeStream = null;
    this._ownsDaemon = false;
    if (this._disabling) return;
    this._scheduleRestart();
  }

  _monitorDaemon() {
    if (!this._proc) return;
    this._proc.wait_async(null, (proc, result) => {
      try {
        proc.wait_finish(result);
      } catch (_) {}
      if (this._disabling) return;
      if (this._intentionalExit) {
        this._intentionalExit = false;
        return;
      }
      this._proc = null;
      this._stream = null;
      this._scheduleRestart();
    });
  }

  _scheduleRestart() {
    if (this._restartTimer || this._disabling) return;
    const delay = this._restartBackoff;
    this._restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._restartTimer = 0;
      this._startDaemon();
      return GLib.SOURCE_REMOVE;
    });
    this._restartBackoff = Math.min(this._restartBackoff * 2, 15000);
  }

  _readNextLine() {
    if (!this._stream || this._cancellable?.is_cancelled()) return;
    this._stream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (stream, result) => {
        try {
          const [bytes] = stream.read_line_finish_utf8(result);
          if (stream !== this._stream) return;
          if (bytes !== null) {
            this._handleTelemetryData(bytes);
            this._readNextLine();
          } else {
            this._daemonPaused = false;
            this._handleDaemonGone();
          }
        } catch (err) {
          if (this._cancellable && !this._cancellable.is_cancelled()) {
            console.error(`[${this.metadata.name}] Read error: ${err.message}`);
            this._handleDaemonGone();
          }
        }
      },
    );
  }

  _sendCommand(line) {
    if (!this._writeStream) return;
    try {
      this._writeStream.write_all(
        new TextEncoder().encode(line + "\n"),
        null,
      );
      this._writeStream.flush(null);
    } catch (_) {}
  }

  // ----------------------------- Lock / suspend handling -----------------------------

  _isLocked() {
    try {
      if (Main.sessionMode && Main.sessionMode.isLocked) return true;
    } catch (_) {}
    try {
      if (Main.screenShield && Main.screenShield.locked) return true;
    } catch (_) {}
    return false;
  }

  _updatePauseState() {
    if (!this._writeStream) return;
    const away = this._getBool("pause-away", true);
    const locked = this._isLocked();
    const shouldPause = away && (locked || this._manualPaused);
    if (shouldPause !== this._pauseWanted) {
      this._pauseWanted = shouldPause;
      this._sendCommand(shouldPause ? "PAUSE" : "RESUME");
    }
  }

  _setupSleepListener() {
    try {
      this._loginProxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE,
        null,
        "org.freedesktop.login1",
        "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager",
        null,
      );
      this._sleepId = this._loginProxy.connectSignal(
        "PrepareForSleep",
        (_p, _s, params) => {
          const preparing = Array.isArray(params) && params[0];
          if (!preparing) this._afterSuspend();
        },
      );
    } catch (e) {
      console.warn(
        `[${this.metadata.name}] No logind listener available: ${e.message}`,
      );
    }
  }

  _afterSuspend() {
    if (this._disabling) return;
    this._sendCommand("RESET");
  }

  // ----------------------------- Preferences -----------------------------

  _openPreferences() {
    try {
      import("resource:///org/gnome/shell/misc/extensionUtils.js")
        .then(({ openPrefs }) => openPrefs(this.uuid))
        .catch(
          (e) =>
            console.error(`[${this.metadata.name}] openPrefs failed: ${e.message}`),
        );
    } catch (e) {
      console.error(`[${this.metadata.name}] openPrefs failed: ${e.message}`);
    }
  }

  getPreferencesWidget() {
    this._loadSettings();
    const settings = this._settings;
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 4,
      margin_top: 18,
      margin_bottom: 18,
      margin_start: 24,
      margin_end: 24,
      halign: Gtk.Align.FILL,
    });

    const heading = new Gtk.Label({
      label: "Codenotch Monitor",
      halign: Gtk.Align.START,
      xalign: 0,
    });
    heading.add_css_class("title-1");
    const subheading = new Gtk.Label({
      label:
        "Liquid Glass system monitor powered by a native Rust telemetry daemon" +
        (settings ? "" : " (schema not found \u2014 running defaults)"),
      halign: Gtk.Align.START,
      xalign: 0,
    });
    subheading.add_css_class("dim-label");
    box.append(heading);
    box.append(subheading);

    box.append(new Gtk.Separator({ margin_top: 12, margin_bottom: 8 }));

    const addSwitchRow = (labelText, key) => {
      const row = new Gtk.Box({ spacing: 12, margin_top: 6 });
      const label = new Gtk.Label({
        label: labelText,
        hexpand: true,
        halign: Gtk.Align.START,
        xalign: 0,
      });
      const sw = new Gtk.Switch();
      if (settings)
        settings.bind(key, sw, "active", Gio.SettingsBindFlags.DEFAULT);
      row.append(label);
      row.append(sw);
      box.append(row);
    };

    const addSpinRow = (labelText, key, low, high, step) => {
      const row = new Gtk.Box({ spacing: 12, margin_top: 6 });
      const label = new Gtk.Label({
        label: labelText,
        hexpand: true,
        halign: Gtk.Align.START,
        xalign: 0,
      });
      const adj = new Gtk.Adjustment({
        lower: low,
        upper: high,
        step_increment: step,
      });
      const spin = new Gtk.SpinButton({ adjustment: adj });
      if (settings)
        settings.bind(key, spin, "value", Gio.SettingsBindFlags.DEFAULT);
      row.append(label);
      row.append(spin);
      box.append(row);
    };

    // --- General ---
    const generalGroup = new Gtk.Label({
      label: "General",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 8,
    });
    generalGroup.add_css_class("heading");
    box.append(generalGroup);

    addSpinRow("Poll interval (ms)", "poll-interval", 200, 10000, 100);
    addSwitchRow("Pause telemetry while locked", "pause-away");
    addSwitchRow("Compact mode (status dot)", "compact-mode");

    // --- Appearance ---
    const appearGroup = new Gtk.Label({
      label: "Appearance",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 12,
    });
    appearGroup.add_css_class("heading");
    box.append(appearGroup);

    addSwitchRow("Animate popover", "animate-popover");
    addSwitchRow("Monochrome palette", "mono-palette");

    // --- Visible widgets ---
    const widgetsGroup = new Gtk.Label({
      label: "Widgets",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 12,
    });
    widgetsGroup.add_css_class("heading");
    box.append(widgetsGroup);

    addSwitchRow("CPU", "show-cpu");
    addSwitchRow("CPU temperature", "show-cpu-temp");
    addSwitchRow("Memory", "show-ram");
    addSwitchRow("GPU", "show-gpu");
    addSwitchRow("Cooling fans", "show-fan");
    addSwitchRow("Network", "show-network");
    addSwitchRow("Disk I/O", "show-disk");
    addSwitchRow("History overview", "show-history");
    addSwitchRow("Top processes", "show-processes");

    return box;
  }

  // ----------------------------- Teardown -----------------------------

  _tearDownConnection() {
    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }
    if (this._conn) {
      try {
        this._conn.close(null);
      } catch (_) {}
      this._conn = null;
    }
    this._writeStream = null;
    this._ownsDaemon = false;
    this._daemonPaused = false;
  }

  disable() {
    this._disabling = true;

    this._cancelMorph();

    if (this._lockWatchdog) {
      GLib.source_remove(this._lockWatchdog);
      this._lockWatchdog = 0;
    }

    if (this._sleepId && this._loginProxy) {
      try {
        this._loginProxy.disconnectSignal(this._sleepId);
      } catch (_) {}
    }
    this._loginProxy = null;
    this._sleepId = 0;

    if (this._restartTimer) {
      GLib.source_remove(this._restartTimer);
      this._restartTimer = 0;
    }

    if (this._settings && this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
      this._settings = null;
    }

    if (this._cancellable) {
      this._cancellable.cancel();
      this._cancellable = null;
    }

    this._tearDownConnection();

    if (this._proc) {
      try {
        this._proc.force_exit();
      } catch (_) {}
      this._proc = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    try {
      Main.panel.remove_style_class_name("codenotch-vertical-panel");
    } catch (_) {}

    this._cpuGauge = null;
    this._ramGauge = null;
    this._fanGauge = null;
    this._coreBars = [];
    this._pauseSwitch = null;
    this._compactSwitch = null;
    this._registry = null;
  }
}
