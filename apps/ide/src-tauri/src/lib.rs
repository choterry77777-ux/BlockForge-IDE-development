//! BlockForge desktop backend. The web view holds the interface; everything that
//! touches the machine (toolchains, files, the credential store, the network for
//! AI providers, terminals) goes through the commands registered here.

mod browser;
mod files;
mod http;
mod paths;
mod process;
mod pty;
mod secrets;
mod state;
mod toolchains;
mod workspace;

use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            toolchains::host_info,
            toolchains::detect_toolchains,
            process::work_write,
            process::work_clean,
            process::work_reveal,
            process::proc_spawn,
            process::proc_write,
            process::proc_kill,
            secrets::secret_set,
            secrets::secret_has,
            secrets::secret_delete,
            http::http_stream,
            http::http_cancel,
            http::registry_get,
            files::file_open,
            files::file_save,
            files::file_save_binary,
            files::open_external,
            workspace::folder_pick,
            workspace::folder_recent,
            workspace::folder_reopen,
            workspace::folder_forget,
            workspace::fs_list,
            workspace::fs_read,
            workspace::fs_write,
            workspace::fs_create,
            workspace::fs_rename,
            workspace::fs_trash,
            workspace::fs_reveal,
            workspace::fs_search,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_bounds,
            browser::browser_visible,
            browser::browser_eval,
            browser::browser_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting BlockForge");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Nothing started by the app outlives it.
            let state = handle.state::<state::AppState>();
            pty::close_all(&state);
            process::kill_all(&state);
        }
    });
}
