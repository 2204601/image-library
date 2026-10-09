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
    let builder = tauri::Builder::default();
    // macOS: "アップデートを確認…" in the app menu, under "About". Other
    // platforms keep no menu bar (the same item is in the sidebar's library menu).
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            use tauri::menu::{Menu, MenuItem, MenuItemKind};
            let menu = Menu::default(app)?;
            if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                let check = MenuItem::with_id(app, "check-update", "アップデートを確認…", true, None::<&str>)?;
                app_menu.insert(&check, 1)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            if event.id() == "check-update" {
                let _ = app.emit("check-update", ());
            }
        });
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            start_web_import(app.handle());
            start_mcp(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_last_library,
            create_library,
            open_library,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
