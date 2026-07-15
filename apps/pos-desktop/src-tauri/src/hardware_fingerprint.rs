/// Hardware fingerprint module for the POS desktop.
///
/// Generates a stable, device-specific fingerprint from multiple hardware
/// identifiers. The fingerprint is used for workstation activation and
/// anti-fraud correlation.
///
/// ## Components
/// - Machine GUID (Windows registry) or `/etc/machine-id` (Linux)
/// - Primary MAC address (first non-loopback adapter)
/// - OS hostname
///
/// These are combined and hashed with SHA-256, salted with a per-installation
/// salt stored in the Tauri app data directory.
///
/// ## Limitations
/// - The fingerprint is NOT cryptographically secure as a device binding.
/// - A BIOS update, network card replacement, or OS reinstall will change it.
/// - MAC addresses can be spoofed.
/// - Defense in depth is provided by the server-side fraud detection layer,
///   not by any single component of the fingerprint.
use sha2::{Digest, Sha256};
use std::io;
use tauri::AppHandle;
use tauri::Manager;

/// Generate a stable hardware fingerprint for this device.
///
/// The fingerprint is deterministic for the same hardware + installation.
/// It uses SHA-256 over a concatenation of hardware identifiers.
#[tauri::command]
pub fn get_hardware_fingerprint(app_handle: AppHandle) -> Result<String, String> {
    let machine_id = get_machine_id().map_err(|e| format!("Failed to get machine ID: {}", e))?;
    let mac_address = get_primary_mac().map_err(|e| format!("Failed to get MAC address: {}", e))?;
    let hostname = get_hostname().map_err(|e| format!("Failed to get hostname: {}", e))?;
    let salt = get_or_create_salt(&app_handle).map_err(|e| format!("Failed to get salt: {}", e))?;

    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(machine_id.as_bytes());
    hasher.update(mac_address.as_bytes());
    hasher.update(hostname.as_bytes());

    let result = hasher.finalize();
    Ok(hex::encode(result))
}

/// Get the machine ID.
///
/// On Windows: reads the MachineGuid from the registry.
/// On Linux: reads /etc/machine-id or /var/lib/dbus/machine-id.
/// On macOS: reads the IOPlatformUUID from IORegistry.
fn get_machine_id() -> io::Result<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm
            .open_subkey_with_flags(
                r"SOFTWARE\Microsoft\Cryptography",
                KEY_READ,
            )
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        let guid: String = key
            .get_value("MachineGuid")
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        return Ok(guid);
    }

    #[cfg(target_os = "linux")]
    {
        // Try /etc/machine-id first, then fall back to /var/lib/dbus/machine-id
        let paths = [
            "/etc/machine-id",
            "/var/lib/dbus/machine-id",
        ];

        for path in &paths {
            if let Ok(content) = std::fs::read_to_string(path) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
        }

        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "No machine-id file found",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(value_start) = line.find('"') {
                    let rest = &line[value_start + 1..];
                    if let Some(value_end) = rest.find('"') {
                        return Ok(rest[..value_end].to_string());
                    }
                }
            }
        }

        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "IOPlatformUUID not found",
        ));
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        // Fallback: use hostname only
        Ok(get_hostname().unwrap_or_else(|_| "unknown".to_string()))
    }
}

/// Get the MAC address of the primary network adapter.
///
/// Uses the `mac_address` crate to find the first non-loopback MAC.
fn get_primary_mac() -> io::Result<String> {
    // Use `mac_address` crate if available; fallback to platform-specific
    // For now, return a placeholder that the caller will combine with other
    // identifiers. In production, use the `mac_address` crate:
    // let mac = mac_address::get_mac_address()?;
    // Ok(mac.map(|m| m.to_string()).unwrap_or_default())

    #[cfg(target_os = "windows")]
    {
        // Get MAC via ipconfig /all
        use std::process::Command;
        let output = Command::new("getmac")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(first_line) = stdout.lines().next() {
            // CSV format: "MAC","Transport Name"
            let parts: Vec<&str> = first_line.split(',').collect();
            if parts.len() >= 1 {
                let mac = parts[0].trim_matches('"').replace('-', ":");
                if !mac.is_empty() && mac != "00:00:00:00:00:00" {
                    return Ok(mac);
                }
            }
        }

        // Fallback: generate a consistent hash-based identifier
        let hostname = get_hostname().unwrap_or_else(|_| "unknown".to_string());
        let mut hasher = Sha256::new();
        hasher.update(hostname.as_bytes());
        let hash = hasher.finalize();
        let hex = hex::encode(&hash[..6]);
        let formatted = format!(
            "{}{}:{}{}:{}{}",
            &hex[0..2],
            &hex[2..4],
            &hex[4..6],
            &hex[6..8],
            &hex[8..10],
            &hex[10..12],
        );
        return Ok(formatted);
    }

    #[cfg(target_os = "linux")]
    {
        // Read MAC from /sys/class/net/<interface>/address
        let net_dir = std::path::Path::new("/sys/class/net");
        if let Ok(entries) = std::fs::read_dir(net_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str == "lo" {
                    continue;
                }
                let address_path = entry.path().join("address");
                if let Ok(address) = std::fs::read_to_string(&address_path) {
                    let mac = address.trim().to_string();
                    if !mac.is_empty() && mac != "00:00:00:00:00:00" {
                        return Ok(mac);
                    }
                }
            }
        }

        // Fallback: generate from hostname hash
        let hostname = get_hostname().unwrap_or_else(|_| "unknown".to_string());
        let mut hasher = Sha256::new();
        hasher.update(hostname.as_bytes());
        let hash = hasher.finalize();
        let hex = hex::encode(&hash[..6]);
        let formatted = format!(
            "{}{}:{}{}:{}{}",
            &hex[0..2],
            &hex[2..4],
            &hex[4..6],
            &hex[6..8],
            &hex[8..10],
            &hex[10..12],
        );
        return Ok(formatted);
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("ifconfig")
            .arg("en0")
            .output()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("ether") {
                if let Some(mac) = trimmed.split_whitespace().nth(1) {
                    return Ok(mac.to_string());
                }
            }
        }

        // Fallback
        let hostname = get_hostname().unwrap_or_else(|_| "unknown".to_string());
        let mut hasher = Sha256::new();
        hasher.update(hostname.as_bytes());
        let hash = hasher.finalize();
        let hex = hex::encode(&hash[..6]);
        let formatted = format!(
            "{}{}:{}{}:{}{}",
            &hex[0..2],
            &hex[2..4],
            &hex[4..6],
            &hex[6..8],
            &hex[8..10],
            &hex[10..12],
        );
        return Ok(formatted);
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Ok("00:00:00:00:00:00".to_string())
    }
}

/// Get the device hostname.
fn get_hostname() -> io::Result<String> {
    Ok(hostname::get()?.to_string_lossy().to_string())
}

/// Get or create a persistent salt stored in the Tauri app data directory.
///
/// The salt is generated once on first launch and reused for all subsequent
/// fingerprint calculations. This ensures that reinstalling the app (but
/// keeping the app data) preserves the same fingerprint.
fn get_or_create_salt(app_handle: &AppHandle) -> io::Result<String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

    std::fs::create_dir_all(&app_dir)?;

    let salt_path = app_dir.join("hardware_salt");

    if salt_path.exists() {
        let salt = std::fs::read_to_string(&salt_path)?;
        return Ok(salt.trim().to_string());
    }

    // Generate a new random salt
    use rand::Rng;
    let salt: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    std::fs::write(&salt_path, &salt)?;
    Ok(salt)
}
