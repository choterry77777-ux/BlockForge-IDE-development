//! Single files chosen through native dialogs, and links opened in the system browser.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::paths::check_url;
use crate::state::AppState;

const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
pub struct OpenedFile {
    name: String,
    path: String,
    text: String,
}

#[derive(Serialize)]
pub struct SavedFile {
    name: String,
    path: String,
}

fn file_name(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn dialog(app: &AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let d = app.dialog().file();
    match app.get_webview_window("main") {
        Some(w) => d.set_parent(&w),
        None => d,
    }
}

pub async fn pick_folder(app: &AppHandle) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog(app).pick_folder(move |p| {
        let _ = tx.send(p);
    });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}

#[tauri::command]
pub async fn file_open(app: AppHandle, state: State<'_, AppState>, extensions: Vec<String>) -> Result<Option<OpenedFile>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut d = dialog(&app);
    let clean: Vec<String> = extensions.into_iter().filter(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '_' || c == '-')).collect();
    if !clean.is_empty() {
        let refs: Vec<&str> = clean.iter().map(String::as_str).collect();
        d = d.add_filter("Files", &refs);
    }
    d.pick_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(path) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err("The file is too large to open as text.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "The file is not UTF-8 text.".to_string())?;
    state.approved_files.lock().unwrap().insert(path.clone());
    Ok(Some(OpenedFile { name: file_name(&path), path: path.to_string_lossy().into_owned(), text }))
}

/// Save text. An existing path is written directly only when the user chose it
/// in a dialog earlier in this session; anything else asks where to save.
#[tauri::command]
pub async fn file_save(app: AppHandle, state: State<'_, AppState>, suggested_name: String, text: String, path: Option<String>) -> Result<Option<SavedFile>, String> {
    if let Some(p) = path.map(PathBuf::from) {
        if state.approved_files.lock().unwrap().contains(&p) {
            std::fs::write(&p, text).map_err(|e| e.to_string())?;
            return Ok(Some(SavedFile { name: file_name(&p), path: p.to_string_lossy().into_owned() }));
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog(&app).set_file_name(&suggested_name).save_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(target) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    std::fs::write(&target, text).map_err(|e| e.to_string())?;
    state.approved_files.lock().unwrap().insert(target.clone());
    Ok(Some(SavedFile { name: file_name(&target), path: target.to_string_lossy().into_owned() }))
}

#[tauri::command]
pub async fn file_save_binary(app: AppHandle, suggested_name: String, data: Vec<u8>) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog(&app).set_file_name(&suggested_name).save_file(move |p| {
        let _ = tx.send(p);
    });
    let Some(target) = rx.await.ok().flatten().and_then(|p| p.into_path().ok()) else { return Ok(false) };
    std::fs::write(&target, data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Open a link in the system browser. Only http(s) addresses are passed on.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let u = check_url(&url, true)?;
    let target = u.as_str();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", target]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(target).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}
