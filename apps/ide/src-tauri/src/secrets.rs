//! API keys live in the operating system's credential store. The web view can
//! save, delete and ask whether a key exists; it can never read one back.

use serde::{Deserialize, Serialize};

use crate::paths::{check_url, origin_of, valid_project_id};

const SERVICE: &str = "dev.blockforge.ide";

#[derive(Serialize, Deserialize)]
pub struct Stored {
    pub key: String,
    /// The server origin the key was saved for. It is only ever sent there.
    pub origin: String,
}

fn entry(provider_id: &str) -> Result<keyring::Entry, String> {
    // Provider ids follow the same plain-name rule as project ids.
    if !valid_project_id(provider_id) {
        return Err("Invalid provider id.".into());
    }
    keyring::Entry::new(SERVICE, &format!("provider:{provider_id}")).map_err(|e| format!("The credential store is not available: {e}"))
}

pub fn load(provider_id: &str) -> Result<Option<Stored>, String> {
    match entry(provider_id)?.get_password() {
        Ok(text) => Ok(serde_json::from_str(&text).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("The credential store could not be read: {e}")),
    }
}

#[tauri::command]
pub fn secret_set(provider_id: String, value: String, origin: String) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 4096 || value.chars().any(|c| c.is_control()) {
        return Err("The key is empty or not valid.".into());
    }
    // A key may be bound to a plain-http address only on this computer.
    let url = check_url(&origin, false)?;
    let stored = Stored { key: value.to_string(), origin: origin_of(&url) };
    let text = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    entry(&provider_id)?.set_password(&text).map_err(|e| format!("The key could not be saved: {e}"))
}

#[tauri::command]
pub fn secret_has(provider_id: String) -> Result<bool, String> {
    Ok(load(&provider_id)?.is_some())
}

#[tauri::command]
pub fn secret_delete(provider_id: String) -> Result<(), String> {
    match entry(&provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("The key could not be removed: {e}")),
    }
}
