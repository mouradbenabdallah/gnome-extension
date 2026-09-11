mod cpu;
mod ctrl;
mod disk;
mod fan;
mod gpu;
mod mem;
mod net;
mod process;
mod thermal;

use std::env;
use std::io::{self, Write};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use ctrl::{Control, CtrlServer};
use fan::{FanCollector, FanMetric};
use process::ProcMetric;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TelemetryData {
    pub cpu: f32,
    pub cpu_cores: Vec<f32>,
    pub top: Vec<ProcMetric>,
    pub ram: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub fan_pct: u32,
    pub fan_rpm: u32,
    pub fans: Vec<FanMetric>,
    pub gpu_util: Option<u32>,
    pub gpu_temp: Option<u32>,
    pub gpu_name: Option<String>,
    pub net_rx_kbs: f32,
    pub net_tx_kbs: f32,
    pub disk_read_kbs: f32,
    pub disk_write_kbs: f32,
    pub cpu_temp: Option<u32>,
}

fn print_help() {
    println!("sparkline-daemon - Ultra-low-overhead telemetry engine for Codenotch GNOME monitor");
    println!();
    println!("USAGE:");
    println!("    sparkline-daemon [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("    -i, --interval-ms <MS>    Poll interval in milliseconds (default: 1200)");
    println!("    -l, --listen <PATH>       Unix socket path to broadcast NDJSON to");
    println!("    -m, --mock               Emit mock data for testing UI without real hardware");
    println!("    -1, --once               Print one sample and exit immediately");
    println!("    -h, --help               Print this help message");
}

fn main() {
    let args: Vec<String> = env::args().collect();

    let mut interval_ms: u64 = 1200;
    let mut mock_mode = false;
    let mut once_mode = false;
    let mut listen_path: Option<String> = None;

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
            "-l" | "--listen" => {
                if i + 1 < args.len() {
                    listen_path = Some(args[i + 1].clone());
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

    let control = Arc::new(Control::default());
    control.set_interval(interval_ms);

    // In socket mode the daemon broadcasts to clients and can be controlled
    // (PAUSE / RESUME / INTERVAL) over the same socket. Otherwise it writes
    // NDJSON to stdout (dev/test mode).
    let server = listen_path.as_ref().map(|path| CtrlServer::new(path, control.clone()));

    let mut cpu_collector = cpu::CpuCollector::new();
    let mem_collector = mem::MemCollector::new();
    let mut gpu_collector = gpu::GpuCollector::new();
    let mut fan_collector = FanCollector::new();
    let mut net_collector = net::NetCollector::new();
    let mut disk_collector = disk::DiskCollector::new();
    let mut process_collector = process::ProcessCollector::new();

    let socket_mode = server.is_some();
    let mut tick_counter: u64 = 0;
    let mut last_gpu: (Option<u32>, Option<u32>, Option<u32>, Option<String>) = (None, None, None, None);

    loop {
        let loop_start = Instant::now();

        // Respect PAUSE from a client; simply idle the loop (deltas stay
        // meaningful because CLOCK_MONOTONIC excludes suspended wall-time).
        if socket_mode {
            if let Some(srv) = &server {
                if srv.paused() {
                    thread::sleep(Duration::from_millis(200));
                    continue;
                }
                interval_ms = srv.interval_ms();
                // One-shot sensor re-initialization (e.g. after suspend or
                // GPU driver reload) from an external "RESET" command.
                if srv.take_reset() {
                    cpu_collector = cpu::CpuCollector::new();
                    gpu_collector = gpu::GpuCollector::new();
                    fan_collector = FanCollector::new();
                    net_collector = net::NetCollector::new();
                    disk_collector = disk::DiskCollector::new();
                    process_collector = process::ProcessCollector::new();
                }
            }
        }

        let (cpu, cpu_cores) = cpu_collector.sample();
        let (ram_pct, ram_used_gb, ram_total_gb) = mem_collector.sample();
        let (net_rx_kbs, net_tx_kbs) = net_collector.sample();
        let (disk_read_kbs, disk_write_kbs) = disk_collector.sample();
        let top = process_collector.sample();
        let cpu_temp = thermal::sample_cpu_temp();

        // GPU polling: sample every other tick or >= 2000ms to preserve battery P-states
        if tick_counter % 2 == 0 || interval_ms >= 2000 {
            last_gpu = gpu_collector.sample();
        }

        let (fan_pct, fan_rpm, fans) = fan_collector.sample(last_gpu.2);

        let telemetry = TelemetryData {
            cpu: (cpu * 10.0).round() / 10.0,
            cpu_cores,
            top,
            ram: (ram_pct * 10.0).round() / 10.0,
            ram_used_gb,
            ram_total_gb,
            fan_pct,
            fan_rpm,
            fans,
            gpu_util: last_gpu.0,
            gpu_temp: last_gpu.1,
            gpu_name: last_gpu.3.clone(),
            net_rx_kbs,
            net_tx_kbs,
            disk_read_kbs,
            disk_write_kbs,
            cpu_temp,
        };

        if let Ok(json) = serde_json::to_string(&telemetry) {
            if socket_mode {
                if let Some(srv) = &server {
                    srv.emit(&json);
                }
            } else {
                println!("{}", json);
                let _ = io::stdout().flush();
            }
        }

        if once_mode {
            break;
        }

        tick_counter = tick_counter.wrapping_add(1);

        let elapsed = loop_start.elapsed();
        let interval = Duration::from_millis(interval_ms);
        if elapsed < interval {
            thread::sleep(interval - elapsed);
        }
    }
}

#[allow(clippy::too_many_lines)]
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

        let cores = (0..12)
            .map(|i| {
                let v = 20.0 + 55.0 * ((t * 0.6 + i as f32 * 0.9).sin().abs());
                (v.clamp(3.0, 98.0) * 10.0).round() / 10.0
            })
            .collect::<Vec<f32>>();

        let top = vec![
            ProcMetric { name: "firefox".to_string(), pid: 4213, cpu: 12.4 },
            ProcMetric { name: "gnome-shell".to_string(), pid: 1892, cpu: 6.1 },
            ProcMetric { name: "cargo".to_string(), pid: 9971, cpu: 3.8 },
        ];

        let telemetry = TelemetryData {
            cpu: (cpu.clamp(5.0, 95.0) * 10.0).round() / 10.0,
            cpu_cores: cores,
            top,
            ram: (ram.clamp(10.0, 90.0) * 10.0).round() / 10.0,
            ram_used_gb: ram_used,
            ram_total_gb: ram_total,
            fan_pct,
            fan_rpm,
            fans,
            gpu_util: Some(gpu_util.clamp(0, 100)),
            gpu_temp: Some(gpu_temp.clamp(35, 85)),
            gpu_name: Some("NVIDIA".to_string()),
            net_rx_kbs: 180.0 + 900.0 * (t * 0.4).sin().abs(),
            net_tx_kbs: 40.0 + 300.0 * (t * 0.7).sin().abs(),
            disk_read_kbs: 200.0 + 2600.0 * (t * 0.5).sin().abs(),
            disk_write_kbs: 80.0 + 900.0 * (t * 0.9).sin().abs(),
            cpu_temp: Some(((52.0 + 8.0 * (t * 0.35).sin()) as u32).clamp(35, 95)),
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