# Codenotch System Monitor (Rust + GNOME Shell Extension)

A high-performance, ultra-low-overhead system monitor extension for GNOME Shell (GNOME 45, 46, and 47) inspired by the iconic **[Codenotch](https://github.com/vinzdg/codenotch)** design. It displays real-time circular ring gauges inside a jet-black top panel capsule for:
- **CPU %** (Microprocessor vector glyph + clockwise progress arc)
- **RAM %** (Memory DIMM vector glyph + clockwise progress arc)
- **Cooling Fans** (Aerodynamic 4-blade propeller glyph with live spinning animation + RPM / speed %)
- *(Optional)* **NVIDIA GPU** telemetry in the popover card

---

## Codenotch Visual Design System

The extension faithfully implements Codenotch's design language:
- **Jet-Black Notch Capsule**: Sits cleanly in the GNOME top bar with smooth rounded pill corners (`#000000` with subtle border highlight).
- **Circular Progress Rings**: A translucent track (`rgba(255, 255, 255, 0.18)`) with a vibrant active arc starting at 12 o'clock and sweeping clockwise.
- **Dynamic Codenotch Palette**:
  - **Ample (<50%)**: Neon Mint Green (`#00FF88`)
  - **Watch (50% - 75%)**: Electric Yellow (`#F2FF00`)
  - **Critical (75% - 90%)**: Blazing Orange (`#FF3F00`)
  - **Exhausted (>90%)**: Crimson Red (`#FF453A`)
- **Animated Fan Propeller**: Rotates dynamically when the cooling fan is running.
- **Codenotch Popover Card**: Dark card (`#000000`) with rounded progress bars, exact color classes, and hardware breakdown (CPU utilization, RAM Used/Total GB, per-fan RPM breakdown).

---

## Project Structure

```
gnome-sparkline-monitor/
├── daemon/                    # Rust native telemetry daemon
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # Main loop, NDJSON serialization, CLI
│       ├── cpu.rs             # /proc/stat delta parser
│       ├── mem.rs             # /proc/meminfo parser (used GB & total GB)
│       ├── fan.rs             # /sys/class/hwmon/ fan speed scanner & NVML fan
│       └── gpu.rs             # Direct NVML wrapper with retry logic
├── extension/                 # GNOME Shell ESM extension (GNOME 45+)
│   ├── metadata.json
│   ├── extension.js           # Subprocess management, Codenotch capsule & card
│   ├── ring_gauge.js          # Cairo circular ring gauge & vector glyphs
│   └── stylesheet.css         # Codenotch CSS styling
├── install.sh                 # One-step build & install script
└── README.md
```

---

## How to Test on your Linux Machine

### 1. Test the Rust Daemon Standalone
You can run the daemon directly in your terminal to see the telemetry stream:

```bash
cd daemon
cargo run -- --interval-ms 1000
```
Expected output:
```json
{"cpu":14.2,"ram":42.5,"ram_used_gb":6.8,"ram_total_gb":16.0,"fan_pct":38,"fan_rpm":2150,"fans":[{"label":"CPU Fan","rpm":2150,"pct":39},{"label":"GPU Fan","rpm":1980,"pct":36}],"gpu_util":5,"gpu_temp":48}
```

To test with synthetic/mock data without needing specific hardware:
```bash
cargo run -- --mock
```

### 2. Install into GNOME Shell
Run the installation script:
```bash
chmod +x install.sh
./install.sh
```

### 3. Activate the Extension
- **On Wayland**: Log out and log back in (or test in a nested window with `dbus-run-session -- gnome-shell --nested --wayland`).
- **On X11**: Press `Alt + F2`, type `r`, and hit `Enter`.

Enable the extension:
```bash
gnome-extensions enable sparkline-monitor@local
```

### 4. Live Debugging & Logs
To monitor extension status or debug messages:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i codenotch
```
