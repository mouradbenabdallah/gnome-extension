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

const SCHEMA_ID = "org.gnome.shell.extensions.sparkline-monitor";
const SERVICE_SOCKET = "codenotch-monitor.service.sock";
const CHILD_SOCKET = "codenotch-monitor.child.sock";
const HISTORY_POINTS = 30;

const BAND_CLASSES = [
  "codenotch-fill-ample",
  "codenotch-fill-watch",
  "codenotch-fill-critical",
  "codenotch-fill-exhausted",
];

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
    this._batPresent = false;
    this._cpuHistory = [];

    this._alertConsec = { cpu: 0, gpu: 0, cpuTemp: 0, gpuTemp: 0 };
    this._activeAlerts = {};
    this._fanRows = [];
    this._procRows = [];

    this._loadSettings();

    // 1. Create Panel Indicator Button
    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

    // 2. Codenotch Notch Capsule
    const notchBox = new St.BoxLayout({
      style_class: "codenotch-notch-box",
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
    });

    // --- CPU Cell ---
    const cpuBox = this._addPanelCell("cpu");
    notchBox.add_child(cpuBox);
    this._cpuCell = cpuBox;

    // --- RAM Cell ---
    const ramBox = this._addPanelCell("ram");
    notchBox.add_child(ramBox);
    this._ramCell = ramBox;

    // --- Fan Cell ---
    const fanBox = this._addPanelCell("fan");
    notchBox.add_child(fanBox);
    this._fanCell = fanBox;

    // --- Battery Cell (laptops only) ---
    const batBox = this._addPanelCell("battery");
    notchBox.add_child(batBox);
    this._batCell = batBox;

    // --- Compact status dot ---
    this._compactDot = new St.Widget({
      style_class: "codenotch-dot codenotch-fill-ample",
      y_align: Clutter.ActorAlign.CENTER,
    });
    notchBox.add_child(this._compactDot);

    this._indicator.add_child(notchBox);

    // 3. Build Codenotch Tooltip Card Menu
    this._buildCodenotchCard();

    // 4. Add to GNOME Shell status area
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // 5. Apply settings-driven visibility & palette
    this._applyUiSettings();
    this._applyPalette();

    // 6. Pause telemetry while the screen is locked / away
    this._updatePauseState();
    this._lockWatchdog = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      this._updatePauseState();
      return GLib.SOURCE_CONTINUE;
    });

    // 7. Re-detect sensors after suspend/wake
    this._setupSleepListener();

    // 8. Connect to a running daemon (systemd service or child fallback)
    this._startDaemon();
  }

  _addPanelCell(type) {
    const cell = new St.BoxLayout({
      style_class: "codenotch-metric-cell",
      y_align: Clutter.ActorAlign.CENTER,
    });
    if (type === "cpu") {
      this._cpuGauge = new RingGauge({ type: "cpu", size: 28, strokeWidth: 2.8 });
      this._cpuLabel = new St.Label({
        text: "0%",
        style_class: "codenotch-value-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      cell.add_child(this._cpuGauge);
      cell.add_child(this._cpuLabel);
    } else if (type === "ram") {
      this._ramGauge = new RingGauge({ type: "ram", size: 28, strokeWidth: 2.8 });
      this._ramLabel = new St.Label({
        text: "0%",
        style_class: "codenotch-value-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      cell.add_child(this._ramGauge);
      cell.add_child(this._ramLabel);
    } else if (type === "fan") {
      this._fanGauge = new RingGauge({ type: "fan", size: 28, strokeWidth: 2.8 });
      this._fanLabel = new St.Label({
        text: "0%",
        style_class: "codenotch-value-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._fanRpmLabel = new St.Label({
        text: "",
        style_class: "codenotch-fan-rpm",
        y_align: Clutter.ActorAlign.CENTER,
      });
      cell.add_child(this._fanGauge);
      cell.add_child(this._fanLabel);
      cell.add_child(this._fanRpmLabel);
    } else if (type === "battery") {
      this._batGauge = new RingGauge({ type: "battery", size: 28, strokeWidth: 2.8 });
      this._batLabel = new St.Label({
        text: "–",
        style_class: "codenotch-value-label",
        y_align: Clutter.ActorAlign.CENTER,
      });
      cell.add_child(this._batGauge);
      cell.add_child(this._batLabel);
    }
    return cell;
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

  _setBool(key, value) {
    if (this._settings) this._settings.set_boolean(key, value);
  }

  _onSettingsChanged(_settings, key) {
    if (key === "poll-interval") {
      this._sendCommand(`INTERVAL ${Math.max(200, this._getInt("poll-interval", 1200))}`);
      return;
    }
    if (key === "pause-away") {
      this._updatePauseState();
    }
    if (key === "mono-palette") {
      this._applyPalette();
    }
    this._applyUiSettings();
  }

  _applyPalette() {
    const mono = this._getBool("mono-palette", false);
    const palette = mono ? "mono" : "codenotch";
    for (const gauge of [this._cpuGauge, this._ramGauge, this._fanGauge, this._batGauge]) {
      if (gauge) gauge.setPalette(palette);
    }
  }

  _applyUiSettings() {
    const compact = this._getBool("compact-mode", false);
    const showCpu = this._getBool("show-cpu", true);
    const showRam = this._getBool("show-ram", true);
    const showFan = this._getBool("show-fan", true);
    const showBattery = this._getBool("show-battery", true);
    const showGpu = this._getBool("show-gpu", true);
    const showNet = this._getBool("show-network", true);
    const showDisk = this._getBool("show-disk", true);
    const showProcs = this._getBool("show-processes", true);
    const showHistory = this._getBool("show-history", true);

    if (this._cpuCell) this._cpuCell.visible = !compact && showCpu;
    if (this._ramCell) this._ramCell.visible = !compact && showRam;
    if (this._fanCell) this._fanCell.visible = !compact && showFan;
    if (this._batCell) this._batCell.visible = !compact && showBattery && this._batPresent;
    if (this._compactDot) this._compactDot.visible = compact;

    if (this._menuItems) {
      this._menuItems.cpu.visible = showCpu;
      this._menuItems.cores.visible = showCpu;
      this._menuItems.ram.visible = showRam;
      this._menuItems.fan.visible = showFan;
      this._menuItems.battery.visible = showBattery && this._batPresent;
      this._menuItems.history.visible = showHistory;
      this._menuItems.gpu.visible = showGpu;
      this._menuItems.network.visible = showNet;
      this._menuItems.disk.visible = showDisk;
      this._menuItems.processes.visible = showProcs;
    }

    if (this._compactSwitch) {
      this._compactSwitch.setToggleState(compact);
    }
  }

  // ----------------------------- Popover card -----------------------------

  _buildCodenotchCard() {
    const menu = this._indicator.menu;
    menu.box.add_style_class_name("codenotch-card-menu");
    menu.actor.add_style_class_name("codenotch-menu-boxpointer");
    menu.connect("open-state-changed", this._onMenuStateChanged.bind(this));

    this._menuItems = {};

    // Header
    const headerItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const headerBox = new St.BoxLayout({ vertical: true });
    const titleLabel = new St.Label({
      text: "System Monitor",
      style_class: "codenotch-card-header",
    });
    const subLabel = new St.Label({
      text: "Live Hardware Telemetry",
      style_class: "codenotch-card-subtitle",
    });
    this._bannerLabel = new St.Label({
      text: "",
      style_class: "codenotch-alert-banner",
      visible: false,
    });
    headerBox.add_child(titleLabel);
    headerBox.add_child(subLabel);
    headerBox.add_child(this._bannerLabel);
    headerItem.add_child(headerBox);
    menu.addMenuItem(headerItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // --- CPU Section ---
    this._menuItems.cpu = this._addSection(menu, {
      title: "CPU Utilization",
      initialVal: "0.0%",
    });
    this._cpuSpark = new Sparkline({ color: "#5bc0ff", width: 190, height: 22 });
    this._sectionAddSpark(this._menuItems.cpu, this._cpuSpark);

    // --- CPU Cores grid (populated on first data) ---
    const coresItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const coresWrap = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
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

    // --- History overview (last ~30s of CPU) ---
    const historyItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const historyWrap = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const historyTitle = new St.Label({
      text: "History (last 30 s)",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._historySpark = new Sparkline({ color: "#5bc0ff", width: 190, height: 26 });
    const historyGraphWrap = new St.BoxLayout({
      style_class: "codenotch-sparkline-wrap",
      x_expand: true,
    });
    historyGraphWrap.add_child(this._historySpark);
    historyWrap.add_child(historyTitle);
    historyWrap.add_child(historyGraphWrap);
    historyItem.add_child(historyWrap);
    menu.addMenuItem(historyItem);
    this._menuItems.history = historyItem;

    // --- RAM Section ---
    this._menuItems.ram = this._addSection(menu, {
      title: "RAM Memory",
      initialVal: "0.0 / 0.0 GB (0%)",
    });

    // --- Fan Section ---
    this._menuItems.fan = this._addSection(menu, {
      title: "Cooling Fans",
      initialVal: "0 RPM (0%)",
    });
    this._fanSubList = new St.BoxLayout({ vertical: true });
    this._fanSubList.add_style_class_name("codenotch-fansublist");
    this._menuItems.fan.container.add_child(this._fanSubList);

    // --- Battery Section ---
    this._menuItems.battery = this._addSection(menu, {
      title: "Battery",
      initialVal: "Detecting…",
    });

    // --- GPU Section ---
    this._menuItems.gpu = this._addSection(menu, {
      title: "GPU",
      initialVal: "Detecting…",
    });
    this._gpuTitleLbl = this._menuItems.gpu.titleLbl;
    this._gpuSpark = new Sparkline({ color: "#00ff88", width: 190, height: 22 });
    this._sectionAddSpark(this._menuItems.gpu, this._gpuSpark);

    // --- Network Section ---
    this._menuItems.network = this._addSection(menu, {
      title: "Network",
      initialVal: "0 KB/s",
    });
    this._netRxSpark = new Sparkline({ color: "#00d2ff", width: 90, height: 22 });
    this._netTxSpark = new Sparkline({ color: "#ff7ad9", width: 90, height: 22 });
    this._sectionAddSparkPair(this._menuItems.network, this._netRxSpark, this._netTxSpark);

    // --- Disk Section ---
    this._menuItems.disk = this._addSection(menu, {
      title: "Disk I/O",
      initialVal: "0 KB/s",
    });
    this._diskReadSpark = new Sparkline({ color: "#00ff88", width: 90, height: 22 });
    this._diskWriteSpark = new Sparkline({ color: "#ffb000", width: 90, height: 22 });
    this._sectionAddSparkPair(this._menuItems.disk, this._diskReadSpark, this._diskWriteSpark);

    // --- Top Processes Section ---
    const procItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const procWrap = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const procTitle = new St.Label({
      text: "Top Processes",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._procList = new St.BoxLayout({ vertical: true });
    procWrap.add_child(procTitle);
    procWrap.add_child(this._procList);
    procItem.add_child(procWrap);
    menu.addMenuItem(procItem);
    this._menuItems.processes = procItem;

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // --- Pause telemetry (manual override) ---
    this._pauseSwitch = new PopupMenu.PopupSwitchMenuItem("Pause telemetry", this._manualPaused);
    this._pauseSwitch.connect("toggled", (_item, state) => {
      this._manualPaused = state;
      this._updatePauseState();
    });
    menu.addMenuItem(this._pauseSwitch);

    // --- Compact mode quick toggle ---
    this._compactSwitch = new PopupMenu.PopupSwitchMenuItem(
      "Compact mode (status dot)",
      this._getBool("compact-mode", false),
    );
    this._compactSwitch.connect("toggled", (_item, state) => {
      this._setBool("compact-mode", state);
    });
    menu.addMenuItem(this._compactSwitch);

    // --- Reinitialize sensors (after driver reload / suspend quirks) ---
    const reinitItem = new PopupMenu.PopupMenuItem("Reinitialize sensors");
    reinitItem.connect("activate", () => {
      this._sendCommand("RESET");
    });
    menu.addMenuItem(reinitItem);

    // --- Settings ---
    const settingsItem = new PopupMenu.PopupMenuItem("Settings…");
    settingsItem.connect("activate", () => {
      this._openPreferences();
    });
    menu.addMenuItem(settingsItem);
  }

  /** Builds a titled section item with a value label + progress bar. */
  _addSection(menu, { title, initialVal }) {
    const item = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const container = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const row = new St.BoxLayout({ style_class: "codenotch-card-row", x_expand: true });
    const titleLbl = new St.Label({
      text: title,
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    const valLbl = new St.Label({
      text: initialVal,
      style_class: "codenotch-card-val",
    });
    row.add_child(titleLbl);
    row.add_child(valLbl);

    const track = new St.BoxLayout({ style_class: "codenotch-progress-track", x_expand: true });
    const bar = new St.Widget({
      style_class: "codenotch-progress-fill codenotch-fill-ample",
      width: 0,
    });
    track.add_child(bar);

    container.add_child(row);
    container.add_child(track);
    item.add_child(container);
    menu.addMenuItem(item);
    return { item, container, titleLbl, valLbl, bar };
  }

  _sectionAddSpark(section, spark) {
    const wrap = new St.BoxLayout({
      style_class: "codenotch-sparkline-wrap",
      x_expand: true,
    });
    wrap.add_child(spark);
    section.container.add_child(wrap);
    return wrap;
  }

  _sectionAddSparkPair(section, sparkA, sparkB) {
    const wrap = new St.BoxLayout({
      style_class: "codenotch-sparkline-pair-wrap",
      x_expand: true,
    });
    wrap.add_child(sparkA);
    wrap.add_child(sparkB);
    section.container.add_child(wrap);
    return wrap;
  }

  _buildCoreGrid(count) {
    this._coresContainer.destroy_all_children();
    this._coreBars = [];
    const perRow = 4;
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
    for (let i = 0; i < cores.length; i++) {
      const clampPct = Math.max(0, Math.min(100, cores[i]));
      const fill = this._coreBars[i].fill;
      fill.height = Math.max(2, Math.round((clampPct / 100.0) * 36));
      this._applyBandColor(fill, clampPct / 100.0);
    }
  }

  /** Keeps `rows` in sync with `dataList` of [name, value] pairs, reusing widgets. */
  _syncRows(parent, rows, dataList) {
    while (rows.length < dataList.length) {
      const rowBox = new St.BoxLayout({
        style_class: "codenotch-card-row",
        x_expand: true,
      });
      const nameLbl = new St.Label({
        style_class: "codenotch-card-subtitle",
        x_expand: true,
      });
      const valLbl = new St.Label({
        style_class: "codenotch-card-subtitle",
      });
      rowBox.add_child(nameLbl);
      rowBox.add_child(valLbl);
      parent.add_child(rowBox);
      rows.push({ row: rowBox, nameLbl, valLbl });
    }
    dataList.forEach(([name, value], i) => {
      rows[i].nameLbl.text = name;
      rows[i].valLbl.text = value;
      rows[i].row.visible = true;
    });
    for (let i = dataList.length; i < rows.length; i++) {
      rows[i].row.visible = false;
    }
  }

  _bandClass(fraction) {
    if (fraction < 0.5) return "codenotch-fill-ample";
    if (fraction < 0.75) return "codenotch-fill-watch";
    if (fraction < 0.9) return "codenotch-fill-critical";
    return "codenotch-fill-exhausted";
  }

  _applyBandColor(widget, fraction) {
    for (const cls of BAND_CLASSES) widget.remove_style_class_name(cls);
    widget.add_style_class_name(this._bandClass(fraction));
  }

  _updateProgressBar(widget, fraction) {
    const totalW = 190;
    const fillW = Math.max(0, Math.min(totalW, Math.round(fraction * totalW)));
    widget.width = fillW;
    this._applyBandColor(widget, fraction);
  }

  _fmtRate(kbs) {
    if (kbs >= 1024) return `${(kbs / 1024.0).toFixed(1)} MB/s`;
    return `${Math.round(kbs)} KB/s`;
  }

  // ----------------------------- Popover animation -----------------------------

  _onMenuStateChanged(menu, open) {
    const content = menu.box;
    const animate = this._getBool("animate-popover", true);

    if (open) {
      if (animate) {
        content.remove_all_transitions();
        content.set_pivot_point(0.5, 0);
        content.scale_x = 0.88;
        content.scale_y = 0.88;
        content.opacity = 0;
        content.translation_y = -10;
        content.ease_property("opacity", 255, {
          duration: 200,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        content.ease_property("scale-x", 1, {
          duration: 360,
          mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        content.ease_property("scale-y", 1, {
          duration: 360,
          mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        content.ease_property("translation-y", 0, {
          duration: 280,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
      } else {
        content.remove_all_transitions();
        content.set_pivot_point(0.5, 0);
        content.scale_x = 1;
        content.scale_y = 1;
        content.opacity = 255;
        content.translation_y = 0;
      }
    } else {
      if (animate) {
        content.remove_all_transitions();
        content.ease_property("opacity", 0, {
          duration: 130,
          mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        content.ease_property("scale-x", 0.92, {
          duration: 160,
          mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        content.ease_property("scale-y", 0.92, {
          duration: 160,
          mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        content.ease_property("translation-y", 6, {
          duration: 160,
          mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
      }
    }
  }

  // ----------------------------- Alerts -----------------------------

  _checkSustained(key, value, threshold, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) return;

    if (value >= threshold) {
      this._alertConsec[key] = (this._alertConsec[key] || 0) + 1;
      if (this._alertConsec[key] >= 3 && !this._activeAlerts[key]) {
        this._activeAlerts[key] = label;
        this._notify(`⚠ ${label}`);
        this._renderAlerts();
      }
    } else if (value <= threshold - 5) {
      this._alertConsec[key] = 0;
      if (this._activeAlerts[key]) {
        delete this._activeAlerts[key];
        this._notify(`✓ ${label} recovered`);
        this._renderAlerts();
      }
    }
  }

  /** Joins whatever alerts are currently active into the popover banner. */
  _renderAlerts() {
    const msgs = Object.values(this._activeAlerts);
    this._setBanner(msgs.length ? `⚠ ${msgs.join("  ·  ")}` : null);
  }

  _setBanner(text) {
    if (!this._bannerLabel) return;
    if (text) {
      this._bannerLabel.text = text;
      this._bannerLabel.visible = true;
    } else {
      this._bannerLabel.visible = false;
    }
  }

  _notify(text) {
    if (typeof Main.notify !== "function") return;
    try {
      Main.notify(this.metadata.name, text);
    } catch (_) {}
  }

  // ----------------------------- Telemetry handling -----------------------------

  _handleTelemetryData(rawJson) {
    let data;
    try {
      data = JSON.parse(rawJson);
    } catch (e) {
      return;
    }

    // Control lines (hello / paused / interval) are not metric samples.
    if (data.hello !== undefined) return;
    if (typeof data.paused === "boolean") return;
    if (data.interval_ms !== undefined && data.cpu === undefined) return;

    // 1. CPU
    if (typeof data.cpu === "number") {
      this._cpuGauge.setValue(data.cpu);
      this._cpuLabel.text = `${Math.round(data.cpu)}%`;
      if (this._menuItems.cpu) {
        let text = `${data.cpu.toFixed(1)}%`;
        if (this._getBool("show-cpu-temp", true) && typeof data.cpu_temp === "number") {
          text += `  ·  ${data.cpu_temp}°C`;
        }
        this._menuItems.cpu.valLbl.text = text;
        this._updateProgressBar(this._menuItems.cpu.bar, data.cpu / 100.0);
      }
      if (this._cpuSpark) this._cpuSpark.pushValue(data.cpu);
      this._checkSustained("cpu", data.cpu, this._getDouble("cpu-alert", 85), `CPU ${Math.round(data.cpu)}%`);
    }
    this._updateCores(data.cpu_cores);

    this._pushHistory(data.cpu);

    // CPU temperature alert channel
    if (typeof data.cpu_temp === "number") {
      this._checkSustained(
        "cpuTemp",
        data.cpu_temp,
        this._getDouble("temp-alert", 85),
        `CPU temp ${Math.round(data.cpu_temp)}°C`,
      );
    }

    // 2. RAM
    if (typeof data.ram === "number") {
      this._ramGauge.setValue(data.ram);
      this._ramLabel.text = `${Math.round(data.ram)}%`;
      const usedGb =
        data.ram_used_gb !== undefined ? `${data.ram_used_gb.toFixed(1)}` : "?";
      const totalGb =
        data.ram_total_gb !== undefined ? `${data.ram_total_gb.toFixed(1)}` : "?";
      if (this._menuItems.ram)
        this._menuItems.ram.valLbl.text = `${usedGb} / ${totalGb} GB (${data.ram.toFixed(1)}%)`;
      this._updateProgressBar(this._menuItems.ram.bar, data.ram / 100.0);
    }

    // 3. Fans
    const fanPct = typeof data.fan_pct === "number" ? data.fan_pct : 0;
    const fanRpm = typeof data.fan_rpm === "number" ? data.fan_rpm : 0;
    this._fanGauge.setValue(fanPct);
    this._fanLabel.text = `${fanPct}%`;
    if (this._menuItems.fan) {
      if (fanRpm > 0) {
        this._fanRpmLabel.text = `${fanRpm} RPM`;
        this._menuItems.fan.valLbl.text = `${fanRpm} RPM (${fanPct}%)`;
      } else {
        this._fanRpmLabel.text = fanPct > 0 ? "" : "Idle";
        this._menuItems.fan.valLbl.text = fanPct > 0 ? `${fanPct}%` : "Idle / Stopped";
      }
      this._updateProgressBar(this._menuItems.fan.bar, fanPct / 100.0);
    }

    // Fan sublist (rows reused, no more rebuilds every tick)
    const fanRows = Array.isArray(data.fans)
      ? data.fans.map((f) => [
          f.label || "Fan",
          f.rpm > 0 ? `${f.rpm} RPM (${f.pct}%)` : `${f.pct}%`,
        ])
      : [];
    this._syncRows(this._fanSubList, this._fanRows, fanRows);

    // 3b. Battery
    if (typeof data.bat_pct === "number") {
      const wasPresent = this._batPresent;
      this._batPresent = true;
      if (!wasPresent) this._applyUiSettings();
      this._batGauge.setValue(data.bat_pct);
      this._batLabel.text = `${data.bat_pct}%`;
      if (this._menuItems.battery) {
        const status = typeof data.bat_status === "string" ? data.bat_status : "—";
        this._menuItems.battery.valLbl.text = `${status}  ·  ${data.bat_pct}%`;
        this._updateProgressBar(this._menuItems.battery.bar, data.bat_pct / 100.0);
      }
    }

    // 4. GPU
    if (this._menuItems.gpu) {
      const gpuUtil =
        typeof data.gpu_util === "number" && data.gpu_util !== null ? data.gpu_util : 0;
      const temp =
        typeof data.gpu_temp === "number" && data.gpu_temp !== null
          ? `${data.gpu_temp}°C`
          : "--°C";
      if (data.gpu_name && this._gpuTitleLbl)
        this._gpuTitleLbl.text = `${data.gpu_name} GPU`;
      const actionable = typeof data.gpu_util === "number";
      this._menuItems.gpu.valLbl.text = actionable
        ? `${data.gpu_util}%  ·  ${temp}`
        : `Standby / Sleep  ·  ${temp}`;
      this._updateProgressBar(this._menuItems.gpu.bar, gpuUtil / 100.0);
      this._gpuSpark.pushValue(gpuUtil);
      this._checkSustained("gpu", gpuUtil, this._getDouble("gpu-alert", 90), `GPU ${Math.round(gpuUtil)}%`);
      if (typeof data.gpu_temp === "number")
        this._checkSustained(
          "gpuTemp",
          data.gpu_temp,
          this._getDouble("temp-alert", 85),
          `GPU temp ${Math.round(data.gpu_temp)}°C`,
        );
    }

    // 5. Network
    if (this._menuItems.network) {
      const rx = typeof data.net_rx_kbs === "number" ? data.net_rx_kbs : 0;
      const tx = typeof data.net_tx_kbs === "number" ? data.net_tx_kbs : 0;
      this._menuItems.network.valLbl.text = `↓ ${this._fmtRate(rx)}   ↑ ${this._fmtRate(tx)}`;
      if (this._netRxSpark) this._netRxSpark.pushValue(rx);
      if (this._netTxSpark) this._netTxSpark.pushValue(tx);
    }

    // 6. Disk
    if (this._menuItems.disk) {
      const rd = typeof data.disk_read_kbs === "number" ? data.disk_read_kbs : 0;
      const wr = typeof data.disk_write_kbs === "number" ? data.disk_write_kbs : 0;
      this._menuItems.disk.valLbl.text = `R ${this._fmtRate(rd)}  ·  W ${this._fmtRate(wr)}`;
      if (this._diskReadSpark) this._diskReadSpark.pushValue(rd);
      if (this._diskWriteSpark) this._diskWriteSpark.pushValue(wr);
    }

    // 7. Top processes (rows reused)
    const procRows = Array.isArray(data.top)
      ? data.top.map((p) => [
          p.name || `PID ${p.pid || "?"}`,
          p.cpu >= 100 ? ">99%" : `${Math.round(p.cpu)}%`,
        ])
      : [];
    this._syncRows(this._procList, this._procRows, procRows);

    // 8. Compact status dot color
    if (this._compactDot && this._compactDot.visible) {
      const highs = [data.cpu, data.ram, data.gpu_util].filter((v) => typeof v === "number");
      if (highs.length > 0) {
        const max = Math.max(...highs);
        this._applyBandColor(this._compactDot, max / 100.0);
      }
    }
  }

  _pushHistory(cpu) {
    if (typeof cpu !== "number" || !this._historySpark) return;
    this._cpuHistory.push(cpu);
    while (this._cpuHistory.length > HISTORY_POINTS) this._cpuHistory.shift();
    this._historySpark.setData(this._cpuHistory);
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

  /** Priming the runtime dir used by the socket(s). */
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
      const conn = client.connect(Gio.UnixSocketAddress.new(path), this._cancellable);
      return conn;
    } catch (e) {
      return null;
    }
  }

  /**
   * Preferred startup: adopt an already-running daemon (systemd user service).
   * Falls back to spawning our own child and connecting to it.
   */
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
      console.warn(`[${this.metadata.name}] sparkline-daemon binary not found. Running degraded.`);
      if (this._menuItems && this._menuItems.cpu)
        this._menuItems.cpu.valLbl.text = "Daemon binary missing. Re-run install.sh.";
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
      console.error(`[${this.metadata.name}] Failed to spawn daemon: ${err.message}`);
    }
  }

  /**
   * Keep trying to reach the child daemon once its socket is live. Retries with
   * a growing delay instead of ever giving up, and falls back to the systemd
   * service socket if it (re)appears while we wait.
   */
  _retryConnect(attempt) {
    if (this._disabling || !this._proc || this._cancellable?.is_cancelled()) return;
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

    // Synchronize the poll interval with the preference.
    this._sendCommand(`INTERVAL ${Math.max(200, this._getInt("poll-interval", 1200))}`);
    this._updatePauseState();
    this._readNextLine();
  }

  /** Respawns/reconnects when the current data source goes away. */
  _handleDaemonGone() {
    this._conn = null;
    this._writeStream = null;
    this._ownsDaemon = false;
    if (this._disabling) return;
    this._scheduleRestart();
  }

  /** Respawns the child if it exits unexpectedly (with backoff). */
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
    if (!this._stream || this._cancellable?.is_cancelled()) {
      return;
    }

    this._stream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (stream, result) => {
        try {
          const [bytes] = stream.read_line_finish_utf8(result);
          // Ignore stale callbacks from a stream that was replaced on restart.
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
      this._writeStream.write_all(new TextEncoder().encode(line + "\n"), null);
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
      this._sleepId = this._loginProxy.connectSignal("PrepareForSleep", (_p, _s, params) => {
        const preparing = Array.isArray(params) && params[0];
        if (!preparing) this._afterSuspend();
      });
    } catch (e) {
      console.warn(`[${this.metadata.name}] No logind listener available: ${e.message}`);
    }
  }

  _afterSuspend() {
    // Re-detect GPUs/sensors that the kernel may have re-enumerated on wake.
    if (this._disabling) return;
    this._sendCommand("RESET");
  }

  // ----------------------------- Preferences -----------------------------

  _openPreferences() {
    try {
      import("resource:///org/gnome/shell/misc/extensionUtils.js")
        .then(({ openPrefs }) => openPrefs(this.uuid))
        .catch((e) => console.error(`[${this.metadata.name}] openPrefs failed: ${e.message}`));
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
        "System monitor powered by a native Rust telemetry daemon" +
        (settings ? "" : " (schema not found — running defaults)"),
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
      if (settings) settings.bind(key, sw, "active", Gio.SettingsBindFlags.DEFAULT);
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
      if (settings) settings.bind(key, spin, "value", Gio.SettingsBindFlags.DEFAULT);
      row.append(label);
      row.append(spin);
      box.append(row);
    };

    const group = new Gtk.Label({
      label: "Behavior",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 8,
    });
    group.add_css_class("heading");
    box.append(group);

    addSpinRow("Poll interval (ms)", "poll-interval", 200, 10000, 100);
    addSwitchRow("Animate popover", "animate-popover");
    addSwitchRow("Pause telemetry while locked", "pause-away");
    addSwitchRow("Compact mode (status dot)", "compact-mode");
    addSwitchRow("Monochrome palette", "mono-palette");

    const metricsGroup = new Gtk.Label({
      label: "Visible metrics",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 12,
    });
    metricsGroup.add_css_class("heading");
    box.append(metricsGroup);

    addSwitchRow("CPU (panel + card)", "show-cpu");
    addSwitchRow("RAM (panel + card)", "show-ram");
    addSwitchRow("Cooling fans (panel + card)", "show-fan");
    addSwitchRow("Battery (panel + card)", "show-battery");
    addSwitchRow("CPU temperature (in CPU row)", "show-cpu-temp");
    addSwitchRow("History overview (card)", "show-history");
    addSwitchRow("GPU (card)", "show-gpu");
    addSwitchRow("Network (card)", "show-network");
    addSwitchRow("Disk I/O (card)", "show-disk");
    addSwitchRow("Top processes (card)", "show-processes");

    const alertsGroup = new Gtk.Label({
      label: "Alerts",
      halign: Gtk.Align.START,
      xalign: 0,
      margin_top: 12,
    });
    alertsGroup.add_css_class("heading");
    box.append(alertsGroup);

    addSwitchRow("Alert on sustained high load", "notify-load");
    addSpinRow("CPU alert threshold (%)", "cpu-alert", 20, 100, 1);
    addSpinRow("GPU util alert threshold (%)", "gpu-alert", 20, 100, 1);
    addSpinRow("Temperature alert (°C, CPU/GPU)", "temp-alert", 30, 120, 1);

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

    this._cpuGauge = null;
    this._ramGauge = null;
    this._fanGauge = null;
    this._batGauge = null;
    this._cpuSpark = null;
    this._gpuSpark = null;
    this._historySpark = null;
    this._netRxSpark = null;
    this._netTxSpark = null;
    this._diskReadSpark = null;
    this._diskWriteSpark = null;
    this._coreBars = [];
    this._fanRows = [];
    this._procRows = [];
    this._cpuHistory = [];
    this._pauseSwitch = null;
    this._compactSwitch = null;
  }
}