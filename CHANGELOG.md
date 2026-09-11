# Changelog

## Version 4 — "All eight" improvement round (2026-09-11)

Implemented all eight requested improvements: battery + CPU temp, pause-while-locked,
popover control menu, alert recovery, suspend safety, 30 s history, a systemd-managed
daemon via a Unix socket, and packaging + tests.

### Daemon (`daemon/`)

- **New `bat.rs`** — reads `/sys/class/power_supply/BAT*` → `bat_pct` (%), `bat_status`
  (Charging / Discharging / Full / Not charging). Returns `None` on desktops.
- **New `thermal.rs`** — CPU package temperature (°C) via hwmon, preferring
  `coretemp` / `k10temp` / `zenpower` / `cpu_thermal` chips → `cpu_temp`.
- **New `ctrl.rs`** — Unix-domain socket server (`--listen PATH`):
  - Broadcasts NDJSON samples to all connected clients (multi-client).
  - Wire protocol with per-line commands: `PAUSE`, `RESUME`, `INTERVAL <ms>`, `RESET`.
    Responses/notifications are broadcast as `{"hello":true,...}`, `{"paused":true|false}`,
    and `{"interval_ms":N}`.
  - Stale-socket cleanup on start and on drop; background accept + client-reader threads.
- **`main.rs`** — added `--listen` flag; `TelemetryData` now includes
  `bat_pct`, `bat_status`, `cpu_temp`; live interval changes honored every tick;
  `PAUSE` skips sampling (deltas stay sane because CLOCK_MONOTONIC excludes suspend time);
  one-shot `RESET` re-initializes CPU/GPU/fan/net/disk/process collectors
  (used after suspend/wake and from the reinit menu item). Mock mode updated.
- **Parser refactor + unit tests** — `parse_netdev`, `parse_diskstats`, `parse_proc_stat`,
  `parse_cpu_line` extracted to testable functions; `cargo test --release` = **16 tests, 0 warnings**.
- **Bug fix** — `/proc/diskstats` partition heuristic was skipping whole NVMe devices
  (`nvme0n1`); now only real partitions (`sda1`, `nvme0n1p3`, `mmcblk0p1`) are excluded.

### Extension (`extension/`)

- **Socket client replaces stdout-pipe** — `_startDaemon()` first adopts any running
  daemon (systemd user service) on `codenotch-monitor.service.sock`, otherwise spawns a
  child on its own `codenotch-monitor.child.sock` (no bind collision) and auto-respawns
  with exponential backoff. `PAUSE`/`RESUME`/`INTERVAL`/`RESET` commands sent over the
  same socket.
- **Battery UI** — new battery ring cell in the panel (new `battery` glyph in
  `ring_gauge.js` with capacity fill) + Battery section in the card; hidden on desktops.
- **CPU temperature** — shown next to CPU % in the card (toggleable) with its own alert
  channel (`cpuTemp`).
- **Pause-while-locked** (`pause-away`, default on) — 2 s watchdog watches
  `Main.sessionMode.isLocked` / `Main.screenShield.locked` and sends `PAUSE`/`RESUME`.
  Menu item "Pause telemetry" adds a manual override.
- **Suspend safety** — logind `PrepareForSleep` listener sends `RESET` on wake so GPUs /
  sensors re-detected after driver reload.
- **Popover control menu** — Pause telemetry (switch), Compact mode (switch),
  Reinitialize sensors (`RESET`), Settings… (`openPrefs`).
- **Alert recovery** — per-metric active-alert set (`cpu`, `gpu`, `cpuTemp`, `gpuTemp`);
  banner recomputed from remaining alerts; recovery OSD (`✓ … recovered`) when load
  clears (>5pt below threshold).
- **30 s history overview** — new "History (last 30 s)" sparkline via
  `Sparkline.setData()`, fed a capped 30-sample CPU buffer.
- **Schema** — new keys: `pause-away`, `show-battery`, `show-cpu-temp`, `show-history`.
- **Preferences** — rows for the new toggles; temp alert label clarified to CPU/GPU.

### Packaging & tooling

- **`extension/data/codenotch-monitor.service`** — systemd *user* unit binding
  `--listen %t/codenotch-monitor.service.sock`, `Restart=on-failure`.
- **`install.sh`** — installs the unit, `daemon-reload`, `enable --now` if not yet
  enabled; kills stale daemons before restart.
- **`Makefile`** — `build`, `test`, `install`, `dist` (EGO-style zip), `clean`.
- **`.gitignore`** — added `/build/`.
- **README.md** — replaced with architecture/features/usage docs (socket protocol,
  service management, smoke-test snippet).
- **`metadata.json`** bumped to **version 4**.

### Verification performed

- `cargo test --release` → 16 passed, 0 failed, 0 warnings.
- Socket protocol smoke test (hello → sample → PAUSE → silence → RESUME → sample →
  INTERVAL) passed against a standalone daemon and against the live systemd service.
- Live samples confirm `bat_pct: 80`, `bat_status: "Not charging"`, `cpu_temp: 94`,
  `gpu_name: "NVIDIA"`.
- `install.sh` completed; service `ActiveState=active`, socket bound at
  `/run/user/1000/codenotch-monitor.service.sock`.
- `make dist` builds `build/sparkline-monitor@local.shell-extension.zip` (7 files incl. schema).

> Note: GNOME Shell (Wayland) requires a log-out/log-in to pick up the new `extension.js`.

## Version 3 — (unreleased tag)

Rebuilt on top of v2: GSettings preferences + per-core CPU grid, network/disk/top-process
sections, compact dot, two-palette rings, daemon respawn backoff, AMD/Intel sysfs GPU
support, `.gitignore`, README.

## Version 2 — (unreleased tag)

First feature round: springy popover animation, eased ring transitions + continuous fan
spin, CPU/GPU sparklines, macOS frosted stylesheet.