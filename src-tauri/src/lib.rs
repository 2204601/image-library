pub mod commands;
pub mod db;
pub mod formats;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            set_favorite,
            set_pinned,
            copy_items,
            export_items,
            reorder_in_folder,
            place_folder,
            shift_folder,
            sort_folders_by_name,
            list_smart_folders,
            create_smart_folder,
            update_smart_folder,
            delete_smart_folder,
            list_exts,
            import_paths,
            import_bytes,
            index_similar,
            dismiss_duplicates,
            undismiss_duplicates,
            clear_dismissed_duplicates,
            count_dismissed_duplicates,
            preview_duplicates,
            resolve_duplicates,
            supported_exts,
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_folder,
            move_to_folder,
            remove_from_folder,
            list_tags,
            add_tags,
            remove_tag,
            rename_tag,
            set_folder_color,
            set_smart_folder_color,
            set_tag_color,
            delete_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
