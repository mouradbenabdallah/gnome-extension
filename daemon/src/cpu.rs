use std::fs::File;
use std::io::{BufRead, BufReader};

pub struct CpuCollector {
    prev_total: u64,
    prev_active: u64,
}

impl CpuCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            prev_total: 0,
            prev_active: 0,
        };
        // Initial sample to prime delta calculations
        let _ = collector.sample();
        collector
    }

    pub fn sample(&mut self) -> f32 {
        let file = match File::open("/proc/stat") {
            Ok(f) => f,
            Err(_) => return self.fallback_sample(),
        };

        let mut reader = BufReader::new(file);
        let mut line = String::new();

        if reader.read_line(&mut line).is_err() {
            return 0.0;
        }

        if !line.starts_with("cpu ") {
            return 0.0;
        }

        let fields: Vec<u64> = line
            .split_whitespace()
            .skip(1) // Skip "cpu" prefix
            .filter_map(|s| s.parse::<u64>().ok())
            .collect();

        if fields.len() < 4 {
            return 0.0;
        }

        // user, nice, system, idle, iowait, irq, softirq, steal
        let user = fields.get(0).copied().unwrap_or(0);
        let nice = fields.get(1).copied().unwrap_or(0);
        let system = fields.get(2).copied().unwrap_or(0);
        let idle = fields.get(3).copied().unwrap_or(0);
        let iowait = fields.get(4).copied().unwrap_or(0);
        let irq = fields.get(5).copied().unwrap_or(0);
        let softirq = fields.get(6).copied().unwrap_or(0);
        let steal = fields.get(7).copied().unwrap_or(0);

        let idle_total = idle + iowait;
        let active_total = user + nice + system + irq + softirq + steal;
        let total = idle_total + active_total;

        let delta_total = total.saturating_sub(self.prev_total);
        let delta_active = active_total.saturating_sub(self.prev_active);

        self.prev_total = total;
        self.prev_active = active_total;

        if delta_total == 0 {
            return 0.0;
        }

        let pct = (delta_active as f32 / delta_total as f32) * 100.0;
        pct.clamp(0.0, 100.0)
    }

    fn fallback_sample(&mut self) -> f32 {
        // Fallback for non-Linux or test environments
        0.0
    }
}
