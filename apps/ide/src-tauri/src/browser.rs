//! The in-app browser: a separate native web view placed over the browser panel.
//! It has no access to the app's commands (no capability names it).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

use crate::paths::check_url;

const LABEL: &str = "browser";

#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Clone)]
struct NavEvent {
    url: String,
}

fn place(view: &tauri::Webview, b: &Bounds) -> Result<(), String> {
    view.set_position(LogicalPosition::new(b.x.max(0.0), b.y.max(0.0))).map_err(|e| e.to_string())?;
    view.set_size(LogicalSize::new(b.width.max(1.0), b.height.max(1.0))).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_open(app: AppHandle, url: String, bounds: Bounds) -> Result<(), String> {
    let target = check_url(&url, true)?;
    if let Some(view) = app.get_webview(LABEL) {
        place(&view, &bounds)?;
        view.navigate(target).map_err(|e| e.to_string())?;
        return view.show().map_err(|e| e.to_string());
    }
    let window = app.get_window("main").ok_or("The main window is not available.")?;
    let emitter = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target))
        // Only web pages: no file, data or custom-scheme navigation.
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"))
        .on_page_load(move |_view, payload| {
            let _ = emitter.emit_to("main", "browser-nav", NavEvent { url: payload.url().to_string() });
        });
    window.add_child(builder, LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0)), LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0))).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let target = check_url(&url, true)?;
    let view = app.get_webview(LABEL).ok_or("The browser is not open.")?;
    view.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, bounds: Bounds) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(view) => place(&view, &bounds),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn browser_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(view) if visible => view.show().map_err(|e| e.to_string()),
        Some(view) => view.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn browser_eval(app: AppHandle, action: String) -> Result<(), String> {
    let view = app.get_webview(LABEL).ok_or("The browser is not open.")?;
    // A fixed set of actions; no script text comes from the caller.
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("Unknown browser action.".into()),
    };
    view.eval(script).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(view) => view.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
