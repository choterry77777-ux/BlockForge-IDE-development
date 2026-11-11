//! Self-test support. When the app is started with the environment variable
//! `BLOCKFORGE_SELFTEST` set to a file path, the interface runs a scripted check of
//! the features that touch the machine and hands the result to `selftest_finish`,
//! which writes it to that file and exits. Without the variable both commands do nothing.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::state::AppState;

const VARIABLE: &str = "BLOCKFORGE_SELFTEST";

#[derive(Serialize)]
pub struct SelfTest {
    enabled: bool,
    /// A scratch folder the file checks may use; it counts as an opened folder.
    folder: Option<String>,
}

#[tauri::command]
pub fn selftest_begin(state: State<'_, AppState>) -> Result<SelfTest, String> {
    if std::env::var_os(VARIABLE).is_none() {
        return Ok(SelfTest { enabled: false, folder: None });
    }
    let dir = std::env::temp_dir().join(format!("blockforge-selftest-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir = dunce::canonicalize(&dir).map_err(|e| e.to_string())?;
    state.roots.lock().unwrap().push(dir.clone());
    Ok(SelfTest { enabled: true, folder: Some(dir.to_string_lossy().into_owned()) })
}

#[tauri::command]
pub fn selftest_finish(app: AppHandle, report: String, failed: u32) -> Result<(), String> {
    let path = std::env::var_os(VARIABLE).ok_or("The self-test is not enabled.")?;
    std::fs::write(&path, report).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(std::env::temp_dir().join(format!("blockforge-selftest-{}", std::process::id())));
    app.exit(if failed > 0 { 1 } else { 0 });
    Ok(())
}
