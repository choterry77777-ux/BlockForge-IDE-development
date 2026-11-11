//! Terminal sessions backed by a real pseudo-terminal.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::process::work_dir;
use crate::state::{AppState, PtyEntry};
use crate::workspace::within_roots;

#[derive(Deserialize)]
pub struct PtyOptions {
    /// Working directory; must be inside an opened folder.
    cwd: Option<String>,
    /// Use a project's work directory when no folder is given.
    project_id: Option<String>,
    cols: u16,
    rows: u16,
    /// Run one command line and exit instead of an interactive shell.
    command: Option<String>,
}

#[derive(Serialize, Clone)]
struct DataEvent<'a> {
    id: &'a str,
    data: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent<'a> {
    id: &'a str,
    code: Option<i32>,
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 500), cols: cols.clamp(10, 1000), pixel_width: 0, pixel_height: 0 }
}

pub fn shell_command(command: Option<&str>, cwd: &Path, search_path: &str) -> CommandBuilder {
    #[cfg(unix)]
    let mut cmd = {
        let shell = std::env::var("SHELL").ok().filter(|s| Path::new(s).is_file()).unwrap_or_else(|| "/bin/zsh".into());
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        if let Some(line) = command {
            c.arg("-c");
            c.arg(line);
        }
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        if let Some(line) = command {
            c.arg("-NoProfile");
            c.arg("-Command");
            c.arg(line);
        }
        c
    };
    cmd.cwd(cwd);
    if !search_path.is_empty() {
        cmd.env("PATH", search_path);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "BlockForge");
    // An app started from the Finder has no locale; without one, non-ASCII text breaks.
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd
}

#[tauri::command]
pub fn pty_open(app: AppHandle, state: State<'_, AppState>, id: String, options: PtyOptions) -> Result<String, String> {
    let cwd = match (&options.cwd, &options.project_id) {
        (Some(p), _) => within_roots(&state, Path::new(p))?,
        (None, Some(project)) => {
            let dir = work_dir(&app, project)?;
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir
        }
        (None, None) => home_dir(),
    };
    if !cwd.is_dir() {
        return Err("The folder does not exist.".into());
    }
    let pair = native_pty_system().openpty(size(options.cols, options.rows)).map_err(|e| format!("Could not open a terminal: {e}"))?;
    let cmd = shell_command(options.command.as_deref(), &cwd, &state.search_path);
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Could not start the shell: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    state.ptys.lock().unwrap().insert(id.clone(), PtyEntry { writer, master: pair.master, killer });

    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    let app_reader = app.clone();
    let id_reader = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_reader.emit_to("main", "pty-data", DataEvent { id: &id_reader, data });
                }
            }
        }
        let _ = done_tx.send(());
    });
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code() as i32);
        // Let the last output arrive before the exit is announced. A background job
        // that keeps the terminal open must not delay it for long.
        let _ = done_rx.recv_timeout(Duration::from_millis(700));
        app.state::<AppState>().ptys.lock().unwrap().remove(&id);
        let _ = app.emit_to("main", "pty-exit", ExitEvent { id: &id, code });
    });
    Ok(cwd.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let entry = ptys.get_mut(&id).ok_or("The terminal has closed.")?;
    entry.writer.write_all(data.as_bytes()).and_then(|_| entry.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(entry) = state.ptys.lock().unwrap().get(&id) {
        entry.master.resize(size(cols, rows)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: State<'_, AppState>, id: String) {
    if let Some(mut entry) = state.ptys.lock().unwrap().remove(&id) {
        let _ = entry.killer.kill();
    }
}

pub fn close_all(state: &AppState) {
    for (_, mut entry) in state.ptys.lock().unwrap().drain() {
        let _ = entry.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn a_command_runs_in_a_real_terminal() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let cwd = std::env::temp_dir();
        let cmd = shell_command(Some("printf 'bf-%s\\n' ok; test -t 1 && echo tty; exit 7"), &cwd, &std::env::var("PATH").unwrap_or_default());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let handle = std::thread::spawn(move || {
            let mut all = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                all.extend_from_slice(&buf[..n]);
            }
            String::from_utf8_lossy(&all).into_owned()
        });
        let status = child.wait().unwrap();
        drop(pair.master);
        let output = handle.join().unwrap();
        assert_eq!(status.exit_code(), 7);
        assert!(output.contains("bf-ok"), "output was: {output}");
        assert!(output.contains("tty"), "output was: {output}");
    }
}
