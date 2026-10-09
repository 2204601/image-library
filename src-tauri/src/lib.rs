pub mod changes;
pub mod commands;
pub mod db;
pub mod files;
pub mod fonts;
pub mod formats;
pub mod import;
pub mod library;
pub mod loopback;
pub mod mcp;
pub mod orient;
pub mod proxy;
pub mod search;
pub mod sheet;
pub mod similar;
pub mod transfer;
pub mod webimport;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The menu bar is made by the frontend from its command table
    // (src/lib/menuBar.ts); until it loads, macOS shows Tauri's default menu.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            start_web_import(app.handle());
            start_lock_refresh(app.handle());
            start_mcp(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_last_library,
            create_library,
            open_library,
            get_app_settings,
            set_app_settings,
            get_library_settings,
            set_library_setting,
            library_size,
            list_libraries,
            set_library_favorite,
            forget_library,
            transfer_items,
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
            orient_items,
            system_proxy,
            fonts::commands::font_info,
            fonts::commands::font_faces,
            fonts::commands::font_list_preview,
            fonts::commands::index_fonts,
            fonts::commands::set_font_category,
            fonts::commands::font_data,
            copy_items,
            export_items,
            add_to_tray,
            remove_from_tray,
            clear_tray,
            reorder_tray,
            sheet_image,
            save_file,
            copy_image,
            reveal_path,
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
            web_import_status,
            set_web_import,
            reset_web_import_token,
            install_extension,
            answer_web_pair,
            mcp_status,
            set_mcp,
            reset_mcp_token,
            list_changes,
            undo_change,
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Close the library before quitting: library.db complete on its
            // own (for cloud sync) and the lock removed.
            if let tauri::RunEvent::Exit = event {
                close_library(app);
            }
        });
}
