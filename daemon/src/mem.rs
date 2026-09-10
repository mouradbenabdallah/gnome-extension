use std::fs::File;
use std::io::{BufRead, BufReader};

pub struct MemCollector;

impl MemCollector {
    pub fn new() -> Self {
        Self
    }

    pub fn sample(&self) -> (f32, f32, f32) {
        let file = match File::open("/proc/meminfo") {
            Ok(f) => f,
            Err(_) => return (0.0, 0.0, 0.0),
        };

        let reader = BufReader::new(file);
        let mut mem_total_kb: Option<u64> = None;
        let mut mem_avail_kb: Option<u64> = None;
        let mut mem_free_kb: Option<u64> = None;
        let mut buffers_kb: Option<u64> = None;
        let mut cached_kb: Option<u64> = None;

        for line in reader.lines().map_while(Result::ok) {
            if line.starts_with("MemTotal:") {
                mem_total_kb = Self::parse_kb_line(&line);
            } else if line.starts_with("MemAvailable:") {
                mem_avail_kb = Self::parse_kb_line(&line);
            } else if line.starts_with("MemFree:") {
                mem_free_kb = Self::parse_kb_line(&line);
            } else if line.starts_with("Buffers:") {
                buffers_kb = Self::parse_kb_line(&line);
            } else if line.starts_with("Cached:") {
                cached_kb = Self::parse_kb_line(&line);
            }

            // Stop reading early if we already have total and available
            if mem_total_kb.is_some() && mem_avail_kb.is_some() {
                break;
            }
        }

        let total = match mem_total_kb {
            Some(t) if t > 0 => t,
            _ => return (0.0, 0.0, 0.0),
        };

        let available = mem_avail_kb.unwrap_or_else(|| {
            // Fallback for older Linux kernels without MemAvailable
            let free = mem_free_kb.unwrap_or(0);
            let buf = buffers_kb.unwrap_or(0);
            let cache = cached_kb.unwrap_or(0);
            free + buf + cache
        });

        let used = total.saturating_sub(available);
        let pct = ((used as f32 / total as f32) * 100.0).clamp(0.0, 100.0);
        let used_gb = (used as f32 / (1024.0 * 1024.0) * 10.0).round() / 10.0;
        let total_gb = (total as f32 / (1024.0 * 1024.0) * 10.0).round() / 10.0;

        (pct, used_gb, total_gb)
    }

    fn parse_kb_line(line: &str) -> Option<u64> {
        // Line format: "MemTotal:       16301236 kB"
        line.split_whitespace()
            .nth(1)?
            .parse::<u64>()
            .ok()
    }
}
