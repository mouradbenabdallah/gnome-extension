use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

/// Parser for /proc/stat. Computes both an aggregate CPU usage % and a
/// per-core breakdown (one value per `cpuN` line).
pub struct CpuCollector {
    prev_total: u64,
    prev_active: u64,
    prev_cores: HashMap<usize, (u64, u64)>,
}

#[derive(Default)]
struct CpuLine {
    active: u64,
    idle: u64,
}

fn parse_cpu_line(line: &str) -> Option<(Option<usize>, CpuLine)> {
    let mut parts = line.split_whitespace();
    let key = parts.next()?;
    let (core_index, _aggregate) = if key == "cpu" {
        (None, true)
    } else if let Some(idx) = key.strip_prefix("cpu") {
        (Some(idx.parse::<usize>().ok()?), false)
    } else {
        return None;
    };

    let fields: Vec<u64> = parts
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    if fields.len() < 8 {
        return None;
    }

    // user, nice, system, idle, iowait, irq, softirq, steal
    let user = fields[0];
    let nice = fields[1];
    let system = fields[2];
    let idle = fields[3];
    let iowait = fields[4];
    let irq = fields[5];
    let softirq = fields[6];
    let steal = fields[7];

    let active = user + nice + system + irq + softirq + steal;

    Some((core_index, CpuLine { active, idle: idle + iowait }))
}

impl CpuCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            prev_total: 0,
            prev_active: 0,
            prev_cores: HashMap::new(),
        };
        // Initial sample to prime delta calculations.
        let _ = collector.sample();
        collector
    }

    /// Returns (aggregate %, per-core % vector).
    pub fn sample(&mut self) -> (f32, Vec<f32>) {
        let mut aggregate = CpuLine::default();
        let mut core_totals = HashMap::<usize, (u64, u64)>::new(); // index -> (active, idle)

        if let Ok(file) = File::open("/proc/stat") {
            let reader = BufReader::new(file);
            for line in reader.lines().map_while(Result::ok) {
                if !line.starts_with("cpu") {
                    break;
                }
                if let Some((core_index, data)) = parse_cpu_line(&line) {
                    match core_index {
                        None => {
                            aggregate.active += data.active;
                            aggregate.idle += data.idle;
                        }
                        Some(idx) => {
                            let e = core_totals.entry(idx).or_insert((0, 0));
                            e.0 += data.active;
                            e.1 += data.idle;
                        }
                    }
                }
            }
        }

        // Aggregate %
        let active_agg = Self::delta_pct(aggregate.active, aggregate.idle, &mut self.prev_total, &mut self.prev_active);

        // Per-core %
        let mut core_stats = Vec::with_capacity(core_totals.len());
        for (idx, (active, idle)) in core_totals.iter() {
            let prev = self.prev_cores.get(idx).copied().unwrap_or((0, 0));
            let prev_total = prev.0 + prev.1;
            let delta_total = active + idle - prev_total.min(active + idle);
            let delta_active = active - prev.0.min(*active);
            let pct = if delta_total == 0 {
                0.0
            } else {
                (delta_active as f32 / delta_total as f32) * 100.0
            };
            core_stats.push((*idx, pct.clamp(0.0, 100.0), *active, *idle));
        }
        // Sort by core index so rows/grid labels stay stable in the UI.
        core_stats.sort_by_key(|(idx, _, _, _)| *idx);
        let cores: Vec<f32> = core_stats.iter().map(|(_, pct, _, _)| *pct).collect();
        self.prev_cores = core_stats
            .iter()
            .map(|(idx, _, active, idle)| (*idx, (*active, *idle)))
            .collect();

        (active_agg, cores)
    }

    fn delta_pct(active: u64, idle: u64, prev_total: &mut u64, prev_active: &mut u64) -> f32 {
        let total = active + idle;

        let delta_total = total.saturating_sub(*prev_total);
        let delta_active = active.saturating_sub(*prev_active);

        *prev_total = total;
        *prev_active = active;

        if delta_total == 0 {
            return 0.0;
        }

        ((delta_active as f32 / delta_total as f32) * 100.0).clamp(0.0, 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_aggregate_and_core_lines() {
        let (idx, line) = parse_cpu_line("cpu  100 5 23 400 0 4 9 0").unwrap();
        assert!(idx.is_none());
        assert_eq!(line.active, 100 + 5 + 23 + 4 + 9 + 0);
        assert_eq!(line.idle, 400 + 0);

        let (idx, line) = parse_cpu_line("cpu3 50 0 10 120 0 1 2 0").unwrap();
        assert_eq!(idx, Some(3));
        assert_eq!(line.active, 50 + 0 + 10 + 1 + 2);
        assert_eq!(line.idle, 120);
    }

    #[test]
    fn rejects_non_cpu_lines() {
        assert!(parse_cpu_line("intr 12345").is_none());
        assert!(parse_cpu_line("").is_none());
    }

    #[test]
    fn delta_pct_clamps_and_zeroes() {
        let mut total = 0u64;
        let mut active = 0u64;
        assert_eq!(CpuCollector::delta_pct(100, 100, &mut total, &mut active), 50.0);
        // No movement -> 0%
        assert_eq!(CpuCollector::delta_pct(100, 100, &mut total, &mut active), 0.0);
    }
}