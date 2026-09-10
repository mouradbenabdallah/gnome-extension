#[cfg(feature = "nvidia")]
use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
#[cfg(feature = "nvidia")]
use nvml_wrapper::Nvml;

pub struct GpuCollector {
    #[cfg(feature = "nvidia")]
    nvml: Option<Nvml>,
    retry_ticks: u32,
}

impl GpuCollector {
    pub fn new() -> Self {
        #[cfg(feature = "nvidia")]
        {
            let nvml = Nvml::init().ok();
            Self {
                nvml,
                retry_ticks: 0,
            }
        }
        #[cfg(not(feature = "nvidia"))]
        {
            Self {
                retry_ticks: 0,
            }
        }
    }

    #[cfg(feature = "nvidia")]
    pub fn sample(&mut self) -> (Option<u32>, Option<u32>, Option<u32>) {
        // If NVML failed to init previously (e.g. GPU asleep), retry every 20 samples (~24s)
        if self.nvml.is_none() {
            self.retry_ticks += 1;
            if self.retry_ticks >= 20 {
                self.nvml = Nvml::init().ok();
                self.retry_ticks = 0;
            }
        }

        let nvml = match &self.nvml {
            Some(n) => n,
            None => return (None, None, None),
        };

        // Query primary GPU (index 0)
        let device = match nvml.device_by_index(0) {
            Ok(d) => d,
            Err(_) => return (None, None, None),
        };

        let util = device
            .utilization_rates()
            .map(|u| u.gpu)
            .ok();

        let temp = device
            .temperature(TemperatureSensor::Gpu)
            .ok();

        // Query fan speed if supported (laptop dGPUs might not expose independent fan via NVML)
        let fan_speed = device
            .fan_speed(0)
            .ok();

        (util, temp, fan_speed)
    }

    #[cfg(not(feature = "nvidia"))]
    pub fn sample(&mut self) -> (Option<u32>, Option<u32>, Option<u32>) {
        (None, None, None)
    }
}
