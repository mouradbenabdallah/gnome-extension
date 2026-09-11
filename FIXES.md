# Full Check & Fix Log — Codenotch System Monitor

Date: 2026-09-11
System: GNOME Shell 50.4, GLib 2.88.3, Fedora, Wayland + NVIDIA GTX 1650

## Symptom
Extension showed `State: ACTIVE` but the panel never displayed live data.
Journal spam: `[Codenotch Monitor] Could not reach spawned daemon socket.`
Two `sparkline-daemon` processes each pinned a CPU core (~87%).

## Bug 1 (root cause) — extension could never connect to the daemon
`extension/extension.js` → `_tryConnectSocket()`

Used `sock.connect_unix(path, null)` and
`Gio.SocketConnectionFactory.create_connection(sock)` — both were **removed
from GLib/GJS** (GJS on GLib >= 2.7x / GNOME Shell 50). Every call threw, was
swallowed by `catch`, and returned `null`.

Effect: service-socket connect always failed → spawned a child daemon → that
connect also failed → 40 retries over 2 s → gave up permanently and orphaned
the child daemon. Panel connected to nothing.

Fix: use a `Gio.SocketClient`:

```js
const client = new Gio.SocketClient();
const conn = client.connect(Gio.UnixSocketAddress.new(path), this._cancellable);
```

Verified live against the service socket with a real gjs client:
`hello` arrives, `INTERVAL 200` command is honoured, samples flow.

## Bug 2 (hot +1 core per daemon) — accept loop busy-spin
`daemon/src/ctrl.rs` → `CtrlServer::new()`

```rust
set_nonblocking(true);
loop {
    for stream in listener.incoming().flatten() { ... }
    thread::sleep(50ms);   // dead code
}
```

On a non-blocking listener `incoming().next()` is `Some(Err(WouldBlock))`
forever — the iterator never terminates, so the `for` loop never exits and the
50 ms sleep never runs → tight busy-spin at ~87% CPU per daemon.

Fix: poll `accept()` explicitly and keep the sleep reachable:

```rust
loop {
    match listener.accept() {
        Ok((stream, _)) => { /* greet + spawn reader thread */ }
        Err(_) => {}       // WouldBlock, just poll again
    }
    thread::sleep(Duration::from_millis(50));
}
```

Measured: 85% → 1.4% CPU, all threads sleeping, telemetry still delivered.

## Bug 3 — extension retry logic gave up permanently
`extension/extension.js` → `_retryConnect()`

Old: after 40 x 50 ms it logged the "Could not reach" error and stopped.
New: retries with growing delay (`100 ms -> 2000 ms`, never aborts) and, if the
child socket stays unreachable, falls back to the systemd service socket and
kills the spawned child (`_intentionalExit = true` + `force_exit()` so the
child-exit watcher doesn't schedule a bogus restart).

## Bug 4 (minor) — install.sh kill pattern
`install.sh` used `pkill -x sparkline-daem` but Linux truncates comm to 15
chars (`sparkline-daemo`), so it never matched. Changed to `sparkline-daemo`.

## Deployed
- `daemon/target/release/sparkline-daemon` rebuilt (release, LTO) and copied to
  `~/.local/share/gnome-shell/extensions/sparkline-monitor@local/bin/`.
- `systemctl --user restart codenotch-monitor.service` → running service daemon
  verified at ~1% CPU with telemetry flowing.
- Fixed `extension.js` copied to the installed extension directory.
- `cargo test --release`: 16/16 pass. `node --check` passes on extension JS.

## Remaining action (required)
Session is **Wayland, GNOME 50** — the running shell still holds the old
`extension.js` module in memory (disable/enable does not re-import it).
Must log out and back in to load the fixed JS. After login the new code
connects straight to the systemd service daemon.

Verification after login:

```bash
gnome-extensions info sparkline-monitor@local | grep State   # ACTIVE
systemctl --user status codenotch-monitor.service            # active, ~1% CPU
journalctl -f -o cat /usr/bin/gnome-shell | grep -i codenotch  # no "Could not reach"
```