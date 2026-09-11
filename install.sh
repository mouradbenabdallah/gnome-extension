#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_UUID="sparkline-monitor@local"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"

echo "===================================================="
echo " Building Codenotch Monitor (Rust + GNOME Extension)"
echo "===================================================="

# 1. Check for Rust / Cargo
if ! command -v cargo &> /dev/null; then
    echo "[-] Error: 'cargo' not found in PATH."
    echo "    Please install Rust first: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# 2. Build the Rust daemon
echo "[+] Compiling Rust telemetry daemon in release mode..."
cd "$SCRIPT_DIR/daemon"
cargo build --release
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/daemon/target/release/sparkline-daemon" ]; then
    echo "[-] Error: sparkline-daemon binary was not produced."
    exit 1
fi

echo "[+] Compilation successful."

# 3. Create extension directory
echo "[+] Installing extension to $DEST_DIR..."
mkdir -p "$DEST_DIR/bin"

# 4. Copy files
cp "$SCRIPT_DIR/extension/metadata.json" "$DEST_DIR/"
cp "$SCRIPT_DIR/extension/extension.js" "$DEST_DIR/"
cp "$SCRIPT_DIR/extension/ring_gauge.js" "$DEST_DIR/"
if [ -f "$SCRIPT_DIR/extension/sparkline.js" ]; then
    cp "$SCRIPT_DIR/extension/sparkline.js" "$DEST_DIR/"
fi
cp "$SCRIPT_DIR/extension/stylesheet.css" "$DEST_DIR/"
cp "$SCRIPT_DIR/daemon/target/release/sparkline-daemon" "$DEST_DIR/bin/"
chmod +x "$DEST_DIR/bin/sparkline-daemon"

echo "[+] Installation complete!"
echo ""
echo "----------------------------------------------------"
echo " Next Steps to Test & Activate on your Linux PC:"
echo "----------------------------------------------------"
echo "1. If you are on Wayland: Log out and log back in (or test in a nested session):"
echo "      dbus-run-session -- gnome-shell --nested --wayland"
echo ""
echo "   If you are on X11: Press Alt+F2, type 'r', and press Enter."
echo ""
echo "2. Enable the extension via terminal:"
echo "      gnome-extensions enable $EXT_UUID"
echo ""
echo "3. Verify running logs:"
echo "      journalctl -f -o cat /usr/bin/gnome-shell | grep -i codenotch"
echo "----------------------------------------------------"
