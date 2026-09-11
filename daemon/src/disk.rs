use std::fs;
use std::time::Instant;

/// Reads cumulative sector counters from /proc/diskstats and reports
/// read/write throughput in KB/s between consecutive samples.
pub struct DiskCollector {
    prev_read: u64,
    prev_write: u64,
    prev_time: Instant,
}

impl DiskCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            prev_read: 0,
            prev_write: 0,
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

        let (read_bytes, write_bytes) = fs::read_to_string("/proc/diskstats")
            .map(|content| parse_diskstats(&content))
            .unwrap_or((0, 0));

        (delta_rate(read_bytes, &mut self.prev_read, dt), delta_rate(write_bytes, &mut self.prev_write, dt))
    }
}

/// Parses /proc/diskstats into total (read bytes, write bytes), skipping
/// partitions and pseudo-devices.
fn parse_diskstats(content: &str) -> (u64, u64) {
    let (mut read_bytes, mut write_bytes) = (0u64, 0u64);
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 10 {
            continue;
        }
        let name = parts[2];
        // Skip partitions (have a numeric suffix) and special devices.
        if is_partition(name) {
            continue;
        }
        if name.contains("ram")
            || name.starts_with("loop")
            || name.starts_with("zram")
            || name.starts_with("sr")
        {
            continue;
        }
        // read sectors = field 6 (0-indexed 5), write sectors = field 10 (0-indexed 9)
        if parts.len() > 9 {
            if let (Ok(r), Ok(w)) = (parts[5].parse::<u64>(), parts[9].parse::<u64>()) {
                read_bytes += r * 512;
                write_bytes += w * 512;
            }
        }
    }
    (read_bytes, write_bytes)
}

/// True for partition names like sda1, nvme0n1p3, or mmcblk0p1.
/// Whole devices (sda, nvme0n1, mmcblk0) return false.
fn is_partition(name: &str) -> bool {
    let core_len = name.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    if core_len == name.len() {
        return false; // no trailing digits
    }
    let core = &name[..core_len];
    if core.ends_with('p') {
        return true; // nvme0n1p3, mmcblk0p1
    }
    // Whole names may legitimately end in digits: nvme0n1 (core ends 'n'),
    // mmcblk0 (core ends 'k'). Legacy drives (sda) always end with a letter.
    !core.ends_with(|c: char| c.is_ascii_digit())
        && !core.ends_with('n')
        && !core.ends_with('k')
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
    fn sums_whole_disks_skipping_partitions() {
        let sample = concat!(
            "   8       0 sda 1000 0 4000 0 0 0 2000 0 0 0 0\n",
            "   8       1 sda1 100 0 400 0 0 0 200 0 0 0 0\n",
            "  11       0 sr0 100 0 400 0 0 0 200 0 0 0 0\n",
            " 252       0 nvme0n1 5000 0 20000 0 0 0 1000 0 0 0 0\n",
            " 252       1 nvme0n1p1 5 0 20000 0 0 0 5 0 0 0 0\n",
        );
        let (read_bytes, write_bytes) = parse_diskstats(sample);
        // Whole devices only: sda + nvme0n1
        assert_eq!(read_bytes, (4000 + 20000) * 512);
        assert_eq!(write_bytes, (2000 + 1000) * 512);
    }

    #[test]
    fn partition_heuristic() {
        assert!(!is_partition("sda"));
        assert!(is_partition("sda1"));
        assert!(!is_partition("nvme0n1"));
        assert!(is_partition("nvme0n1p3"));
        assert!(!is_partition("mmcblk0"));
        assert!(is_partition("mmcblk0p1"));
    }

    #[test]
    fn ignores_garbage_lines() {
        assert_eq!(parse_diskstats(""), (0, 0));
        assert_eq!(parse_diskstats("a b c"), (0, 0));
    }
}