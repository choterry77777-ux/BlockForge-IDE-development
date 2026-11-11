//! Path and name validation shared by the commands. Everything the web view
//! sends is treated as untrusted input.

use std::path::{Component, Path, PathBuf};

/// Executable names the backend may launch. Mirrors the toolchain table of the
/// TypeScript core (`ALLOWED_EXECUTABLES`); a test in the repository compares the two.
pub const ALLOWED_EXECUTABLES: &[&str] = &[
    "python3", "python", "node", "tsc", "clang", "gcc", "cc", "clang++", "g++", "c++", "javac", "java", "dotnet", "lua", "lua5.4", "luajit", "php", "go", "rustc", "cargo", "sqlite3", "dart", "ruby", "kotlinc", "bash", "npm", "composer", "gem", "mvn", "gradle",
];

/// Hosts that may be contacted for package metadata.
pub const REGISTRY_HOSTS: &[&str] = &["pypi.org", "registry.npmjs.org", "crates.io", "proxy.golang.org", "azuresearch-usnc.nuget.org", "search.maven.org", "packagist.org", "rubygems.org", "pub.dev"];

pub fn is_allowed_executable(name: &str) -> bool {
    let stem = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".cmd")).or_else(|| name.strip_suffix(".bat")).unwrap_or(name);
    ALLOWED_EXECUTABLES.contains(&stem)
}

/// Project ids are used as directory names.
pub fn valid_project_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A relative path that stays inside its base directory.
pub fn safe_relative(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.len() > 240 || path.contains('\0') {
        return None;
    }
    let p = Path::new(path);
    if p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Only http(s) URLs are ever opened or fetched; plain http is limited to this machine.
pub fn check_url(raw: &str, allow_remote_http: bool) -> Result<url::Url, String> {
    let u = url::Url::parse(raw).map_err(|_| "The address is not a valid URL.".to_string())?;
    let host = u.host_str().unwrap_or("").to_string();
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1";
    match u.scheme() {
        "https" => Ok(u),
        "http" if local || allow_remote_http => Ok(u),
        "http" => Err("Plain http is only allowed for this computer (localhost).".to_string()),
        other => Err(format!("The scheme \"{other}\" is not allowed.")),
    }
}

pub fn origin_of(u: &url::Url) -> String {
    u.origin().ascii_serialization()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_list_is_strict() {
        assert!(is_allowed_executable("python3"));
        assert!(is_allowed_executable("clang++"));
        assert!(is_allowed_executable("node.exe"));
        assert!(!is_allowed_executable("sh"));
        assert!(!is_allowed_executable("rm"));
        assert!(!is_allowed_executable("curl"));
        assert!(!is_allowed_executable("/bin/sh"));
        assert!(!is_allowed_executable("python3 -c x"));
    }

    #[test]
    fn project_ids_are_plain() {
        assert!(valid_project_id("aB3_x-9"));
        assert!(!valid_project_id(""));
        assert!(!valid_project_id("../x"));
        assert!(!valid_project_id("a/b"));
        assert!(!valid_project_id(&"x".repeat(65)));
    }

    #[test]
    fn relative_paths_cannot_escape() {
        assert_eq!(safe_relative("main.py"), Some(PathBuf::from("main.py")));
        assert_eq!(safe_relative("./build/main"), Some(PathBuf::from("build/main")));
        assert_eq!(safe_relative("a/b/c.txt"), Some(PathBuf::from("a/b/c.txt")));
        assert_eq!(safe_relative("../secret"), None);
        assert_eq!(safe_relative("a/../../b"), None);
        assert_eq!(safe_relative("/etc/passwd"), None);
        assert_eq!(safe_relative(""), None);
        assert_eq!(safe_relative("a\0b"), None);
    }

    #[test]
    fn urls_are_limited_to_http() {
        assert!(check_url("https://api.anthropic.com/v1/messages", false).is_ok());
        assert!(check_url("http://localhost:11434/v1/chat/completions", false).is_ok());
        assert!(check_url("http://127.0.0.1:8080/", false).is_ok());
        assert!(check_url("http://example.com/", false).is_err());
        assert!(check_url("http://example.com/", true).is_ok());
        assert!(check_url("file:///etc/passwd", true).is_err());
        assert!(check_url("javascript:alert(1)", true).is_err());
        assert!(check_url("not a url", true).is_err());
    }

    #[test]
    fn origins_ignore_paths() {
        let a = check_url("https://api.deepseek.com/chat/completions", false).unwrap();
        let b = check_url("https://api.deepseek.com/beta/completions?x=1", false).unwrap();
        let c = check_url("https://evil.example/api.deepseek.com", false).unwrap();
        assert_eq!(origin_of(&a), origin_of(&b));
        assert_ne!(origin_of(&a), origin_of(&c));
    }
}
