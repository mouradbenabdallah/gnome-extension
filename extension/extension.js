import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { RingGauge } from "./ring_gauge.js";
import { Sparkline } from "./sparkline.js";

export default class SparklineMonitorExtension extends Extension {
  enable() {
    this._cancellable = new Gio.Cancellable();
    this._proc = null;
    this._stream = null;

    // 1. Create Panel Indicator Button
    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

    // 2. Codenotch Notch Capsule (Jet-black pill layout)
    const notchBox = new St.BoxLayout({
      style_class: "codenotch-notch-box",
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
    });

    // --- CPU Cell ---
    const cpuBox = new St.BoxLayout({
      style_class: "codenotch-metric-cell",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._cpuGauge = new RingGauge({
      type: "cpu",
      size: 28,
      strokeWidth: 2.8,
    });
    this._cpuLabel = new St.Label({
      text: "0%",
      style_class: "codenotch-value-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    cpuBox.add_child(this._cpuGauge);
    cpuBox.add_child(this._cpuLabel);
    notchBox.add_child(cpuBox);

    // --- RAM Cell ---
    const ramBox = new St.BoxLayout({
      style_class: "codenotch-metric-cell",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._ramGauge = new RingGauge({
      type: "ram",
      size: 28,
      strokeWidth: 2.8,
    });
    this._ramLabel = new St.Label({
      text: "0%",
      style_class: "codenotch-value-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    ramBox.add_child(this._ramGauge);
    ramBox.add_child(this._ramLabel);
    notchBox.add_child(ramBox);

    // --- Cooling Fan Cell ---
    const fanBox = new St.BoxLayout({
      style_class: "codenotch-metric-cell",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._fanGauge = new RingGauge({
      type: "fan",
      size: 28,
      strokeWidth: 2.8,
    });
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
    fanBox.add_child(this._fanGauge);
    fanBox.add_child(this._fanLabel);
    fanBox.add_child(this._fanRpmLabel);
    notchBox.add_child(fanBox);

    this._indicator.add_child(notchBox);

    // 3. Build Codenotch Tooltip Card Menu
    this._buildCodenotchCard();

    // 4. Add to GNOME Shell status area
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // 5. Launch Rust Telemetry Daemon
    this._startDaemon();
  }

  _buildCodenotchCard() {
    const menu = this._indicator.menu;
    menu.box.add_style_class_name("codenotch-card-menu");
    menu.actor.add_style_class_name("codenotch-menu-boxpointer");
    menu.connect("open-state-changed", this._onMenuStateChanged.bind(this));

    // Header Title
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
    headerBox.add_child(titleLabel);
    headerBox.add_child(subLabel);
    headerItem.add_child(headerBox);
    menu.addMenuItem(headerItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // --- CPU Detail Section ---
    const cpuItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const cpuContainer = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const cpuRow = new St.BoxLayout({
      style_class: "codenotch-card-row",
      x_expand: true,
    });
    const cpuTitle = new St.Label({
      text: "CPU Utilization",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._cardCpuVal = new St.Label({
      text: "0.0%",
      style_class: "codenotch-card-val",
    });
    cpuRow.add_child(cpuTitle);
    cpuRow.add_child(this._cardCpuVal);

    const cpuTrack = new St.BoxLayout({
      style_class: "codenotch-progress-track",
      x_expand: true,
    });
    this._cardCpuBar = new St.Widget({
      style_class: "codenotch-progress-fill codenotch-fill-ample",
      width: 0,
    });
    cpuTrack.add_child(this._cardCpuBar);

    const cpuSparkWrap = new St.BoxLayout({
      style_class: "codenotch-sparkline-wrap",
      x_expand: true,
    });
    this._cpuSpark = new Sparkline({ color: "#5bc0ff", width: 190, height: 22 });
    cpuSparkWrap.add_child(this._cpuSpark);

    cpuContainer.add_child(cpuRow);
    cpuContainer.add_child(cpuTrack);
    cpuContainer.add_child(cpuSparkWrap);
    cpuItem.add_child(cpuContainer);
    menu.addMenuItem(cpuItem);

    // --- RAM Detail Section ---
    const ramItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const ramContainer = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const ramRow = new St.BoxLayout({
      style_class: "codenotch-card-row",
      x_expand: true,
    });
    const ramTitle = new St.Label({
      text: "RAM Memory",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._cardRamVal = new St.Label({
      text: "0.0 / 0.0 GB (0%)",
      style_class: "codenotch-card-val",
    });
    ramRow.add_child(ramTitle);
    ramRow.add_child(this._cardRamVal);

    const ramTrack = new St.BoxLayout({
      style_class: "codenotch-progress-track",
      x_expand: true,
    });
    this._cardRamBar = new St.Widget({
      style_class: "codenotch-progress-fill codenotch-fill-ample",
      width: 0,
    });
    ramTrack.add_child(this._cardRamBar);

    ramContainer.add_child(ramRow);
    ramContainer.add_child(ramTrack);
    ramItem.add_child(ramContainer);
    menu.addMenuItem(ramItem);

    // --- Fan Detail Section ---
    const fanItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const fanContainer = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const fanRow = new St.BoxLayout({
      style_class: "codenotch-card-row",
      x_expand: true,
    });
    const fanTitle = new St.Label({
      text: "Cooling Fans",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._cardFanVal = new St.Label({
      text: "0 RPM (0%)",
      style_class: "codenotch-card-val",
    });
    fanRow.add_child(fanTitle);
    fanRow.add_child(this._cardFanVal);

    const fanTrack = new St.BoxLayout({
      style_class: "codenotch-progress-track",
      x_expand: true,
    });
    this._cardFanBar = new St.Widget({
      style_class: "codenotch-progress-fill codenotch-fill-ample",
      width: 0,
    });
    fanTrack.add_child(this._cardFanBar);

    this._cardFanSubList = new St.BoxLayout({ vertical: true });
    this._cardFanSubList.add_style_class_name("codenotch-fansublist");

    fanContainer.add_child(fanRow);
    fanContainer.add_child(fanTrack);
    fanContainer.add_child(this._cardFanSubList);
    fanItem.add_child(fanContainer);
    menu.addMenuItem(fanItem);

    // --- GPU Detail Section ---
    const gpuItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });
    const gpuContainer = new St.BoxLayout({
      vertical: true,
      style_class: "codenotch-card-section",
      x_expand: true,
    });
    const gpuRow = new St.BoxLayout({
      style_class: "codenotch-card-row",
      x_expand: true,
    });
    const gpuTitle = new St.Label({
      text: "NVIDIA GPU",
      style_class: "codenotch-card-label",
      x_expand: true,
    });
    this._cardGpuVal = new St.Label({
      text: "Detecting…",
      style_class: "codenotch-card-val",
    });
    gpuRow.add_child(gpuTitle);
    gpuRow.add_child(this._cardGpuVal);

    const gpuTrack = new St.BoxLayout({
      style_class: "codenotch-progress-track",
      x_expand: true,
    });
    this._cardGpuBar = new St.Widget({
      style_class: "codenotch-progress-fill codenotch-fill-ample",
      width: 0,
    });
    gpuTrack.add_child(this._cardGpuBar);

    const gpuSparkWrap = new St.BoxLayout({
      style_class: "codenotch-sparkline-wrap",
      x_expand: true,
    });
    this._gpuSpark = new Sparkline({ color: "#00ff88", width: 190, height: 22 });
    gpuSparkWrap.add_child(this._gpuSpark);

    gpuContainer.add_child(gpuRow);
    gpuContainer.add_child(gpuTrack);
    gpuContainer.add_child(gpuSparkWrap);
    gpuItem.add_child(gpuContainer);
    menu.addMenuItem(gpuItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Restart Telemetry Daemon action
    const restartItem = new PopupMenu.PopupMenuItem("Restart Telemetry Daemon");
    restartItem.connect("activate", () => {
      this._restartDaemon();
    });
    menu.addMenuItem(restartItem);
  }

  _onMenuStateChanged(menu, open) {
    const content = menu.box;

    if (open) {
      // Re-trigger: kill any in-flight fade/shrink from a previous close.
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

  _updateProgressBar(widget, fraction) {
    const totalW = 190; // Approx card width in pixels
    const fillW = Math.max(0, Math.min(totalW, Math.round(fraction * totalW)));
    widget.width = fillW;

    // Apply Codenotch color class
    widget.remove_style_class_name("codenotch-fill-ample");
    widget.remove_style_class_name("codenotch-fill-watch");
    widget.remove_style_class_name("codenotch-fill-critical");
    widget.remove_style_class_name("codenotch-fill-exhausted");

    if (fraction < 0.5) {
      widget.add_style_class_name("codenotch-fill-ample");
    } else if (fraction < 0.75) {
      widget.add_style_class_name("codenotch-fill-watch");
    } else if (fraction < 0.9) {
      widget.add_style_class_name("codenotch-fill-critical");
    } else {
      widget.add_style_class_name("codenotch-fill-exhausted");
    }
  }

  _findDaemonPath() {
    const candidates = [
      GLib.build_filenamev([this.path, "bin", "sparkline-daemon"]),
      GLib.build_filenamev([this.path, "sparkline-daemon"]),
      GLib.build_filenamev([
        GLib.get_home_dir(),
        ".local",
        "bin",
        "sparkline-daemon",
      ]),
      GLib.find_program_in_path("sparkline-daemon"),
    ];

    for (const candidate of candidates) {
      if (candidate && GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE)) {
        return candidate;
      }
    }
    return null;
  }

  _startDaemon() {
    const daemonPath = this._findDaemonPath();
    const argv = daemonPath ? [daemonPath, "--interval-ms", "1200"] : null;

    if (!argv) {
      console.warn(
        `[${this.metadata.name}] sparkline-daemon binary not found. Running in mock mode.`,
      );
      this._cardCpuVal.text =
        "Daemon binary missing. Check install instructions.";
      return;
    }

    try {
      this._proc = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
      );

      const stdoutPipe = this._proc.get_stdout_pipe();
      this._stream = new Gio.DataInputStream({
        base_stream: stdoutPipe,
        close_base_stream: true,
      });

      this._readNextLine();
    } catch (err) {
      console.error(
        `[${this.metadata.name}] Failed to spawn daemon: ${err.message}`,
      );
    }
  }

  _readNextLine() {
    if (!this._stream || this._cancellable.is_cancelled()) {
      return;
    }

    this._stream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (stream, result) => {
        try {
          const [bytes] = stream.read_line_finish_utf8(result);
          if (bytes !== null) {
            this._handleTelemetryData(bytes);
            this._readNextLine();
          }
        } catch (err) {
          if (!this._cancellable.is_cancelled()) {
            console.error(`[${this.metadata.name}] Read error: ${err.message}`);
          }
        }
      },
    );
  }

  _handleTelemetryData(rawJson) {
    try {
      const data = JSON.parse(rawJson);

      // 1. Update CPU
      if (typeof data.cpu === "number") {
        this._cpuGauge.setValue(data.cpu);
        this._cpuLabel.text = `${Math.round(data.cpu)}%`;
        this._cardCpuVal.text = `${data.cpu.toFixed(1)}%`;
        this._updateProgressBar(this._cardCpuBar, data.cpu / 100.0);
        if (this._cpuSpark) this._cpuSpark.pushValue(data.cpu);
      }

      // 2. Update RAM
      if (typeof data.ram === "number") {
        this._ramGauge.setValue(data.ram);
        this._ramLabel.text = `${Math.round(data.ram)}%`;

        const usedGb =
          data.ram_used_gb !== undefined
            ? `${data.ram_used_gb.toFixed(1)}`
            : "?";
        const totalGb =
          data.ram_total_gb !== undefined
            ? `${data.ram_total_gb.toFixed(1)}`
            : "?";
        this._cardRamVal.text = `${usedGb} / ${totalGb} GB (${data.ram.toFixed(1)}%)`;
        this._updateProgressBar(this._cardRamBar, data.ram / 100.0);
      }

      // 3. Update Fans
      const fanPct = typeof data.fan_pct === "number" ? data.fan_pct : 0;
      const fanRpm = typeof data.fan_rpm === "number" ? data.fan_rpm : 0;
      this._fanGauge.setValue(fanPct);
      this._fanLabel.text = `${fanPct}%`;

      if (fanRpm > 0) {
        this._fanRpmLabel.text = `${fanRpm} RPM`;
        this._cardFanVal.text = `${fanRpm} RPM (${fanPct}%)`;
      } else {
        this._fanRpmLabel.text = fanPct > 0 ? "" : "Idle";
        this._cardFanVal.text = fanPct > 0 ? `${fanPct}%` : "Idle / Stopped";
      }
      this._updateProgressBar(this._cardFanBar, fanPct / 100.0);

      // Update sublist of fans
      this._cardFanSubList.destroy_all_children();
      if (Array.isArray(data.fans) && data.fans.length > 0) {
        for (const fan of data.fans) {
          const row = new St.BoxLayout({
            style_class: "codenotch-card-row",
            x_expand: true,
          });
          const nameLbl = new St.Label({
            text: fan.label || "Fan",
            style_class: "codenotch-card-subtitle",
            x_expand: true,
          });
          const statLbl = new St.Label({
            text: fan.rpm > 0 ? `${fan.rpm} RPM (${fan.pct}%)` : `${fan.pct}%`,
            style_class: "codenotch-card-subtitle",
          });
          row.add_child(nameLbl);
          row.add_child(statLbl);
          this._cardFanSubList.add_child(row);
        }
      }

      // 4. Update GPU
      if (this._cardGpuBar && this._cardGpuVal && this._gpuSpark) {
        const gpuUtil =
          typeof data.gpu_util === "number" && data.gpu_util !== null
            ? data.gpu_util
            : 0;
        const temp =
          typeof data.gpu_temp === "number" && data.gpu_temp !== null
            ? `${data.gpu_temp}°C`
            : "--°C";
        const actionable = typeof data.gpu_util === "number";
        this._cardGpuVal.text = actionable
          ? `${data.gpu_util}%  ·  ${temp}`
          : `Standby / Sleep  ·  ${temp}`;
        this._updateProgressBar(this._cardGpuBar, gpuUtil / 100.0);
        this._gpuSpark.pushValue(gpuUtil);
      }
    } catch (e) {
      // Ignore malformed chunks
    }
  }

  _restartDaemon() {
    if (this._proc) {
      try {
        this._proc.force_exit();
      } catch (_) {}
      this._proc = null;
    }
    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }
    this._startDaemon();
  }

  disable() {
    if (this._cancellable) {
      this._cancellable.cancel();
      this._cancellable = null;
    }

    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }

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
  }
}
