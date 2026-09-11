use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FanMetric {
    pub label: String,
    pub rpm: u32,
    pub pct: u32,
}

pub struct FanCollector {
    hwmon_fans: Vec<HwmonFanEntry>,
    ticks: u64,
}

struct HwmonFanEntry {
    input_path: String,
    label: String,
    max_rpm: u32,
}

impl FanCollector {
    pub fn new() -> Self {
        let mut collector = Self {
            hwmon_fans: Vec::new(),
            ticks: 0,
        };
        collector.discover_fans();
        collector
    }

    fn discover_fans(&mut self) {
        self.hwmon_fans.clear();
        let hwmon_dir = Path::new("/sys/class/hwmon");
        if !hwmon_dir.is_dir() {
            return;
        }

        let entries = match fs::read_dir(hwmon_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let hwmon_path = entry.path();
            if !hwmon_path.is_dir() {
                continue;
            }

            // Read chip/driver name
            let chip_name = fs::read_to_string(hwmon_path.join("name"))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "System".to_string());

            let fan_files = match fs::read_dir(&hwmon_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            for fan_entry in fan_files.flatten() {
                let file_name = fan_entry.file_name();
                let name_str = file_name.to_string_lossy();

                if name_str.starts_with("fan") && name_str.ends_with("_input") {
                    let prefix = &name_str[..name_str.len() - "_input".len()];
                    let idx_str = &prefix["fan".len()..];

                    // Determine label
                    let label_path = hwmon_path.join(format!("{}_label", prefix));
                    let label = fs::read_to_string(&label_path)
                        .map(|s| s.trim().to_string())
                        .unwrap_or_else(|_| {
                            if chip_name.to_lowercase().contains("cpu") {
                                format!("CPU Fan {}", idx_str)
                            } else if chip_name.to_lowercase().contains("gpu") {
                                format!("GPU Fan {}", idx_str)
                            } else {
                                format!("{} Fan {}", chip_name, idx_str)
                            }
                        });

                    // Determine max RPM
                    let max_path = hwmon_path.join(format!("{}_max", prefix));
                    let max_rpm = fs::read_to_string(&max_path)
                        .ok()
                        .and_then(|s| s.trim().parse::<u32>().ok())
                        .filter(|&m| m > 0)
                        .unwrap_or(5500); // 5500 RPM default ceiling for laptops

                    self.hwmon_fans.push(HwmonFanEntry {
                        input_path: fan_entry.path().to_string_lossy().to_string(),
                        label,
                        max_rpm,
                    });
                }
            }
        }

        // Single-fan systems (e.g. laptops) rarely expose a friendly label;
        // default to the CPU fan name so the panel reads "CPU Fan".
        if self.hwmon_fans.len() == 1 {
            self.hwmon_fans[0].label = "CPU Fan".to_string();
        }
    }

    pub fn sample(&mut self, nvml_fan_pct: Option<u32>) -> (u32, u32, Vec<FanMetric>) {
        // Periodically refresh fan discovery every 30 samples (~36 seconds)
        self.ticks = self.ticks.wrapping_add(1);
        if self.ticks % 30 == 0 || self.hwmon_fans.is_empty() {
            self.discover_fans();
        }

        let mut metrics = Vec::new();
        let mut highest_rpm: u32 = 0;
        let mut highest_pct: u32 = 0;

        for fan in &self.hwmon_fans {
            if let Ok(content) = fs::read_to_string(&fan.input_path) {
                if let Ok(rpm) = content.trim().parse::<u32>() {
                    // Some laptops expose phantom fan channels that read 0 RPM
                    // forever (e.g. msi_wmi_platform fan2..fan4). Only count
                    // real, spinning fans so "1 or more fans" detection works.
                    if rpm == 0 {
                        continue;
                    }

                    let pct = ((rpm as f32 / fan.max_rpm as f32) * 100.0).clamp(0.0, 100.0).round() as u32;
                    if rpm > highest_rpm {
                        highest_rpm = rpm;
                    }
                    if pct > highest_pct {
                        highest_pct = pct;
                    }

                    metrics.push(FanMetric {
                        label: fan.label.clone(),
                        rpm,
                        pct,
                    });
                }
            }
        }

        // On single-fan laptops (the common case) use a friendly label instead
        // of the raw hwmon chip name (e.g. "msi_wmi_platform Fan 1").
        if metrics.len() == 1 && !metrics[0].label.to_lowercase().contains("gpu") {
            metrics[0].label = "CPU Fan".to_string();
        }

        // Incorporate NVML GPU fan if available and not already reported in hwmon
        if let Some(gpu_pct) = nvml_fan_pct {
            if gpu_pct > 0 {
                let has_gpu_fan = metrics.iter().any(|m| m.label.to_lowercase().contains("gpu"));
                if !has_gpu_fan {
                    let estimated_rpm = (gpu_pct as f32 * 50.0).round() as u32; // ~5000 RPM max scale
                    if gpu_pct > highest_pct {
                        highest_pct = gpu_pct;
                    }
                    if estimated_rpm > highest_rpm {
                        highest_rpm = estimated_rpm;
                    }
                    metrics.push(FanMetric {
                        label: "GPU Fan".to_string(),
                        rpm: estimated_rpm,
                        pct: gpu_pct,
                    });
                }
            }
        }

        (highest_pct, highest_rpm, metrics)
    }
}
