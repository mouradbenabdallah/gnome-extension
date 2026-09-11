#[cfg(feature = "nvidia")]
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
#[cfg(feature = "nvidia")]
use nvml_wrapper::Nvml;

use std::fs;
use std::path::PathBuf;

/// Which GPU backend we successfully detected on this machine.
enum GpuKind {
    #[allow(dead_code)]
    None,
    #[cfg(feature = "nvidia")]
    Nvidia,
    Amd { card_base: PathBuf },
    Intel { card_base: PathBuf },
}

pub struct GpuCollector {
    #[cfg(feature = "nvidia")]
    nvml: Option<Nvml>,
    kind: GpuKind,
    name: Option<String>,
    retry_ticks: u32,
}

fn read_int(path: &std::path::Path) -> Option<i64> {
    fs::read_to_string(path).ok()?.trim().parse::<i64>().ok()
}

/// Finds the first hwmon temp1_input under a DRM card's device for temp sensing.
fn find_temp(card_base: &std::path::Path) -> Option<u32> {
    let hwmon_dir = card_base.join("device").join("hwmon");
    for entry in fs::read_dir(&hwmon_dir).ok()?.flatten() {
        let temp_path = entry.path().join("temp1_input");
        if let Some(milli_c) = read_int(&temp_path) {
            return Some((milli_c / 1000).clamp(0, 150) as u32);
        }
    }
    None
}

/// Scans /sys/class/drm for an amdgpu or i915 device and returns which
/// non-NVIDIA backend is present.
fn detect_sysfs_gpu() -> (GpuKind, Option<String>) {
    let Ok(entries) = fs::read_dir("/sys/class/drm") else {
        return (GpuKind::None, None);
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("card") {
            continue;
        }
        if !name[4..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        let card_base = entry.path();
        let driver_path = card_base.join("device").join("driver");
        let Ok(link) = fs::read_link(&driver_path) else { continue };
        let Some(basename) = link.file_name().map(|s| s.to_string_lossy().into_owned()) else {
            continue;
        };

        match basename.as_str() {
            "amdgpu" => return (GpuKind::Amd { card_base }, Some("AMD".to_string())),
            "i915" => return (GpuKind::Intel { card_base }, Some("Intel".to_string())),
            _ => {}
        }
    }

    (GpuKind::None, None)
}

impl GpuCollector {
    pub fn new() -> Self {
        #[cfg(feature = "nvidia")]
        {
            let nvml = Nvml::init().ok();
            if nvml.is_some() {
                return Self {
                    nvml,
                    kind: GpuKind::Nvidia,
                    name: Some("NVIDIA".to_string()),
                    retry_ticks: 0,
                };
            }
            let (kind, name) = detect_sysfs_gpu();
            Self {
                nvml,
                kind,
                name,
                retry_ticks: 0,
            }
        }
        #[cfg(not(feature = "nvidia"))]
        {
            let (kind, name) = detect_sysfs_gpu();
            Self {
                kind,
                name,
                retry_ticks: 0,
            }
        }
    }

    /// Returns (util %, temp °C, fan speed, vendor name).
    pub fn sample(&mut self) -> (Option<u32>, Option<u32>, Option<u32>, Option<String>) {
        #[cfg(feature = "nvidia")]
        {
            if !matches!(self.kind, GpuKind::Nvidia) {
                return self.sample_sysfs();
            }

            // If NVML failed to init previously (GPU asleep / driver reload),
            // retry every 20 samples (~24s at 1.2s interval).
            if self.nvml.is_none() {
                self.retry_ticks += 1;
                if self.retry_ticks >= 20 {
                    self.nvml = Nvml::init().ok();
                    self.retry_ticks = 0;
                }
            }

            let nvml = match &self.nvml {
                Some(n) => n,
                None => return (None, None, None, self.name.clone()),
            };

            let device = match nvml.device_by_index(0) {
                Ok(d) => d,
                Err(_) => return (None, None, None, self.name.clone()),
            };

            let util = device.utilization_rates().map(|u| u.gpu).ok();
            let temp = device.temperature(TemperatureSensor::Gpu).ok();
            let fan_speed = device.fan_speed(0).ok();

            (util, temp, fan_speed, self.name.clone())
        }

        #[cfg(not(feature = "nvidia"))]
        {
            self.sample_sysfs()
        }
    }

    fn sample_sysfs(&mut self) -> (Option<u32>, Option<u32>, Option<u32>, Option<String>) {
        let (util, temp) = match &self.kind {
            GpuKind::None => (None, None),
            GpuKind::Amd { card_base } => (
                read_int(&card_base.join("device").join("gpu_busy_percent")).map(|v| v.clamp(0, 100) as u32),
                find_temp(card_base),
            ),
            GpuKind::Intel { card_base } => {
                // Newer i915 exposes a direct busy percent.
                let direct = read_int(&card_base.join("gt").join("gt0").join("gpu_busy_percent"));
                let util = direct.map(|v| v.clamp(0, 100) as u32).or_else(|| {
                    // Fallback: scale by ratio of current freq vs max freq.
                    let act = read_int(&card_base.join("device").join("gt_act_freq_mhz"));
                    let max = read_int(&card_base.join("device").join("gt_max_freq_mhz"));
                    match (act, max) {
                        (Some(a), Some(m)) if m > 0 => Some(((a as f32 / m as f32) * 100.0).clamp(0.0, 100.0) as u32),
                        _ => None,
                    }
                });
                (util, find_temp(card_base))
            }
            #[cfg(feature = "nvidia")]
            GpuKind::Nvidia => (None, None),
        };

        (util, temp, None, self.name.clone())
    }
}