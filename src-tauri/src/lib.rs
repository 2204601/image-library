pub mod commands;
pub mod db;
pub mod import;
pub mod library;
pub mod search;
pub mod similar;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_last_library,
            create_library,
            open_library,
            query_items,
            get_counts,
            selection_info,
            set_note,
            rename_item,
            trash_items,
            restore_items,
            delete_items,
            empty_trash,
            reveal_item,
            open_items,
            set_rating,
            copy_items,
            export_items,
            reorder_in_folder,
            import_paths,
            import_bytes,
            index_similar,
            resolve_duplicates,
            supported_exts,
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_folder,
            add_to_folder,
            remove_from_folder,
            list_tags,
            add_tags,
            remove_tag,
            rename_tag,
            delete_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
