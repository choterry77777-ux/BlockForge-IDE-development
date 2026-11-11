//! Folders opened as a workspace. Every path the web view sends must resolve
//! inside a folder the user picked in the native folder dialog.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::files::pick_folder;
use crate::state::AppState;

const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ENTRIES: usize = 5000;
const RECENT_LIMIT: usize = 12;
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".gradle", ".dart_tool", "bin", "obj"];

#[derive(Serialize, Clone)]
pub struct Folder {
    path: String,
    name: String,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    dir: bool,
    size: u64,
}

#[derive(Serialize)]
pub struct ReadResult {
    text: Option<String>,
    binary: bool,
    size: u64,
}

#[derive(Serialize)]
pub struct Match {
    path: String,
    rel: String,
    line: usize,
    text: String,
}

fn folder_of(p: &Path) -> Folder {
    Folder { path: p.to_string_lossy().into_owned(), name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string_lossy().into_owned()) }
}

/// Resolve a path and require it to be inside one of the roots. A path that does
/// not exist yet is resolved through its parent, so symlinks cannot lead outside.
pub fn resolve_within(roots: &[PathBuf], raw: &Path) -> Result<PathBuf, String> {
    if !raw.is_absolute() || raw.to_string_lossy().contains('\0') {
        return Err("The path is not valid.".into());
    }
    let resolved = match raw.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = raw.parent().ok_or("The path is not valid.")?;
            let name = raw.file_name().ok_or("The path is not valid.")?;
            if name == ".." || name == "." {
                return Err("The path is not valid.".into());
            }
            parent.canonicalize().map_err(|_| "The folder does not exist.".to_string())?.join(name)
        }
    };
    if roots.iter().any(|r| resolved.starts_with(r)) {
        Ok(resolved)
    } else {
        Err("The path is outside the opened folder.".into())
    }
}

pub fn within_roots(state: &AppState, raw: &Path) -> Result<PathBuf, String> {
    let roots = state.roots.lock().unwrap().clone();
    resolve_within(&roots, raw)
}

fn recent_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("folders.json"))
}

/// The recent-folder list is kept by the backend, so only folders that were once
/// picked in a dialog can be reopened without asking again.
fn read_recent(app: &AppHandle) -> Vec<String> {
    recent_file(app).ok().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_recent(app: &AppHandle, list: &[String]) {
    if let Ok(f) = recent_file(app) {
        let _ = std::fs::write(f, serde_json::to_string(list).unwrap_or_else(|_| "[]".into()));
    }
}

fn remember(app: &AppHandle, state: &AppState, path: &Path) {
    let mut roots = state.roots.lock().unwrap();
    if !roots.iter().any(|r| r == path) {
        roots.push(path.to_path_buf());
    }
    drop(roots);
    let text = path.to_string_lossy().into_owned();
    let mut list = read_recent(app);
    list.retain(|p| p != &text);
    list.insert(0, text);
    list.truncate(RECENT_LIMIT);
    write_recent(app, &list);
}

#[tauri::command]
pub async fn folder_pick(app: AppHandle, state: State<'_, AppState>) -> Result<Option<Folder>, String> {
    let Some(picked) = pick_folder(&app).await else { return Ok(None) };
    let path = picked.canonicalize().map_err(|e| e.to_string())?;
    remember(&app, &state, &path);
    Ok(Some(folder_of(&path)))
}

#[tauri::command]
pub fn folder_recent(app: AppHandle) -> Vec<Folder> {
    read_recent(&app).iter().map(PathBuf::from).filter(|p| p.is_dir()).map(|p| folder_of(&p)).collect()
}

#[tauri::command]
pub fn folder_reopen(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<Folder, String> {
    // Reopening needs no dialog for a folder picked earlier, or one inside a folder that is open now.
    if !read_recent(&app).contains(&path) && within_roots(&state, Path::new(&path)).is_err() {
        return Err("Choose the folder with Open Folder first.".into());
    }
    let p = PathBuf::from(&path).canonicalize().map_err(|_| "The folder no longer exists.".to_string())?;
    if !p.is_dir() {
        return Err("The folder no longer exists.".into());
    }
    remember(&app, &state, &p);
    Ok(folder_of(&p))
}

#[tauri::command]
pub fn folder_forget(app: AppHandle, state: State<'_, AppState>, path: String) {
    let mut list = read_recent(&app);
    list.retain(|p| p != &path);
    write_recent(&app, &list);
    state.roots.lock().unwrap().retain(|r| r.to_string_lossy() != path);
}

#[tauri::command]
pub fn fs_list(state: State<'_, AppState>, path: String) -> Result<Vec<Entry>, String> {
    let dir = within_roots(&state, Path::new(&path))?;
    let mut out = Vec::new();
    for item in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if name == ".DS_Store" {
            continue;
        }
        // Follow links so a linked folder shows as a folder; opening it is still checked.
        let meta = std::fs::metadata(item.path()).or_else(|_| item.metadata());
        let Ok(meta) = meta else { continue };
        out.push(Entry { name, path: item.path().to_string_lossy().into_owned(), dir: meta.is_dir(), size: meta.len() });
        if out.len() >= MAX_ENTRIES {
            break;
        }
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub fn fs_read(state: State<'_, AppState>, path: String) -> Result<ReadResult, String> {
    let file = within_roots(&state, Path::new(&path))?;
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("This is not a file.".into());
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(ReadResult { text: None, binary: true, size: meta.len() });
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => Ok(ReadResult { text: Some(text), binary: false, size: meta.len() }),
        _ => Ok(ReadResult { text: None, binary: true, size: meta.len() }),
    }
}

#[tauri::command]
pub fn fs_write(state: State<'_, AppState>, path: String, text: String) -> Result<(), String> {
    let file = within_roots(&state, Path::new(&path))?;
    if file.is_dir() {
        return Err("A folder has this name.".into());
    }
    std::fs::write(&file, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create(state: State<'_, AppState>, path: String, dir: bool) -> Result<(), String> {
    let target = within_roots(&state, Path::new(&path))?;
    if target.exists() {
        return Err("Something with this name already exists.".into());
    }
    if dir {
        std::fs::create_dir(&target).map_err(|e| e.to_string())
    } else {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_rename(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    let roots = state.roots.lock().unwrap().clone();
    let src = resolve_within(&roots, Path::new(&from))?;
    let dst = resolve_within(&roots, Path::new(&to))?;
    if roots.iter().any(|r| r == &src) {
        return Err("The opened folder itself cannot be renamed here.".into());
    }
    if dst.exists() {
        return Err("Something with this name already exists.".into());
    }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// Deleting moves the item to the system Trash, so it can be recovered.
#[tauri::command]
pub fn fs_trash(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let roots = state.roots.lock().unwrap().clone();
    let target = resolve_within(&roots, Path::new(&path))?;
    if roots.iter().any(|r| r == &target) {
        return Err("The opened folder itself cannot be deleted here.".into());
    }
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        // NSFileManager needs no permission to control Finder.
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(&target).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_reveal(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let target = within_roots(&state, Path::new(&path))?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg("-R").arg(&target).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(format!("/select,{}", target.display())).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(target.parent().unwrap_or(&target)).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

pub fn search_dir(root: &Path, query: &str, max: usize) -> Vec<Match> {
    let needle = query.to_lowercase();
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(items) = std::fs::read_dir(&dir) else { continue };
        let mut items: Vec<_> = items.flatten().collect();
        items.sort_by_key(|i| i.file_name());
        for item in items {
            let name = item.file_name().to_string_lossy().into_owned();
            let Ok(kind) = item.file_type() else { continue };
            if kind.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(item.path());
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            visited += 1;
            if visited > 20_000 {
                return out;
            }
            let Ok(meta) = item.metadata() else { continue };
            if meta.len() > 1024 * 1024 {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(item.path()) else { continue };
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    let path = item.path();
                    out.push(Match { rel: path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), line: i + 1, text: line.trim().chars().take(200).collect() });
                    if out.len() >= max {
                        return out;
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
pub async fn fs_search(state: State<'_, AppState>, root: String, query: String, max: usize) -> Result<Vec<Match>, String> {
    let dir = within_roots(&state, Path::new(&root))?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let max = max.clamp(1, 500);
    tokio::task::spawn_blocking(move || search_dir(&dir, &query, max)).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bf-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn paths_must_stay_inside_the_opened_folder() {
        let root = temp("root");
        let outside = temp("outside");
        std::fs::write(root.join("a.txt"), "hi").unwrap();
        std::fs::write(outside.join("secret.txt"), "no").unwrap();
        let roots = vec![root.clone()];
        assert!(resolve_within(&roots, &root.join("a.txt")).is_ok());
        assert!(resolve_within(&roots, &root.join("new.txt")).is_ok());
        assert!(resolve_within(&roots, &outside.join("secret.txt")).is_err());
        assert!(resolve_within(&roots, &root.join("../").join(outside.file_name().unwrap()).join("secret.txt")).is_err());
        assert!(resolve_within(&roots, Path::new("relative.txt")).is_err());
        assert!(resolve_within(&roots, &root.join("missing").join("deep.txt")).is_err());
        // A link that points outside is followed and refused.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            assert!(resolve_within(&roots, &root.join("link").join("secret.txt")).is_err());
            assert!(resolve_within(&roots, &root.join("link").join("new.txt")).is_err());
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn search_finds_lines_and_skips_dependency_folders() {
        let root = temp("search");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/main.py"), "print('Hello')\nx = 1\nprint('hello again')\n").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "hello").unwrap();
        let found = search_dir(&root, "HELLO", 50);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].line, 1);
        assert_eq!(found[1].line, 3);
        assert!(found.iter().all(|m| m.rel.starts_with("src")));
        assert_eq!(search_dir(&root, "hello", 1).len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
