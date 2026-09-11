use std::fs;
use std::time::Instant;

/// Reads cumulative receive/transmit byte counters from /proc/net/dev and
/// reports the rate in KB/s between consecutive samples.
pub struct NetCollector {
    prev_rx: u64,
    prev_tx: u64,
    prev_time: Instant,
}

impl NetCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            prev_rx: 0,
            prev_tx: 0,
            prev_time: Instant::now(),
        };
        // Prime the delta calculation.
        let _ = collector.sample();
        collector
    }

    pub fn sample(&mut self) -> (f32, f32) {
        let now = Instant::now();
        let dt = now.duration_since(self.prev_time).as_secs_f32().max(0.001);
        self.prev_time = now;

        let (rx, tx) = fs::read_to_string("/proc/net/dev")
            .map(|content| parse_netdev(&content))
            .unwrap_or((0, 0));

        (delta_rate(rx, &mut self.prev_rx, dt), delta_rate(tx, &mut self.prev_tx, dt))
    }
}

/// Parses /proc/net/dev into total (receive bytes, transmit bytes), skipping
/// the header and loopback interface.
fn parse_netdev(content: &str) -> (u64, u64) {
    let (mut rx, mut tx) = (0u64, 0u64);
    for line in content.lines() {
        if !line.contains(':') || line.starts_with("Inter-") || line.starts_with(" face") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("");
        if name.starts_with("lo:") {
            continue;
        }
        let fields: Vec<u64> = parts.filter_map(|s| s.parse::<u64>().ok()).collect();
        if fields.len() > 8 {
            rx += fields[0];
            tx += fields[8];
        }
    }
    (rx, tx)
}

fn delta_rate(cur: u64, prev: &mut u64, dt: f32) -> f32 {
    let delta = cur.saturating_sub(*prev) as f32;
    *prev = cur;
    let kbs = delta / 1024.0 / dt;
    kbs.clamp(0.0, 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_interfaces_excluding_loopback() {
        let sample = concat!(
            "Inter-|   Receive                                                |  Transmit\n",
            " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n",
            "    lo:  100000  1000   0    0    0     0          0         0   100000  1000    0    0    0     0       0          0\n",
            "  eth0: 2048    10     0    0    0     0          0         0    512     5      0    0    0     0       0          0\n",
            " wlan0: 10000   20     0    0    0     0          0         0    8000    10     0    0    0     0       0          0\n",
        );
        let (rx, tx) = parse_netdev(sample);
        assert_eq!(rx, 2048 + 10000);
        assert_eq!(tx, 512 + 8000);
    }

    #[test]
    fn handles_empty_and_header_only() {
        assert_eq!(parse_netdev(""), (0, 0));
        assert_eq!(parse_netdev("Inter-| face\n"), (0, 0));
    }
}