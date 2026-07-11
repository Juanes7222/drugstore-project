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
    /// Best-guess paper size detected from printer model/name.
    /// One of: RECEIPT_80MM, RECEIPT_58MM, RECEIPT_76MM, LETTER, A4,
    /// LABEL_50X25, LABEL_62X29, LABEL_OTHER, UNKNOWN.
    pub detected_paper_size: String,
    /// Confidence level of the detection: "high", "medium", "low", "none".
    pub detection_confidence: String,
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
            let (detected_size, detection_confidence) = detect_paper_size(&name, &driver_name, &printer_type);

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
                detected_paper_size: detected_size,
                detection_confidence,
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

            let (detected_size, detection_confidence) = detect_paper_size("", &printer_type, &printer_type);

            results.push(DiscoveredPrinter {
                system_name: format!("network:{}:{}", candidate.ip, candidate.port),
                friendly_name: format!("Impresora de red ({})", candidate.detected_protocol),
                connection: "NETWORK".to_string(),
                is_default: false,
                printer_type,
                supports_color: false,
                detected_paper_size: detected_size,
                detection_confidence,
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

/// Detect the most likely paper size for a printer based on model name,
/// driver name, and detected type.
///
/// Returns `(paper_size_string, confidence)` where confidence is one of
/// `"high"`, `"medium"`, `"low"`, or `"none"`.
///
/// ## How it works
///
/// 1. **Heuristic by model name** (high confidence): checks known model
///    numbers against a database of ~50 common POS/office printers.
/// 2. **Heuristic by type** (medium confidence): uses defaults by category
///    (thermal receipt → 80mm, label → LABEL_OTHER, laser → LETTER/A4).
/// 3. **Fallback** (low confidence): returns UNKNOWN.
pub(crate) fn detect_paper_size(
    name: &str,
    driver_name: &str,
    printer_type: &str,
) -> (String, String) {
    let combined = format!("{} {}", name, driver_name).to_lowercase();

    // ---- High confidence matches: explicit model numbers ----

    // --- 80mm thermal receipt (most common) ---
    if combined.contains("tm-t20")
        || combined.contains("tm-t88")
        || combined.contains("tm-t70")
        || combined.contains("tm-u220")
        || combined.contains("tm-u230")
        || combined.contains("tm-h6000")
        || combined.contains("tsp100")
        || combined.contains("tsp143")
        || combined.contains("tsp650")
        || combined.contains("tsp700")
        || combined.contains("tsp800")
        || combined.contains("pos-80")
        || combined.contains("pos80")
        || combined.contains("bematech mp-4200")
        || combined.contains("bematech mp-4000")
        || combined.contains("daruma dr800")
        || combined.contains("daruma dr700")
        || combined.contains("daruma fs-321")
        || combined.contains("samsung srp-350")
        || combined.contains("samsung srp-275")
        || combined.contains("samsung srp-500")
        || combined.contains("samsung srd-300")
        || combined.contains("80mm")
        || combined.contains("80 mm")
    {
        return ("RECEIPT_80MM".to_string(), "high".to_string());
    }

    // --- 58mm thermal receipt (smaller, portable/datáfono) ---
    if combined.contains("tm-t20ii")
        || combined.contains("tm-m30")
        || combined.contains("tm-m50")
        || combined.contains("pos-58")
        || combined.contains("pos58")
        || combined.contains("58mm")
        || combined.contains("58 mm")
        || combined.contains("57mm")
        || combined.contains("57 mm")
        || combined.contains("ingenico")
        || combined.contains("verifone")
        || combined.contains("bbpos")
        || combined.contains("datecs")
        || combined.contains("star tsp100ii") // some variants
        || combined.contains("spp-r")
        || combined.contains("bixolon srp-275ii") // sometimes 58mm
    {
        return ("RECEIPT_58MM".to_string(), "high".to_string());
    }

    // --- 76mm dot matrix / impact ---
    if combined.contains("epson fx-")
        || combined.contains("epson lq-")
        || combined.contains("epson lx-")
        || combined.contains("epson dfx-")
        || combined.contains("panasonic kx-p")
        || combined.contains("star nk")
        || combined.contains("star np")
        || combined.contains("okidata microline")
        || combined.contains("okidata ml")
        || combined.contains("ibm proprinter")
        || combined.contains("72mm")
        || combined.contains("76mm")
        || combined.contains("matriz")
        || combined.contains("dot matrix")
        || combined.contains("impact printer")
        || combined.contains("cartucho")
        || combined.contains("cinta")
    {
        return ("RECEIPT_76MM".to_string(), "high".to_string());
    }

    // --- Label printers ---
    if combined.contains("zebra gk")
        || combined.contains("zebra gc")
        || combined.contains("zebra gt")
        || combined.contains("zebra zp")
        || combined.contains("zebra zt")
        || combined.contains("godex g500")
        || combined.contains("godex g530")
        || combined.contains("godex ezt")
        || combined.contains("citizen clp")
        || combined.contains("toshiba tec b")
        || combined.contains("brady")
        || combined.contains("label")
        || combined.contains("etiqueta")
    {
        // Without knowing the specific label size, return LABEL_OTHER
        return ("LABEL_OTHER".to_string(), "high".to_string());
    }

    // --- Laser printers ---
    if combined.contains("laserjet")
        || combined.contains("laser jet")
        || combined.contains("pagewide")
        || combined.contains("mfp")
        || combined.contains("brother hl-")
        || combined.contains("brother dcp-")
        || combined.contains("canon imageclass")
        || combined.contains("canon lbp")
        || combined.contains("samsung ml-")
        || combined.contains("samsung scx-")
        || combined.contains("kyocera")
        || combined.contains("ricoh")
        || combined.contains("lexmark")
    {
        // Laser printers typically default to LETTER in the Americas
        return ("LETTER".to_string(), "medium".to_string());
    }

    // ---- Medium confidence matches: by printer type default ----
    match printer_type {
        "THERMAL_RECEIPT" => {
            // Most thermal receipt printers are 80mm; if not matched above,
            // 80mm is the safest default
            ("RECEIPT_80MM".to_string(), "medium".to_string())
        }
        "THERMAL_LABEL" => ("LABEL_OTHER".to_string(), "medium".to_string()),
        "LASER" => ("LETTER".to_string(), "medium".to_string()),
        "INKJET" => ("LETTER".to_string(), "low".to_string()),
        "MULTIFUNCTION" => ("LETTER".to_string(), "low".to_string()),
        _ => ("UNKNOWN".to_string(), "none".to_string()),
    }
}

/// Return a human-readable description of the paper size for display in the UI.
pub fn paper_size_description(paper_size: &str) -> &'static str {
    match paper_size {
        "RECEIPT_80MM" => "80 mm (estándar POS)",
        "RECEIPT_58MM" => "57/58 mm (portátil / datáfono)",
        "RECEIPT_76MM" => "76 mm (matriz de punto)",
        "LETTER" => "Carta (216 × 279 mm)",
        "A4" => "A4 (210 × 297 mm)",
        "LABEL_50X25" => "Etiqueta 50 × 25 mm",
        "LABEL_62X29" => "Etiqueta 62 × 29 mm",
        "LABEL_OTHER" => "Etiqueta (otro tamaño)",
        "CUSTOM" => "Personalizado",
        _ => "Desconocido",
    }
}

/// Return the character width (in monospace chars at 12CPI) for a paper size.
pub fn paper_size_char_width(paper_size: &str) -> u32 {
    match paper_size {
        "RECEIPT_80MM" => 48,
        "RECEIPT_58MM" => 32,
        "RECEIPT_76MM" => 45,
        "LETTER" => 80,
        "A4" => 85,
        _ => 48, // safe default
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

/// Represents the result of a print operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub raw_bytes_sent: Option<u32>,
}

/// Represents the result of a cash drawer operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawerResult {
    pub success: bool,
    pub error_message: Option<String>,
}

/// Send raw ESC/POS bytes to a thermal receipt printer.
///
/// Unlike `print_file` which sends an OS-level print job, this function
/// writes the raw bytes directly to the printer device. This is used
/// for thermal receipt templates that are generated as ESC/POS commands.
pub async fn print_escpos(
    printer_system_name: String,
    commands: Vec<u8>,
) -> Result<PrintResult, String> {
    // On Windows, write to the printer via the "print to file" approach
    // using the `printers` crate's raw printing capability.
    // If direct write fails, fall back to writing a temp file and printing
    // that file via `print_file`.

    let result = tokio::task::spawn_blocking(move || {
        // Try 1: Use the escpos crate's FileDriver for direct write
        match std::fs::write(&printer_system_name, &commands) {
            Ok(_) => Ok(PrintResult {
                success: true,
                error_message: None,
                raw_bytes_sent: Some(commands.len() as u32),
            }),
            Err(_e) => {
                // Try 2: Write to temp file and use OS print
                let temp_dir = tempfile::tempdir()
                    .map_err(|e| format!("Failed to create temp dir: {}", e))?;
                let file_path = temp_dir.path().join("escpos-print.bin");
                std::fs::write(&file_path, &commands)
                    .map_err(|e| format!("Failed to write temp file: {}", e))?;

                let printer = printers::get_printer_by_name(&printer_system_name)
                    .ok_or_else(|| format!("Printer '{}' not found", printer_system_name))?;

                let path_str = file_path
                    .to_str()
                    .ok_or_else(|| "Invalid temp file path".to_string())?;

                let print_result = printer.print_file(path_str, PrinterJobOptions::none());
                match print_result {
                    Ok(_job_id) => Ok(PrintResult {
                        success: true,
                        error_message: None,
                        raw_bytes_sent: Some(commands.len() as u32),
                    }),
                    Err(pe) => {
                        let err_msg = format!("{:?}", pe);
                        Ok(PrintResult {
                            success: false,
                            error_message: Some(err_msg),
                            raw_bytes_sent: Some(commands.len() as u32),
                        })
                    }
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    result
}

/// Send a label image (or its HTML equivalent) to a label printer.
///
/// The `image_path` should point to an HTML file (generated by the TS
/// label-formatter) which contains the label markup. The function writes
/// the HTML to a temp file and sends it via the OS print system.
pub async fn print_label_image(
    printer_system_name: String,
    image_path: String,
) -> Result<PrintResult, String> {
    // Verify the file exists
    let path = std::path::Path::new(&image_path);
    if !path.exists() {
        return Ok(PrintResult {
            success: false,
            error_message: Some(format!("Label image file not found: {}", image_path)),
            raw_bytes_sent: None,
        });
    }

    let printer = printers::get_printer_by_name(&printer_system_name)
        .ok_or_else(|| format!("Printer '{}' not found", printer_system_name))?;

    let path_str = path
        .to_str()
        .ok_or_else(|| "Invalid image path".to_string())?;

    let result = printer.print_file(path_str, PrinterJobOptions::none());

    match result {
        Ok(_job_id) => Ok(PrintResult {
            success: true,
            error_message: None,
            raw_bytes_sent: None,
        }),
        Err(e) => {
            let err_msg = format!("{:?}", e);
            Ok(PrintResult {
                success: false,
                error_message: Some(err_msg),
                raw_bytes_sent: None,
            })
        }
    }
}

/// Open the cash drawer connected to a thermal receipt printer.
///
/// Sends the standard ESC/POS cash drawer kick command
/// (ESC p 0 50 250 = 0x1B 0x70 0x00 0x32 0xFA) to the printer.
/// The optional `kick_command` bytes override the default if provided.
pub async fn open_cash_drawer(
    printer_system_name: String,
    kick_command: Option<Vec<u8>>,
) -> Result<DrawerResult, String> {
    let default_kick = vec![0x1B, 0x70, 0x00, 0x32, 0xFA];
    let cmd = kick_command.unwrap_or_else(|| default_kick.clone());

    let result = tokio::task::spawn_blocking(move || {
        // Try to write the kick command directly to the printer device
        match std::fs::write(&printer_system_name, &cmd) {
            Ok(_) => Ok(DrawerResult {
                success: true,
                error_message: None,
            }),
            Err(_outer_err) => {
                // Fall back: write a temp file with just the kick command and print it
                let temp_dir = match tempfile::tempdir() {
                    Ok(d) => d,
                    Err(e) => return Ok(DrawerResult {
                        success: false,
                        error_message: Some(format!("Failed to create temp dir: {}", e)),
                    }),
                };
                let file_path = temp_dir.path().join("cash-drawer-kick.bin");
                if let Err(e) = std::fs::write(&file_path, &cmd) {
                    return Ok(DrawerResult {
                        success: false,
                        error_message: Some(format!("Failed to write kick command: {}", e)),
                    });
                }

                let printer = match printers::get_printer_by_name(&printer_system_name) {
                    Some(p) => p,
                    None => return Ok(DrawerResult {
                        success: false,
                        error_message: Some(format!("Printer '{}' not found", printer_system_name)),
                    }),
                };

                let path_str = match file_path.to_str() {
                    Some(s) => s.to_string(),
                    None => return Ok(DrawerResult {
                        success: false,
                        error_message: Some("Invalid temp file path".to_string()),
                    }),
                };

                match printer.print_file(&path_str, PrinterJobOptions::none()) {
                    Ok(_) => Ok(DrawerResult {
                        success: true,
                        error_message: None,
                    }),
                    Err(pe) => Ok(DrawerResult {
                        success: false,
                        error_message: Some(format!("{:?}", pe)),
                    }),
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    result
}

/// Send text to a customer display connected via a printer's pass-through port.
///
/// Many customer displays accept simple text commands over a serial or
/// pass-through connection. The text is sent as-is to the printer device.
pub async fn customer_display_update(
    printer_system_name: String,
    text: String,
    encoding: String,
) -> Result<DrawerResult, String> {
    // Clear display command for most pole displays
    let clear_cmd: Vec<u8> = vec![0x0C]; // FF - clear display
    let encoded_text = match encoding.as_str() {
        "CP437" | "CP850" => {
            // For CP437/850, use ASCII transliteration that was already done on TS side
            text.as_bytes().to_vec()
        }
        _ => text.as_bytes().to_vec(),
    };

    let mut display_data = Vec::new();
    display_data.extend_from_slice(&clear_cmd);
    display_data.extend_from_slice(&encoded_text);

    let result = tokio::task::spawn_blocking(move || {
        match std::fs::write(&printer_system_name, &display_data) {
            Ok(_) => Ok(DrawerResult {
                success: true,
                error_message: None,
            }),
            Err(_first_err) => {
                // Some displays require carriage return + line feed
                let mut alt_data = Vec::new();
                alt_data.extend_from_slice(&clear_cmd);
                alt_data.extend_from_slice(&encoded_text);
                alt_data.push(0x0D); // CR
                alt_data.push(0x0A); // LF

                match std::fs::write(&printer_system_name, &alt_data) {
                    Ok(_) => Ok(DrawerResult {
                        success: true,
                        error_message: None,
                    }),
                    Err(e2) => Ok(DrawerResult {
                        success: false,
                        error_message: Some(format!("Display write failed: {}", e2)),
                    }),
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    result
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
