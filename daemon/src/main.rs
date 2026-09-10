mod cpu;
mod fan;
mod gpu;
mod mem;

use std::env;
use std::io::{self, Write};
use std::thread;
use std::time::{Duration, Instant};

use fan::{FanCollector, FanMetric};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TelemetryData {
    pub cpu: f32,
    pub ram: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub fan_pct: u32,
    pub fan_rpm: u32,
    pub fans: Vec<FanMetric>,
    pub gpu_util: Option<u32>,
    pub gpu_temp: Option<u32>,
}

fn print_help() {
    println!("sparkline-daemon - Ultra-low-overhead telemetry engine for Codenotch GNOME monitor");
    println!();
    println!("USAGE:");
    println!("    sparkline-daemon [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("    -i, --interval-ms <MS>    Poll interval in milliseconds (default: 1200)");
    println!("    -m, --mock               Emit mock data for testing UI without real hardware");
    println!("    -1, --once               Print one sample and exit immediately");
    println!("    -h, --help               Print this help message");
}

fn main() {
    let args: Vec<String> = env::args().collect();

    let mut interval_ms: u64 = 1200;
    let mut mock_mode = false;
    let mut once_mode = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-i" | "--interval-ms" => {
                if i + 1 < args.len() {
                    if let Ok(val) = args[i + 1].parse::<u64>() {
                        interval_ms = val.max(200);
                    }
                    i += 1;
                }
            }
            "-m" | "--mock" => {
                mock_mode = true;
            }
            "-1" | "--once" => {
                once_mode = true;
            }
            "-h" | "--help" => {
                print_help();
                return;
            }
            _ => {}
        }
        i += 1;
    }

    if mock_mode {
        run_mock(interval_ms, once_mode);
        return;
    }

    let mut cpu_collector = cpu::CpuCollector::new();
    let mem_collector = mem::MemCollector::new();
    let mut gpu_collector = gpu::GpuCollector::new();
    let mut fan_collector = FanCollector::new();

    let interval = Duration::from_millis(interval_ms);
    let mut tick_counter: u64 = 0;
    let mut last_gpu: (Option<u32>, Option<u32>, Option<u32>) = (None, None, None);

    loop {
        let loop_start = Instant::now();

        let cpu = cpu_collector.sample();
        let (ram_pct, ram_used_gb, ram_total_gb) = mem_collector.sample();

        // GPU polling: sample every other tick or >= 2000ms to preserve battery P-states
        if tick_counter % 2 == 0 || interval_ms >= 2000 {
            last_gpu = gpu_collector.sample();
        }

        let (fan_pct, fan_rpm, fans) = fan_collector.sample(last_gpu.2);

        let telemetry = TelemetryData {
            cpu: (cpu * 10.0).round() / 10.0,
            ram: (ram_pct * 10.0).round() / 10.0,
            ram_used_gb,
            ram_total_gb,
            fan_pct,
            fan_rpm,
            fans,
            gpu_util: last_gpu.0,
            gpu_temp: last_gpu.1,
        };

        if let Ok(json) = serde_json::to_string(&telemetry) {
            println!("{}", json);
            let _ = io::stdout().flush();
        }

        if once_mode {
            break;
        }

        tick_counter = tick_counter.wrapping_add(1);

        let elapsed = loop_start.elapsed();
        if elapsed < interval {
            thread::sleep(interval - elapsed);
        }
    }
}

fn run_mock(interval_ms: u64, once_mode: bool) {
    let mut t: f32 = 0.0;
    let interval = Duration::from_millis(interval_ms);

    loop {
        let cpu = 28.0 + 22.0 * (t * 0.3).sin() + 14.0 * (t * 0.7).cos();
        let ram = 46.0 + 8.0 * (t * 0.1).sin();
        let ram_total = 16.0;
        let ram_used = (ram_total * (ram / 100.0) * 10.0).round() / 10.0;

        let fan_pct = (38.0 + 28.0 * (t * 0.22).sin()).clamp(15.0, 95.0) as u32;
        let fan_rpm = 1800 + (fan_pct as f32 * 32.0) as u32;

        let gpu_util = (25.0 + 20.0 * (t * 0.25).sin()) as u32;
        let gpu_temp = (48.0 + 9.0 * (t * 0.15).sin()) as u32;

        let fans = vec![
            FanMetric {
                label: "CPU Fan".to_string(),
                rpm: fan_rpm,
                pct: fan_pct,
            },
            FanMetric {
                label: "Chassis / GPU Fan".to_string(),
                rpm: fan_rpm.saturating_sub(250),
                pct: fan_pct.saturating_sub(6),
            },
        ];

        let telemetry = TelemetryData {
            cpu: (cpu.clamp(5.0, 95.0) * 10.0).round() / 10.0,
            ram: (ram.clamp(10.0, 90.0) * 10.0).round() / 10.0,
            ram_used_gb: ram_used,
            ram_total_gb: ram_total,
            fan_pct,
            fan_rpm,
            fans,
            gpu_util: Some(gpu_util.clamp(0, 100)),
            gpu_temp: Some(gpu_temp.clamp(35, 85)),
        };

        if let Ok(json) = serde_json::to_string(&telemetry) {
            println!("{}", json);
            let _ = io::stdout().flush();
        }

        if once_mode {
            break;
        }

        t += 0.4;
        thread::sleep(interval);
    }
}
