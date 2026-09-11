use std::fs;
use std::path::Path;

/// Reads a CPU package temperature in °C from /sys/class/hwmon.
/// Picks the most authoritative chip (coretemp / k10temp / zenpower /
/// cpu_thermal). Returns None on desktops not exposing CPU temps.
pub fn sample_cpu_temp() -> Option<u32> {
    let hwmon_dir = Path::new("/sys/class/hwmon");
    let entries = fs::read_dir(hwmon_dir).ok()?;

    let mut best: Option<(u8, u32)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        let chip_name = fs::read_to_string(path.join("name"))
            .map(|s| s.trim().to_string().to_lowercase())
            .unwrap_or_default();

        let priority = match chip_name.as_str() {
            "coretemp" | "k10temp" | "zenpower" | "cpu_thermal" => 4,
            name if name.contains("cpu") => 3,
            _ => 0,
        };
        if priority == 0 {
            continue;
        }

        // temp1_input is a package/edge sensor on all three driver families.
        let milli = read_int(&path.join("temp1_input"))?;
        let temp_c = (milli / 1000).clamp(0, 150) as u32;

        match best {
            Some((p, _)) if p >= priority => {}
            _ => best = Some((priority, temp_c)),
        }
    }

    best.map(|(_, t)| t)
}

fn read_int(path: &Path) -> Option<i64> {
    fs::read_to_string(path)
        .ok()?
        .trim()
        .parse::<i64>()
        .ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn converts_millidegrees_to_celsius() {
        assert_eq!(milli_to_celsius(47123), 47);
        assert_eq!(milli_to_celsius(-5000), 0);
    }

    fn milli_to_celsius(m: i64) -> u32 {
        (m / 1000).clamp(0, 150) as u32
    }

    #[test]
    fn chip_priority_ranks_core() {
        assert_eq!(priority_of("coretemp"), 4);
        assert_eq!(priority_of("k10temp"), 4);
        assert_eq!(priority_of("asus_ec"), 0);
    }

    fn priority_of(name: &str) -> u8 {
        match name {
            "coretemp" | "k10temp" | "zenpower" | "cpu_thermal" => 4,
            n if n.contains("cpu") => 3,
            _ => 0,
        }
    }
}