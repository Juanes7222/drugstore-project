//! OAuth popup window support for the Google/Firebase sign-in flow.
//!
//! Firebase's `signInWithPopup` opens the provider consent screen with
//! `window.open()` and then talks to that window through `window.opener`.
//! A Tauri webview denies popups unless a handler is registered, and the
//! naive `NewWindowResponse::Allow` hands the URL to the *system browser*,
//! which severs the opener channel the SDK depends on. Only
//! `NewWindowResponse::Create` yields a real child webview that keeps
//! `window.opener` intact, so that is what this handler does.
//!
//! Security posture:
//!
//! * The handler is attached only to the `main` window. Popup windows get
//!   no handler of their own, so nested `window.open()` calls fall back to
//!   Tauri's deny-by-default and a compromised consent page cannot spawn
//!   further windows.
//! * Only `http`/`https` URLs are accepted. `file:`, `javascript:` and
//!   `data:` are rejected before any webview is created, so a malicious
//!   redirect cannot pull local resources into a privileged window.
//! * At most one popup exists at a time. A fixed label both caps resource
//!   use and prevents window-label squatting from a redirected page.
//! * Capability-scoped permissions are unaffected: `capabilities/default.json`
//!   grants them to the `main` window only, so the popup runs with no
//!   filesystem, shell or dialog access.

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

/// Window label of the single OAuth popup window.
const OAUTH_POPUP_LABEL: &str = "oauth-popup";

/// Only web origins may be loaded into the popup. Anything else (`file:`,
/// `javascript:`, `data:`, custom app schemes) is refused.
fn is_loadable_origin(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Whether an OAuth popup is currently open.
fn popup_is_open(app: &AppHandle) -> bool {
    app.get_webview_window(OAUTH_POPUP_LABEL).is_some()
}

/// Build the `main` window from its `tauri.conf.json` definition, attaching
/// the popup handler that `signInWithPopup` needs.
///
/// The config entry keeps `"create": false` so Tauri does not also build an
/// unhandled copy of the window before `setup` runs.
pub fn build_main_window(app: &AppHandle) -> Result<WebviewWindow<Wry>, String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .ok_or_else(|| "tauri.conf.json has no window labelled \"main\"".to_string())?
        .clone();

    let handler_app = app.clone();

    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| format!("failed to build the main window: {e}"))?
        .on_new_window(move |url, features| open_oauth_popup(&handler_app, url, features))
        .build()
        .map_err(|e| format!("failed to create the main window: {e}"))
}

/// Handle a `window.open()` request from the `main` window.
fn open_oauth_popup(
    app: &AppHandle,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<Wry> {
    if !is_loadable_origin(&url) {
        log::warn!(
            "[oauth-popup] refused non-web URL scheme: {}",
            url.scheme()
        );
        return NewWindowResponse::Deny;
    }

    // A second concurrent popup means something is looping; refuse rather
    // than let an untrusted page allocate unbounded windows.
    if popup_is_open(app) {
        log::warn!("[oauth-popup] refused: a popup is already open");
        return NewWindowResponse::Deny;
    }

    let popup = WebviewWindowBuilder::new(app, OAUTH_POPUP_LABEL, WebviewUrl::External(url))
        .window_features(features)
        .title("Sign in with Google")
        .inner_size(520.0, 720.0)
        .build();

    match popup {
        Ok(window) => NewWindowResponse::Create { window },
        Err(e) => {
            log::error!("[oauth-popup] failed to create popup window: {e}");
            NewWindowResponse::Deny
        }
    }
}

/// Close the OAuth popup, if one is open.
///
/// The provider page calls `window.close()` when it finishes, which a
/// natively-created webview window does not honour. The renderer calls this
/// once the session is established so the window cannot linger on screen.
#[tauri::command]
pub fn close_oauth_popup(app: AppHandle) {
    if let Some(window) = app.get_webview_window(OAUTH_POPUP_LABEL) {
        let _ = window.close();
    }
}