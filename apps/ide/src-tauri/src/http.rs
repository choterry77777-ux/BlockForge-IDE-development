//! HTTP for AI providers and package registries. Requests are made here, not in
//! the web view, so the API key never enters page memory and CORS does not apply.

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

use crate::paths::{check_url, origin_of, REGISTRY_HOSTS};
use crate::secrets;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct HttpRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    provider_id: String,
    scheme: String,
}

#[derive(Serialize)]
pub struct HttpHead {
    status: u16,
    headers: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
struct ChunkEvent<'a> {
    id: &'a str,
    data: String,
}

#[derive(Serialize, Clone)]
struct EndEvent<'a> {
    id: &'a str,
    error: Option<String>,
}

/// Headers the web view may not set: credentials are attached here, from the credential store.
const BLOCKED_HEADERS: &[&str] = &["authorization", "x-api-key", "api-key", "proxy-authorization", "cookie", "host", "content-length", "anthropic-dangerous-direct-browser-access"];

fn describe(e: reqwest::Error) -> String {
    let e = e.without_url();
    if e.is_timeout() {
        "The server did not answer in time.".into()
    } else if e.is_connect() {
        "Could not connect to the server. Check the address and your network connection.".into()
    } else {
        format!("The request failed: {e}")
    }
}

#[tauri::command]
pub async fn http_stream(app: AppHandle, state: State<'_, AppState>, id: String, request: HttpRequest) -> Result<HttpHead, String> {
    let with_secret = request.scheme != "none";
    // A key is never sent over plain http to another machine.
    let url = check_url(&request.url, !with_secret)?;
    let mut builder = match request.method.as_str() {
        "GET" => state.client.get(url.clone()),
        "POST" => state.client.post(url.clone()),
        other => return Err(format!("The method {other} is not allowed.")),
    };
    for (k, v) in &request.headers {
        if BLOCKED_HEADERS.contains(&k.to_ascii_lowercase().as_str()) {
            continue;
        }
        builder = builder.header(k, v);
    }
    if with_secret {
        let stored = secrets::load(&request.provider_id)?.ok_or("No API key is saved for this provider.")?;
        if stored.origin != origin_of(&url) {
            return Err("The saved API key belongs to a different server address. Save the key again for this address.".into());
        }
        builder = match request.scheme.as_str() {
            "bearer" => builder.bearer_auth(&stored.key),
            "x-api-key" => builder.header("x-api-key", &stored.key),
            other => return Err(format!("Unknown authentication scheme {other}.")),
        };
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let cancel = Arc::new(Notify::new());
    state.http.lock().unwrap().insert(id.clone(), cancel.clone());
    let sent = tokio::select! {
        r = builder.send() => Some(r),
        _ = cancel.notified() => None,
    };
    let resp = match sent {
        Some(Ok(r)) => r,
        Some(Err(e)) => {
            state.http.lock().unwrap().remove(&id);
            return Err(describe(e));
        }
        None => {
            state.http.lock().unwrap().remove(&id);
            return Err("aborted".into());
        }
    };
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(text) = v.to_str() {
            headers.insert(k.as_str().to_string(), text.to_string());
        }
    }

    tokio::spawn(async move {
        let mut stream = resp.bytes_stream();
        let mut error = None;
        loop {
            tokio::select! {
                _ = cancel.notified() => {
                    error = Some("aborted".to_string());
                    break;
                }
                chunk = stream.next() => match chunk {
                    Some(Ok(bytes)) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        let _ = app.emit_to("main", "http-chunk", ChunkEvent { id: &id, data });
                    }
                    Some(Err(e)) => {
                        error = Some(describe(e));
                        break;
                    }
                    None => break,
                }
            }
        }
        app.state::<AppState>().http.lock().unwrap().remove(&id);
        let _ = app.emit_to("main", "http-end", EndEvent { id: &id, error });
    });
    Ok(HttpHead { status, headers })
}

#[tauri::command]
pub fn http_cancel(state: State<'_, AppState>, id: String) {
    if let Some(n) = state.http.lock().unwrap().get(&id) {
        // notify_one stores a permit, so a task that is not waiting yet still sees it.
        n.notify_one();
    }
}

/// Read package metadata. Only the known registries can be contacted.
#[tauri::command]
pub async fn registry_get(state: State<'_, AppState>, url: String, headers: HashMap<String, String>) -> Result<String, String> {
    let u = check_url(&url, false)?;
    if u.scheme() != "https" || !REGISTRY_HOSTS.contains(&u.host_str().unwrap_or("")) {
        return Err("Only package registries can be queried.".into());
    }
    let mut builder = state.registry.get(u);
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("accept") {
            builder = builder.header("accept", v);
        }
    }
    let resp = builder.send().await.map_err(describe)?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(describe)?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("The registry answer is too large.".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
