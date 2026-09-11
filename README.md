# Codenotch System Monitor (Rust + GNOME Shell Extension)

A macOS-style, high-performance system monitor extension for GNOME Shell
(GNOME 45 – 50). A native Rust daemon feeds a jet-black top-panel capsule with
animated circular ring gauges, and a frosted macOS-style popover card with
Activity-Monitor-style live graphs.

Features:

- **CPU %** — microprocessor glyph + clockwise progress arc, smooth eased transitions
- **CPU temperature** — package temp next to the CPU %, with its own alert channel
- **RAM %** — memory DIMM glyph + arc, used/total in GB
- **Cooling Fans** — spinning propeller glyph, RPM / % breakdown (rows are reused, not rebuilt)
- **Per-core CPU grid** — one mini bar per core, colored by load
- **GPU** — NVIDIA (NVML) plus **AMD / Intel** (sysfs) support with util % + temp + history graph
- **Battery** — ring gauge + status on laptops (hidden on desktops)
- **Network** — live download/upload KB·s⁻¹ sparklines
- **Disk I/O** — read/write throughput sparklines
- **Top processes** — top 3 CPU consumers
- **History overview** — ~30 s Activity-Monitor-style CPU graph
- **Compact mode** — collapse the panel to a single status dot colored by the worst metric
- **Load alerts** — OSD notification + in-card banner, with *recovery* notifications when load clears
- **Pause while locked** — telemetry pauses when the screen locks (saves battery/CPU)
- **Suspend-safe** — re-initializes GPU/temp sensors after wake
- **Popover animation** — springy scale/fade open & close
- **Menu** — Pause telemetry, Compact mode, Reinitialize sensors, Settings
- **Preferences** — poll interval, animations, palette, visible metrics & alert thresholds

## Architecture

```
┌──────────────────────────────┐     ┌───────────────────────────────┐
│  GNOME Shell extension (ESM) │◄────► Unix socket (NDJSON + cmds)   │
│  read_line_async on socket   │     │                               │
└──────────────────────────────┘     └─── sparkline-daemon (Rust) ───┘
                                          ▲ runs as systemd user
                                          │ service when enabled
                                          └ /proc, /sys, NVML
```

- When the **systemd user service** (`codenotch-monitor.service`) is running,
  the extension connects to its socket (`%t/codenotch-monitor.service.sock`)
  and monitors it — the daemon survives shell reloads.
- If the service isn't running, the extension **spawns its own child** on
  `codenotch-monitor.child.sock` and auto-respawns it with exponential backoff.
- The wire protocol is NDJSON one-line samples plus control commands sent by
  the client: `PAUSE`, `RESUME`, `INTERVAL <ms>`, `RESET` (re-detect sensors).

## Project Structure

```
gnome-sparkline-monitor/
├── daemon/                    # Rust native telemetry daemon
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # Main loop, JSON serialization, CLI
│       ├── ctrl.rs            # Unix-socket server: broadcast + PAUSE/RESUME/INTERVAL/RESET
│       ├── cpu.rs             # /proc/stat parser (aggregate + per-core)
│       ├── mem.rs             # /proc/meminfo parser
│       ├── fan.rs             # /sys/class/hwmon fan scanner + NVML fan
│       ├── gpu.rs             # NVML (NVIDIA) + sysfs (AMD/Intel) w/ retry
│       ├── net.rs             # /proc/net/dev rx/tx rates
│       ├── disk.rs            # /proc/diskstats read/write rates (NVMe-aware)
│       ├── process.rs         # /proc/<pid>/stat top-N CPU processes
│       ├── bat.rs             # /sys/class/power_supply/BAT* battery state
│       └── thermal.rs         # CPU package temperature via hwmon
├── extension/                 # GNOME Shell ESM extension (GNOME 45+)
│   ├── metadata.json
│   ├── extension.js           # Settings, capsule, popover, socket client
│   ├── ring_gauge.js          # Cairo circular ring gauges + animated fan blades
│   ├── sparkline.js           # Auto-scaling sparkline history graphs
│   ├── schemas/               # GSettings schema for the preferences
│   ├── data/                  # systemd user unit file
│   └── stylesheet.css         # macOS frosted-dark styling
├── install.sh                 # One-step build, schema & service install
└── Makefile                   # build / test / install / dist
```

## How to Test on your Linux Machine

### 1. Test the Rust Daemon Standalone

```bash
cd daemon
cargo run -- --interval-ms 1000          # NDJSON to stdout
cargo test                               # parser + protocol unit tests
```

Socket/control protocol smoke test (real battery/temp data on laptops):

```bash
daemon/target/release/sparkline-daemon --listen /tmp/cm.sock &
python3 - <<'PY'
import socket
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.connect("/tmp/cm.sock")
print(s.makefile("r").readline())          # {"hello":true,...}
s.sendall(b"INTERVAL 200\nPAUSE\nRESUME\nRESET\n")
PY
```

Work without specific hardware (synthetic data): `cargo run -- --mock`

### 2. Install

```bash
chmod +x install.sh
./install.sh
```

The script compiles the GSettings schema, installs the extension, and enables
the `codenotch-monitor.service` systemd *user* service (telemetry starts at
login and survives shell reloads). Stop it with
`systemctl --user disable --now codenotch-monitor.service` — the extension
will fall back to managing its own daemon.

### 3. Activate the Extension

- **On Wayland**: log out and log back in.
- **On X11**: press `Alt + F2`, type `r`, press `Enter`.

```bash
gnome-extensions enable sparkline-monitor@local
```

### 4. Live Debugging & Logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i codenotch
systemctl --user status codenotch-monitor.service
```

### 5. Packaging (extensions.gnome.org-style bundle)

```bash
make dist      # -> build/sparkline-monitor@local.shell-extension.zip
```