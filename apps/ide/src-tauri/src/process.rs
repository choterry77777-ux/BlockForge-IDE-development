use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::paths::{is_allowed_executable, safe_relative, valid_project_id};
use crate::state::{which_all, AppState, ProcEntry};

/// Environment variables a build plan may set. Values are paths inside the work directory.
const ENV_ALLOWED: &[&str] = &["PYTHONPATH", "GEM_PATH", "GEM_HOME", "NODE_PATH", "CLASSPATH"];

pub fn work_dir(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    if !valid_project_id(project_id) {
        return Err("Invalid project id.".into());
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("work").join(project_id))
}

#[derive(Deserialize)]
pub struct WorkFile {
    path: String,
    content: String,
}

/// Write the files of a build into the project's work directory.
#[tauri::command]
pub async fn work_write(app: AppHandle, project_id: String, files: Vec<WorkFile>) -> Result<String, String> {
    let dir = work_dir(&app, &project_id)?;
    std::fs::create_dir_all(dir.join("build")).map_err(|e| e.to_string())?;
    for f in files {
        let rel = safe_relative(&f.path).ok_or_else(|| format!("Refusing to write outside the project folder: {}", f.path))?;
        let target = dir.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, f.content).map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn work_clean(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<(), String> {
    let dir = work_dir(&app, &project_id)?;
    for p in paths {
        let rel = safe_relative(&p).ok_or_else(|| format!("Refusing to remove outside the project folder: {p}"))?;
        let target = dir.join(rel);
        if target.is_dir() {
            std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        } else if target.exists() {
            std::fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn work_reveal(app: AppHandle, project_id: String) -> Result<(), String> {
    let dir = work_dir(&app, &project_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(target_os = "windows") { "explorer" } else { "xdg-open" };
    std::process::Command::new(opener).arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
pub struct ProcRequest {
    project_id: String,
    tool: Option<String>,
    artifact: Option<String>,
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    stdin: Option<String>,
    timeout_ms: u64,
    max_output_bytes: usize,
}

#[derive(Serialize, Clone)]
struct OutputEvent<'a> {
    id: &'a str,
    stream: &'a str,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
    code: Option<i32>,
    timed_out: bool,
    truncated: bool,
    killed: bool,
    error: Option<String>,
}

/// Decide what will be executed. Only allow-listed toolchains and artifacts built
/// inside the project's own work directory can be started.
fn resolve_program(state: &AppState, dir: &Path, req: &ProcRequest) -> Result<PathBuf, String> {
    if let Some(artifact) = &req.artifact {
        let rel = safe_relative(artifact).ok_or("The program path is not inside the project folder.")?;
        let full = dir.join(rel).canonicalize().map_err(|_| "The built program was not found. Build the project first.".to_string())?;
        let root = dir.canonicalize().map_err(|e| e.to_string())?;
        if !full.starts_with(&root) || !full.is_file() {
            return Err("The program path is not inside the project folder.".into());
        }
        return Ok(full);
    }
    let tool = req.tool.as_deref().ok_or("No program was given.")?;
    let as_path = Path::new(tool);
    if as_path.components().count() > 1 {
        // A full path is accepted only when toolchain detection produced it.
        let name = as_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !is_allowed_executable(name) || !state.detected.lock().unwrap().contains(as_path) {
            return Err(format!("\"{tool}\" is not a detected toolchain."));
        }
        return Ok(as_path.to_path_buf());
    }
    if !is_allowed_executable(tool) {
        return Err(format!("\"{tool}\" is not an allowed toolchain."));
    }
    which_all(&state.search_path, tool).into_iter().next().ok_or_else(|| format!("\"{tool}\" was not found on this computer."))
}

fn kill_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        // The child leads its own process group, so the whole group is signalled.
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

#[tauri::command]
pub async fn proc_spawn(app: AppHandle, state: State<'_, AppState>, id: String, request: ProcRequest) -> Result<(), String> {
    let dir = work_dir(&app, &request.project_id)?;
    std::fs::create_dir_all(dir.join("build")).map_err(|e| e.to_string())?;
    let program = resolve_program(&state, &dir, &request)?;

    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&request.args).current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    cmd.env("PATH", &state.search_path).env("PYTHONIOENCODING", "utf-8").env("PYTHONUNBUFFERED", "1").env("DOTNET_CLI_TELEMETRY_OPTOUT", "1").env("DOTNET_NOLOGO", "1");
    for (k, v) in &request.env {
        if !ENV_ALLOWED.contains(&k.as_str()) {
            return Err(format!("The environment variable {k} is not allowed."));
        }
        let rel = safe_relative(v).ok_or_else(|| format!("{k} must point inside the project folder."))?;
        cmd.env(k, dir.join(rel));
    }
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", program.display()))?;
    let pid = child.id().unwrap_or(0);
    let killed = Arc::new(AtomicBool::new(false));
    let truncated = Arc::new(AtomicBool::new(false));
    let total = Arc::new(AtomicUsize::new(0));
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Standard input: text given up front is written and the pipe closed, so programs
    // that read to the end finish. With no text, the pipe stays open for typed input.
    let mut stdin = child.stdin.take();
    let initial = request.stdin.clone().filter(|s| !s.is_empty());
    tokio::spawn(async move {
        if let (Some(text), Some(pipe)) = (initial, stdin.as_mut()) {
            let _ = pipe.write_all(text.as_bytes()).await;
            let _ = pipe.shutdown().await;
            return;
        }
        if let Some(mut pipe) = stdin {
            while let Some(data) = rx.recv().await {
                if pipe.write_all(&data).await.is_err() || pipe.flush().await.is_err() {
                    break;
                }
            }
        }
    });

    let mut readers = Vec::new();
    let streams: [(&'static str, Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>); 2] = [
        ("stdout", child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)),
        ("stderr", child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)),
    ];
    for (name, stream) in streams {
        let Some(mut stream) = stream else { continue };
        let app = app.clone();
        let id = id.clone();
        let total = total.clone();
        let truncated = truncated.clone();
        let limit = request.max_output_bytes.max(1024);
        readers.push(tokio::spawn(async move {
            let mut buf = vec![0u8; 8192];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if total.fetch_add(n, Ordering::SeqCst) + n > limit {
                            // A runaway program is stopped instead of flooding the interface.
                            truncated.store(true, Ordering::SeqCst);
                            kill_tree(pid);
                            break;
                        }
                        let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app.emit_to("main", "proc-output", OutputEvent { id: &id, stream: name, data });
                    }
                }
            }
        }));
    }

    state.procs.lock().unwrap().insert(id.clone(), ProcEntry { pid, stdin: tx, killed: killed.clone() });

    let app2 = app.clone();
    let timeout = Duration::from_millis(request.timeout_ms.clamp(1000, 3_600_000));
    tokio::spawn(async move {
        let waited = tokio::time::timeout(timeout, child.wait()).await;
        let timed_out = waited.is_err();
        if timed_out {
            kill_tree(pid);
            let _ = child.wait().await;
        }
        for r in readers {
            let _ = r.await;
        }
        let (code, error) = match waited {
            Ok(Ok(status)) => (status.code(), None),
            Ok(Err(e)) => (None, Some(e.to_string())),
            Err(_) => (None, None),
        };
        app2.state::<AppState>().procs.lock().unwrap().remove(&id);
        let _ = app2.emit_to("main", "proc-exit", ExitEvent { id, code, timed_out, truncated: truncated.load(Ordering::SeqCst), killed: killed.load(Ordering::SeqCst), error });
    });
    Ok(())
}

pub fn kill_all(state: &AppState) {
    for (_, entry) in state.procs.lock().unwrap().drain() {
        kill_tree(entry.pid);
    }
}

#[tauri::command]
pub fn proc_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let procs = state.procs.lock().unwrap();
    let entry = procs.get(&id).ok_or("The program is no longer running.")?;
    entry.stdin.send(data.into_bytes()).map_err(|_| "The program is not reading input.".to_string())
}

#[tauri::command]
pub fn proc_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(entry) = state.procs.lock().unwrap().get(&id) {
        entry.killed.store(true, Ordering::SeqCst);
        kill_tree(entry.pid);
    }
    Ok(())
}
