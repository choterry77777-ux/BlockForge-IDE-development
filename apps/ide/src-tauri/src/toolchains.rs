use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::paths::is_allowed_executable;
use crate::state::{which_all, AppState};

#[derive(Deserialize)]
pub struct ToolSpec {
    id: String,
    candidates: Vec<String>,
    version_args: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct Detected {
    id: String,
    found: bool,
    path: Option<String>,
    version: Option<String>,
}

async fn probe(path: &std::path::Path, args: &[String], search_path: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.args(args).env("PATH", search_path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(crate::state::CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(15), cmd.output()).await.ok()?.ok()?;
    // A stub that exists but cannot run (for example /usr/bin/java without a JDK) does not count.
    if !out.status.success() {
        return None;
    }
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(140).collect::<String>();
    Some(line)
}

/// Look for each toolchain on the search path and ask it for its version.
#[tauri::command]
pub async fn detect_toolchains(state: State<'_, AppState>, specs: Vec<ToolSpec>) -> Result<Vec<Detected>, String> {
    let search_path = state.search_path.clone();
    let mut tasks = Vec::new();
    for spec in specs {
        let sp = search_path.clone();
        tasks.push(tokio::spawn(async move {
            for name in spec.candidates.iter().filter(|n| is_allowed_executable(n)) {
                for path in which_all(&sp, name) {
                    if let Some(version) = probe(&path, &spec.version_args, &sp).await {
                        return (Detected { id: spec.id.clone(), found: true, path: Some(path.to_string_lossy().into_owned()), version: Some(version) }, Some(path));
                    }
                }
            }
            (Detected { id: spec.id.clone(), found: false, path: None, version: None }, None)
        }));
    }
    let mut out = Vec::new();
    for t in tasks {
        if let Ok((d, path)) = t.await {
            if let Some(p) = path {
                state.detected.lock().unwrap().insert(p);
            }
            out.push(d);
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct HostInfo {
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub fn host_info() -> HostInfo {
    HostInfo {
        os: if cfg!(target_os = "macos") { "macos" } else if cfg!(target_os = "windows") { "windows" } else { "linux" },
        arch: if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" },
    }
}
