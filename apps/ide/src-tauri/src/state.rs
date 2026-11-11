use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{mpsc, Notify};

pub struct ProcEntry {
    pub pid: u32,
    pub stdin: mpsc::UnboundedSender<Vec<u8>>,
    pub killed: Arc<AtomicBool>,
}

pub struct PtyEntry {
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

pub struct AppState {
    /// PATH used to find and run toolchains. A GUI app starts with a minimal PATH,
    /// so the login shell's PATH and common install locations are merged in.
    pub search_path: String,
    /// Executables found by detection; only these may be launched by full path.
    pub detected: Mutex<HashSet<PathBuf>>,
    pub procs: Mutex<HashMap<String, ProcEntry>>,
    pub http: Mutex<HashMap<String, Arc<Notify>>>,
    /// Files the user picked in a native dialog during this session.
    pub approved_files: Mutex<HashSet<PathBuf>>,
    /// Folders the user opened through the native folder dialog (canonical paths).
    pub roots: Mutex<Vec<PathBuf>>,
    pub ptys: Mutex<HashMap<String, PtyEntry>>,
    /// Client for AI providers. Redirects are refused so a key is never forwarded to another host.
    pub client: reqwest::Client,
    /// Client for package registry lookups (no secrets involved).
    pub registry: reqwest::Client,
}

fn login_shell_path() -> Option<String> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let out = std::process::Command::new(shell).args(["-lc", "printf '%s' \"$PATH\""]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output();
            let _ = tx.send(out.ok().and_then(|o| String::from_utf8(o.stdout).ok()));
        });
        // A slow or broken shell profile must not hold up start-up.
        rx.recv_timeout(Duration::from_secs(4)).ok().flatten().filter(|p| !p.trim().is_empty())
    }
    #[cfg(not(unix))]
    {
        None
    }
}

fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    #[cfg(unix)]
    {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/opt/rustup/bin", "/opt/homebrew/opt/openjdk/bin", "/usr/local/go/bin", "/opt/homebrew/opt/dart/libexec/bin", "/usr/local/share/dotnet", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    if let Some(h) = home {
        for d in [".cargo/bin", "go/bin", ".dotnet/tools", ".local/bin", ".pub-cache/bin"] {
            dirs.push(h.join(d));
        }
    }
    dirs
}

pub fn build_search_path() -> String {
    let mut seen = HashSet::new();
    let mut parts: Vec<PathBuf> = Vec::new();
    let mut add = |p: PathBuf| {
        if !p.as_os_str().is_empty() && seen.insert(p.clone()) {
            parts.push(p);
        }
    };
    if let Some(p) = login_shell_path() {
        for d in std::env::split_paths(&p) {
            add(d);
        }
    }
    if let Some(p) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&p) {
            add(d);
        }
    }
    for d in extra_dirs() {
        add(d);
    }
    std::env::join_paths(parts).ok().and_then(|s| s.into_string().ok()).unwrap_or_default()
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

/// Every place on the search path where an executable with this name exists.
pub fn which_all(search_path: &str, name: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for dir in std::env::split_paths(search_path) {
        #[cfg(windows)]
        let candidates = [format!("{name}.exe"), format!("{name}.cmd"), format!("{name}.bat"), name.to_string()];
        #[cfg(not(windows))]
        let candidates = [name.to_string()];
        for c in candidates {
            let p = dir.join(c);
            if is_executable(&p) && !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

impl AppState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).read_timeout(Duration::from_secs(300)).redirect(reqwest::redirect::Policy::none()).user_agent("blockforge-ide").build().expect("http client");
        let registry = reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(25)).user_agent("blockforge-ide").build().expect("http client");
        AppState {
            search_path: build_search_path(),
            detected: Mutex::new(HashSet::new()),
            procs: Mutex::new(HashMap::new()),
            http: Mutex::new(HashMap::new()),
            approved_files: Mutex::new(HashSet::new()),
            roots: Mutex::new(Vec::new()),
            ptys: Mutex::new(HashMap::new()),
            client,
            registry,
        }
    }
}
