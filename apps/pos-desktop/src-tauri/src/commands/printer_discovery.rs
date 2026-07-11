//! Tauri command handlers for printer discovery, test printing, status,
//! file-based printing, temp file writing, and file existence checks.
//!
//! Each command is intentionally thin: validate input, delegate to the domain
//! module in `crate::printer_discovery`, and map errors into a serializable result.

use tauri::{command, AppHandle};

use crate::printer_discovery::{
    self, DiscoveredPrinter, PrinterStatusResponse, TestPrintResult,
};

/// Enumerate all printers the OS knows about.
#[command]
pub fn discover_printers() -> Result<Vec<DiscoveredPrinter>, String> {
    printer_discovery::discover_printers()
}

/// Scan a /24 subnet for network printers on common ports (9100, 631, 515).
#[command]
pub async fn scan_network_printers(subnet: String) -> Result<Vec<DiscoveredPrinter>, String> {
    printer_discovery::scan_network_printers(subnet).await
}

/// Send a test page to a specific printer.
#[command]
pub async fn test_print(
    printer_system_name: String,
    payload_type: String,
) -> Result<TestPrintResult, String> {
    printer_discovery::test_print(printer_system_name, payload_type).await
}

/// Get the current status of a specific printer (best-effort).
#[command]
pub async fn get_printer_status(
    printer_system_name: String,
) -> Result<PrinterStatusResponse, String> {
    printer_discovery::get_printer_status(printer_system_name).await
}

/// Print an existing file to a specific printer.
///
/// This is the production print path for receipts, invoices, reports, etc.
/// The file must already exist on disk at the given path.
#[command]
pub async fn print_file(
    printer_system_name: String,
    file_path: String,
) -> Result<TestPrintResult, String> {
    printer_discovery::print_file(printer_system_name, file_path).await
}

/// Write a temporary print payload file to the app data directory.
///
/// Creates the `print-queue/` subdirectory as needed, writes the content,
/// and returns the absolute file path. The returned path can be tracked in
/// the print queue and passed to `print_file` for production printing.
#[command]
pub fn write_temp_file(app: AppHandle, filename: String, content: String) -> Result<String, String> {
    printer_discovery::write_temp_file(&app, &filename, &content)
}

/// Check whether a file exists at the given path.
///
/// Used by the print queue to verify that a queued payload file still
/// exists before attempting to print it.
#[command]
pub fn file_exists(path: String) -> bool {
    printer_discovery::file_exists(&path)
}
