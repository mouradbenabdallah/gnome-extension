use std::collections::HashMap;
use std::fs;
use std::time::Instant;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProcMetric {
    pub name: String,
    pub pid: u32,
    pub cpu: f32,
}

/// Samples per-process CPU usage from /proc/<pid>/stat and returns the top-N
/// most CPU-hungry processes, Activity-Monitor style.
pub struct ProcessCollector {
    prev: HashMap<u32, u64>, // pid -> total ticks
    prev_time: Instant,
}

const TICKS_PER_SEC: f64 = 100.0;

impl ProcessCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            prev: HashMap::new(),
            prev_time: Instant::now(),
        };
        // Prime the delta calculation so the first real sample is sane.
        let _ = collector.sample();
        collector
    }

    pub fn sample(&mut self) -> Vec<ProcMetric> {
        let now = Instant::now();
        let dt = now.duration_since(self.prev_time).as_secs_f64().max(0.001);
        self.prev_time = now;
        let total_ticks = dt * TICKS_PER_SEC;

        let mut current: HashMap<u32, (u32, String, u64)> = HashMap::new();

        if let Ok(entries) = fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let dir_name = entry.file_name().to_string_lossy().into_owned();
                let Ok(pid) = dir_name.parse::<u32>() else { continue };
                if let Some((name, ticks)) = read_proc_stat(pid) {
                    current.insert(pid, (pid, name, ticks));
                }
            }
        }

        let mut metrics: Vec<ProcMetric> = Vec::new();
        for (pid, (_, name, ticks)) in current.iter() {
            let prev_ticks = self.prev.get(pid).copied().unwrap_or(0);
            let delta = ticks.saturating_sub(prev_ticks) as f64;
            let cpu = if total_ticks > 0.0 {
                (delta / total_ticks) * 100.0
            } else {
                0.0
            };
            metrics.push(ProcMetric {
                name: name.clone(),
                pid: *pid,
                cpu: ((cpu.clamp(0.0, 800.0) * 10.0).round() / 10.0) as f32,
            });
        }

        metrics.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
        metrics.truncate(3);

        // Keep this sample as the reference for the next one, bounded in size.
        self.prev = current
            .into_iter()
            .map(|(pid, (_, _, ticks))| (pid, ticks))
            .collect();

        metrics
    }
}

/// Returns (process name, total CPU ticks) for a pid, or None on failure.
fn read_proc_stat(pid: u32) -> Option<(String, u64)> {
    let contents = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_proc_stat(&contents)
}

/// Parses the contents of /proc/<pid>/stat, handling the variable-length comm
/// field (which may contain spaces and parentheses).
fn parse_proc_stat(contents: &str) -> Option<(String, u64)> {
    let close = contents.rfind(')')?;
    let name = contents
        .get(contents.find('(')? + 1..close)?
        .to_string();
    let tail: Vec<&str> = contents[close + 1..].split_whitespace().collect();
    if tail.len() < 24 {
        return None;
    }
    // tail[0] = state (field 3), so utime (field 14) is tail[11] and
    // stime (field 15) is tail[12].
    let utime: u64 = tail[11].parse().ok()?;
    let stime: u64 = tail[12].parse().ok()?;
    Some((name, utime + stime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_stat_with_parens_in_comm() {
        let line = "4213 (Chrome Helper (GPU)) S 1 4213 4213 0 -1 1077936384 1234 0 0 0 50 30 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
        let (name, ticks) = parse_proc_stat(line).unwrap();
        assert_eq!(name, "Chrome Helper (GPU)");
        assert_eq!(ticks, 80);
    }

    #[test]
    fn rejects_short_lines() {
        assert!(parse_proc_stat("1 (init) S 0").is_none());
        assert!(parse_proc_stat("").is_none());
    }
}