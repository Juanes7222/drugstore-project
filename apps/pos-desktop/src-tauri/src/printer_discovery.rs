//! Printer discovery, status, and test-print operations.
//!
//! This module wraps the `printers` crate for cross-platform printer enumeration,
//! and provides optional subnet scanning for network printers on standard ports
//! (9100 JetDirect, 631 IPP, 515 LPD).
//!
//! ## Architecture
//!
//! - `discover_printers()` — synchronous first-pass discovery of all printers the
//!   OS knows about. Returns `Vec<DiscoveredPrinter>`.
//! - `scan_network_printers()` — optional, disabled by default. Scans a /24 subnet
//!   for printers on common ports. Returns `Vec<DiscoveredPrinter>`.
//! - `test_print()` — sends a small test page to a specific printer.
//! - `get_printer_status()` — best-effort status check.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::time::Duration;
use tauri::Manager;
use tokio::net::TcpStream;
use tokio::time::timeout;

use printers::common::base::job::PrinterJobOptions;

/// A printer discovered on the system or network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPrinter {
    /// OS-level printer name from the driver (used internally for print calls).
    pub system_name: String,
    /// Human-readable friendly name.
    pub friendly_name: String,
    /// How the printer is connected to the workstation.
    pub connection: String,
    /// Whether this printer is the OS default printer.
    pub is_default: bool,
    /// Detected printer type if known.
    pub printer_type: String,
    /// Whether the printer supports color output.
    pub supports_color: bool,
}

/// Result of a test print operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestPrintResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub paper_out: Option<bool>,
}

/// Printer status returned by the OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterStatusResponse {
    pub status: String,
    pub status_message: Option<String>,
}

/// A discovered network printer candidate (IP-based).
#[derive(Debug, Clone)]
struct NetworkPrinterCandidate {
    ip: String,
    port: u16,
    detected_protocol: String,
}

// ---------------------------------------------------------------------------
// Public API (called from commands/printer_discovery.rs)
// ---------------------------------------------------------------------------

/// Enumerate all printers the OS knows about.
pub fn discover_printers() -> Result<Vec<DiscoveredPrinter>, String> {
    let printers = printers::get_printers();
    let default_printer = printers::get_default_printer();

    let discovered: Vec<DiscoveredPrinter> = printers
        .into_iter()
        .map(|printer| {
            let is_default = default_printer
                .as_ref()
                .map(|d| d.name == printer.name)
                .unwrap_or(false);

            let name = printer.name.clone();
            let system_name = printer.system_name.clone();
            let description = printer.description.clone();
            let location = printer.location.clone();
            let driver_name = printer.driver_name.clone();
            let port_name = printer.port_name.clone();
            let uri = printer.uri.clone();

            let connection = detect_connection_type(&name, &location, &port_name, &uri);
            let printer_type = detect_printer_type(&name, &driver_name);
            let supports_color = detect_color_support(&driver_name, &description);

            let friendly_name = if description.is_empty() {
                name.clone()
            } else {
                description
            };

            DiscoveredPrinter {
                system_name,
                friendly_name,
                connection,
                is_default,
                printer_type,
                supports_color,
            }
        })
        .collect();

    Ok(discovered)
}

/// Scan a subnet for network printers.
///
/// Scans the given /24 subnet (e.g. "192.168.1") for printers on common ports
/// (9100 JetDirect, 631 IPP, 515 LPD). Disabled by default — only runs when
/// the user explicitly enables it in the setup wizard.
pub async fn scan_network_printers(subnet: String) -> Result<Vec<DiscoveredPrinter>, String> {
    let ports: [(u16, &str); 3] = [(9100, "JetDirect"), (631, "IPP"), (515, "LPD")];
    let mut candidates: Vec<NetworkPrinterCandidate> = Vec::new();
    let scan_timeout = Duration::from_millis(300);

    // Scan .1 to .254 on the given subnet
    for host in 1..=254 {
        let ip_str = format!("{}.{}", subnet, host);
        if let Ok(ip) = ip_str.parse::<IpAddr>() {
            for (port, protocol) in &ports {
                let addr = format!("{}:{}", ip, port);
                match timeout(scan_timeout, TcpStream::connect(&addr)).await {
                    Ok(Ok(_)) => {
                        candidates.push(NetworkPrinterCandidate {
                            ip: ip_str.clone(),
                            port: *port,
                            detected_protocol: protocol.to_string(),
                        });
                    }
                    _ => continue,
                }
            }
        }
    }

    // Deduplicate by IP (a printer may respond on multiple ports)
    let mut seen_ips = HashSet::new();
    let mut results: Vec<DiscoveredPrinter> = Vec::new();
    for candidate in candidates {
        if seen_ips.insert(candidate.ip.clone()) {
            let printer_type = match candidate.port {
                9100 => "THERMAL_RECEIPT".to_string(),
                631 => "LASER".to_string(),
                _ => "UNKNOWN".to_string(),
            };

            results.push(DiscoveredPrinter {
                system_name: format!("network:{}:{}", candidate.ip, candidate.port),
                friendly_name: format!("Impresora de red ({})", candidate.detected_protocol),
                connection: "NETWORK".to_string(),
                is_default: false,
                printer_type,
                supports_color: false,
            });
        }
    }

    Ok(results)
}

/// Send a test page to the specified printer.
pub async fn test_print(
    printer_system_name: String,
    payload_type: String,
) -> Result<TestPrintResult, String> {
    match payload_type.as_str() {
        "ESC_POS" => send_escpos_test(&printer_system_name).await,
        _ => send_os_test(&printer_system_name).await,
    }
}

/// Get the current status of a specific printer (best-effort).
pub async fn get_printer_status(
    printer_system_name: String,
) -> Result<PrinterStatusResponse, String> {
    let printer = printers::get_printer_by_name(&printer_system_name);

    match printer {
        Some(p) => {
            let status_str = match p.state {
                printers::common::base::printer::PrinterState::READY => "ONLINE",
                printers::common::base::printer::PrinterState::PRINTING => "ONLINE",
                printers::common::base::printer::PrinterState::PAUSED => "OFFLINE",
                printers::common::base::printer::PrinterState::OFFLINE => "OFFLINE",
                printers::common::base::printer::PrinterState::UNKNOWN => "UNKNOWN",
            };

            Ok(PrinterStatusResponse {
                status: status_str.to_string(),
                status_message: Some(p.state_reasons.join(", ")),
            })
        }
        None => Ok(PrinterStatusResponse {
            status: "UNKNOWN".to_string(),
            status_message: Some("Printer not found in system print spooler".to_string()),
        }),
    }
}

/// Print an existing file to a specific printer.
///
/// Unlike `test_print` which generates its own content, this function
/// accepts an arbitrary file path and sends it to the printer using
/// the OS print subsystem. This is the production path for receipts,
/// invoices, and shift-close reports.
pub async fn print_file(
    printer_system_name: String,
    file_path: String,
) -> Result<TestPrintResult, String> {
    // Verify the file exists
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Ok(TestPrintResult {
            success: false,
            error_message: Some(format!("File not found: {}", file_path)),
            paper_out: None,
        });
    }

    // Find the printer
    let printer = printers::get_printer_by_name(&printer_system_name)
        .ok_or_else(|| format!("Printer '{}' not found", printer_system_name))?;

    // Send the file to the printer
    let result = printer.print_file(&file_path, PrinterJobOptions::none());

    match result {
        Ok(_job_id) => Ok(TestPrintResult {
            success: true,
            error_message: None,
            paper_out: None,
        }),
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let paper_out =
                err_msg.to_lowercase().contains("paper") || err_msg.to_lowercase().contains("out of");
            Ok(TestPrintResult {
                success: false,
                error_message: Some(err_msg),
                paper_out: Some(paper_out),
            })
        }
    }
}

/// Write content to a temp file in the app's print-queue directory.
///
/// Creates the `print-queue/` subdirectory inside `app_local_data_dir`
/// if it doesn't exist, writes the content, and returns the absolute
/// file path that can be passed to `print_file` or tracked in the
/// print queue.
///
/// This avoids the need for the `@tauri-apps/plugin-fs` JS package;
/// all filesystem work stays in Rust.
pub fn write_temp_file(
    app: &tauri::AppHandle,
    filename: &str,
    content: &str,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let print_dir = data_dir.join("print-queue");
    std::fs::create_dir_all(&print_dir)
        .map_err(|e| format!("Failed to create print-queue dir: {}", e))?;

    let file_path = print_dir.join(filename);
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Check whether a file exists at the given path.
pub fn file_exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Detect the printer connection type from heuristic features.
fn detect_connection_type(
    name: &str,
    location: &str,
    port_name: &str,
    uri: &str,
) -> String {
    let combined = format!("{} {} {} {}", name, location, port_name, uri).to_lowercase();

    if combined.contains("usb") || port_name.to_lowercase().starts_with("usb") {
        "USB".to_string()
    } else if combined.contains("bluetooth") || combined.contains("bt") {
        "BLUETOOTH".to_string()
    } else if combined.contains("network")
        || combined.contains("tcp/ip")
        || combined.contains("jetdirect")
        || combined.contains("lan")
        || combined.contains("ether")
        || combined.contains("wlan")
        || combined.contains("wifi")
        || uri.contains("://")
    {
        "NETWORK".to_string()
    } else if port_name.to_lowercase().starts_with("lpt")
        || port_name.to_lowercase().starts_with("com")
        || combined.contains("serial")
        || combined.contains("parallel")
    {
        "USB".to_string()
    } else {
        "SYSTEM_DEFAULT".to_string()
    }
}

/// Detect the printer type from name and driver information.
fn detect_printer_type(name: &str, driver_name: &str) -> String {
    let combined = format!("{} {}", name, driver_name).to_lowercase();

    if combined.contains("pos")
        || combined.contains("receipt")
        || combined.contains("thermal")
        || combined.contains("tm-")
        || combined.contains("epson t")
        || combined.contains("star tsp")
        || combined.contains("bematech")
        || combined.contains("daruma")
    {
        "THERMAL_RECEIPT".to_string()
    } else if combined.contains("label")
        || combined.contains("zebra")
        || combined.contains("godex")
        || combined.contains("citizen")
        || combined.contains("toshiba tec")
    {
        "THERMAL_LABEL".to_string()
    } else if combined.contains("laser")
        || combined.contains("laserjet")
        || combined.contains("lj")
        || combined.contains("laser jet")
        || combined.contains("pagewide")
        || combined.contains("mfp")
    {
        "LASER".to_string()
    } else if combined.contains("inkjet")
        || combined.contains("ink jet")
        || combined.contains("deskjet")
        || combined.contains("officejet")
        || combined.contains("photosmart")
        || combined.contains("stylus")
    {
        "INKJET".to_string()
    } else if combined.contains("multifunction")
        || combined.contains("all-in-one")
        || combined.contains("aio")
    {
        "MULTIFUNCTION".to_string()
    } else {
        "UNKNOWN".to_string()
    }
}

/// Best-effort detection of color support from model/name.
fn detect_color_support(driver_name: &str, description: &str) -> bool {
    let combined = format!("{} {}", driver_name, description).to_lowercase();
    if combined.contains("color")
        || combined.contains("colour")
        || combined.contains("inkjet")
        || combined.contains("deskjet")
        || combined.contains("officejet")
        || combined.contains("photosmart")
        || combined.contains("stylus")
        || combined.contains("pagewide")
    {
        if combined.contains("mono") || combined.contains("b&w") || combined.contains("black only")
        {
            return false;
        }
        true
    } else {
        false
    }
}

/// Send a test page using ESC/POS (for thermal receipt printers).
fn send_escpos_test_sync(printer_name: &str) -> Result<(), String> {
    use escpos::driver::FileDriver;
    use escpos::printer::Printer;
    use escpos::utils::*;

    let driver = FileDriver::open(std::path::Path::new(printer_name))
        .map_err(|e| format!("Failed to create printer driver: {}", e))?;

    let mut printer = Printer::new(driver, Protocol::default(), None);

    printer
        .init()
        .map_err(|e| format!("Init error: {}", e))?
        .writeln("=== PRUEBA DE IMPRESIÓN ===")
        .map_err(|e| format!("Write error: {}", e))?
        .writeln(&format!("Impresora: {}", printer_name))
        .map_err(|e| format!("Write error: {}", e))?
        .writeln(&format!(
            "Fecha: {}",
            chrono::Local::now().format("%d/%m/%Y %H:%M")
        ))
        .map_err(|e| format!("Write error: {}", e))?
        .feed()
        .map_err(|e| format!("Feed error: {}", e))?
        .writeln("Si lee este texto,")
        .map_err(|e| format!("Write error: {}", e))?
        .writeln("la impresora funciona correctamente.")
        .map_err(|e| format!("Write error: {}", e))?
        .feed()
        .map_err(|e| format!("Feed error: {}", e))?
        .writeln("Ayuda: https://ayuda.farmacia.local/impresoras")
        .map_err(|e| format!("Write error: {}", e))?
        .feed()
        .map_err(|e| format!("Feed error: {}", e))?;

    printer
        .print_cut()
        .map_err(|e| format!("Cut/Print error: {}", e))?;

    Ok(())
}

async fn send_escpos_test(printer_name: &str) -> Result<TestPrintResult, String> {
    let name = printer_name.to_string();
    let result = tokio::task::spawn_blocking(move || send_escpos_test_sync(&name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(()) => Ok(TestPrintResult {
            success: true,
            error_message: None,
            paper_out: None,
        }),
        Err(e) => {
            let paper_out = e.to_lowercase().contains("paper")
                || e.to_lowercase().contains("out of");
            Ok(TestPrintResult {
                success: false,
                error_message: Some(e),
                paper_out: Some(paper_out),
            })
        }
    }
}

async fn send_os_test(printer_name: &str) -> Result<TestPrintResult, String> {
    let test_html = format!(
        r#"<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Prueba de Impresión</title>
<style>
  body {{ font-family: Arial, sans-serif; padding: 20px; }}
  h1 {{ color: #333; }}
  .info {{ margin: 20px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }}
</style>
</head>
<body>
<h1>Prueba de Impresión</h1>
<div class="info">
  <p><strong>Impresora:</strong> {printer}</p>
  <p><strong>Fecha:</strong> {date}</p>
</div>
<p>Si puede leer este texto, la impresora funciona correctamente.</p>
<p>Ayuda: https://ayuda.farmacia.local/impresoras</p>
</body>
</html>"#,
        printer = printer_name,
        date = chrono::Local::now().format("%d/%m/%Y %H:%M")
    );

    let temp_dir = tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let file_path = temp_dir.path().join("test-print.html");
    std::fs::write(&file_path, &test_html)
        .map_err(|e| format!("Failed to write test file: {}", e))?;

    let printer = printers::get_printer_by_name(printer_name)
        .ok_or_else(|| format!("Printer '{}' not found", printer_name))?;

    let file_path_str = file_path
        .to_str()
        .ok_or_else(|| "Invalid temp file path".to_string())?;

    let result = printer.print_file(file_path_str, PrinterJobOptions::none());

    match result {
        Ok(_job_id) => Ok(TestPrintResult {
            success: true,
            error_message: None,
            paper_out: None,
        }),
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let paper_out =
                err_msg.to_lowercase().contains("paper") || err_msg.to_lowercase().contains("out of");
            Ok(TestPrintResult {
                success: false,
                error_message: Some(err_msg),
                paper_out: Some(paper_out),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_printer_type_thermal() {
        assert_eq!(detect_printer_type("EPSON TM-T20", ""), "THERMAL_RECEIPT");
        assert_eq!(detect_printer_type("POS-80 Printer", ""), "THERMAL_RECEIPT");
        assert_eq!(detect_printer_type("Star TSP100", ""), "THERMAL_RECEIPT");
    }

    #[test]
    fn test_detect_printer_type_laser() {
        assert_eq!(detect_printer_type("HP LaserJet P1102", ""), "LASER");
        assert_eq!(detect_printer_type("Brother HL-L2350DW", ""), "LASER");
    }

    #[test]
    fn test_detect_printer_type_inkjet() {
        assert_eq!(detect_printer_type("HP DeskJet 4155", ""), "INKJET");
        assert_eq!(detect_printer_type("Epson Stylus TX125", ""), "INKJET");
    }

    #[test]
    fn test_detect_printer_type_label() {
        assert_eq!(detect_printer_type("Zebra GK420t", ""), "THERMAL_LABEL");
    }

    #[test]
    fn test_detect_connection_type_usb() {
        let result =
            detect_connection_type("EPSON TM-T20", "USB001", "USB001", "");
        assert_eq!(result, "USB");
    }

    #[test]
    fn test_detect_color_support() {
        assert!(detect_color_support("HP DeskJet 4155", ""));
        assert!(!detect_color_support("HP LaserJet P1102", ""));
    }
}
