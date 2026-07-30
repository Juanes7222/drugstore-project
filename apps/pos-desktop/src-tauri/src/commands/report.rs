//! Report export commands — native save dialog + file write.
//!
//! The TypeScript side calls `save()` from the dialog plugin to get a
//! target file path, passes the exported content as base64, and this
//! command writes the decoded bytes to disk atomically.

use base64::Engine;
use tokio::fs;

/// Write a base64-encoded report export to the given file path.
///
/// The file is written to the exact `file_path` the user selected in
/// the save dialog.  Returns the same path on success so the caller
/// can show a confirmation toast.
#[tauri::command]
pub async fn write_report_export(
    file_path: String,
    content_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| format!("No se pudo decodificar el contenido: {}", e))?;

    // Write atomically: temp file → rename to avoid partial writes.
    let temp_path = format!("{}.tmp", &file_path);
    fs::write(&temp_path, &bytes)
        .await
        .map_err(|e| format!("No se pudo escribir el archivo: {}", e))?;
    fs::rename(&temp_path, &file_path)
        .await
        .map_err(|e| format!("No se pudo renombrar el archivo temporal: {}", e))?;

    Ok(file_path)
}
