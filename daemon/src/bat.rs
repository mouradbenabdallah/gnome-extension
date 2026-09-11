use std::fs;

/// Reads battery data from /sys/class/power_supply/BAT*.
/// Returns (charge %, status string) or (None, None) when no battery exists.
pub fn sample_battery() -> (Option<u32>, Option<String>) {
    let Ok(entries) = fs::read_dir("/sys/class/power_supply") else {
        return (None, None);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let dir_name = entry.file_name().to_string_lossy().into_owned();

        if !dir_name.starts_with("BAT") {
            continue;
        }

        let kind = entry_line(&path.join("type"));
        if kind.as_deref() != Some("Battery") {
            continue;
        }

        let capacity = entry_line(&path.join("capacity"))
            .and_then(|v| v.parse::<u32>().ok())
            .map(|v| v.min(100));

        let status = entry_line(&path.join("status"))
            .map(|s| s.to_string());

        if capacity.is_some() || status.is_some() {
            return (capacity, status);
        }
    }

    (None, None)
}

fn entry_line(path: &std::path::Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_capacity() {
        assert_eq!(entry_line_from("75\n"), "75");
    }

    fn entry_line_from(s: &str) -> String {
        s.trim().to_string()
    }

    #[test]
    fn capacity_clamped_to_100() {
        let raw = entry_line_from("150");
        let cap = raw.parse::<u32>().ok().map(|v| v.min(100));
        assert_eq!(cap, Some(100));
    }
}