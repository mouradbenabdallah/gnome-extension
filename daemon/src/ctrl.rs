use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

/// Shared, thread-safe control state for the daemon sampling loop.
#[derive(Default)]
pub struct Control {
    pub paused: AtomicBool,
    pub interval_ms: AtomicU64,
    pub reset: AtomicBool,
}

impl Control {
    pub fn set_interval(&self, ms: u64) {
        self.interval_ms.store(ms.max(200), Ordering::Relaxed);
    }

    /// Consumes a one-shot "reinitialize sensors" request.
    pub fn take_reset(&self) -> bool {
        self.reset.swap(false, Ordering::Relaxed)
    }
}

#[derive(Debug, PartialEq)]
pub enum Command {
    Pause,
    Resume,
    Interval(u64),
    Reset,
}

/// A single wire command line sent by a connected client.
pub fn parse_command(line: &str) -> Option<Command> {
    let line = line.trim();
    match line {
        "PAUSE" => Some(Command::Pause),
        "RESUME" => Some(Command::Resume),
        "RESET" => Some(Command::Reset),
        _ => line
            .strip_prefix("INTERVAL ")
            .and_then(|rest| rest.trim().parse::<u64>().ok())
            .map(Command::Interval),
    }
}

/// Owns the set of connected Unix-stream clients a daemon broadcasts to.
#[derive(Clone, Default)]
struct Broadcaster {
    clients: Arc<Mutex<Vec<UnixStream>>>,
}

impl Broadcaster {
    fn add(&self, stream: UnixStream) {
        self.clients.lock().unwrap().push(stream);
    }

    fn emit(&self, line: &str) {
        let mut guard = self.clients.lock().unwrap();
        let mut payload = line.as_bytes().to_vec();
        payload.push(b'\n');
        guard.retain_mut(|stream| stream.write_all(&payload).is_ok() && stream.flush().is_ok());
    }
}

/// Unix-domain socket server. Listens in a background thread, accepts any
/// number of clients, broadcasts NDJSON samples to all of them, and applies
/// control commands received from any client (PAUSE / RESUME / INTERVAL).
pub struct CtrlServer {
    path: String,
    broadcaster: Arc<Broadcaster>,
    control: Arc<Control>,
}

impl CtrlServer {
    pub fn new(path: &str, control: Arc<Control>) -> Self {
        // Remove a stale socket left behind by an unclean exit.
        let _ = std::fs::remove_file(path);
        let listener = UnixListener::bind(path).expect("failed to bind unix socket");
        listener
            .set_nonblocking(true)
            .expect("failed to set listener non-blocking");

        let broadcaster = Arc::new(Broadcaster::default());
        let control_clone = control.clone();
        let broadcaster_clone = broadcaster.clone();

        thread::spawn(move || {
            loop {
                // Poll accept() directly: on a non-blocking listener the
                // `incoming()` iterator never terminates (it yields `Some(Err)`
                // on every WouldBlock), so a `for` loop around it would busy-spin
                // at 100% CPU and the sleep below would never run.
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let peer = match stream.try_clone() {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        broadcaster_clone.add(peer);

                        // Greet the new client so it can validate the protocol.
                        let hello = format!(
                            "{{\"hello\":true,\"interval_ms\":{}}}\n",
                            control_clone.interval_ms.load(Ordering::Relaxed)
                        );
                        if stream.write_all(hello.as_bytes()).is_err() {
                            continue;
                        }
                        if stream.flush().is_err() {
                            continue;
                        }

                        // Drain this client's control commands.
                        let ctrl = control_clone.clone();
                        let bc = broadcaster_clone.clone();
                        let _handle: std::thread::JoinHandle<()> = thread::spawn(move || {
                            let reader = BufReader::new(stream);
                            for line in reader.lines().map_while(Result::ok) {
                                match parse_command(&line) {
                                    Some(Command::Pause) => {
                                        ctrl.paused.store(true, Ordering::Relaxed);
                                        bc.emit("{\"paused\":true}");
                                    }
                                    Some(Command::Resume) => {
                                        ctrl.paused.store(false, Ordering::Relaxed);
                                        bc.emit("{\"paused\":false}");
                                    }
                                    Some(Command::Interval(n)) => {
                                        let n = n.max(200);
                                        ctrl.interval_ms.store(n, Ordering::Relaxed);
                                        bc.emit(&format!("{{\"interval_ms\":{}}}", n));
                                    }
                                    Some(Command::Reset) => {
                                        ctrl.reset.store(true, Ordering::Relaxed);
                                    }
                                    None => {}
                                }
                            }
                        });
                    }
                    Err(_) => {}
                }
                thread::sleep(std::time::Duration::from_millis(50));
            }
        });

        Self {
            path: path.to_string(),
            broadcaster,
            control,
        }
    }

    pub fn paused(&self) -> bool {
        self.control.paused.load(Ordering::Relaxed)
    }

    pub fn interval_ms(&self) -> u64 {
        self.control.interval_ms.load(Ordering::Relaxed)
    }

    pub fn take_reset(&self) -> bool {
        self.control.take_reset()
    }

    pub fn emit(&self, line: &str) {
        self.broadcaster.emit(line);
    }
}

impl Drop for CtrlServer {
    fn drop(&mut self) {
        // Best-effort cleanup of the socket file on normal shutdown.
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commands() {
        assert_eq!(parse_command("PAUSE"), Some(Command::Pause));
        assert_eq!(parse_command("RESUME"), Some(Command::Resume));
        assert_eq!(parse_command("RESET"), Some(Command::Reset));
        assert_eq!(parse_command("INTERVAL 500"), Some(Command::Interval(500)));
        assert_eq!(parse_command("INTERVAL 0"), Some(Command::Interval(0)));
        assert_eq!(parse_command("garbage"), None);
        assert_eq!(parse_command(""), None);
    }

    #[test]
    fn interval_floor_is_200() {
        let c = Control::default();
        c.set_interval(10);
        assert_eq!(c.interval_ms.load(Ordering::Relaxed), 200);
    }
}