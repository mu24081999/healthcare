mod commands;
mod db;
mod pull;
mod sync;

use commands::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = db::app_db_path()?;
            let pool = db::init_pool(path)?;
            {
                let mut conn = db::get_conn(&pool)?;
                db::migrate(&mut conn)?;
                db::seed_users_if_empty(&mut conn)?;
                db::ensure_superadmin_user(&mut conn)?;
            }
            
            let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(100);

            let pool_clone = pool.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Live multi-user sync: poll often; local saves trigger immediately.
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_millis(1000));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                let mut was_online = false;

                loop {
                    let mut from_local_write = false;
                    tokio::select! {
                        maybe_trigger = rx.recv() => {
                            if maybe_trigger.is_none() {
                                break;
                            }
                            // Tiny debounce so rapid local edits batch, then sync ASAP.
                            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                            while rx.try_recv().is_ok() {}
                            from_local_write = true;
                        }
                        _ = interval.tick() => {}
                    }

                    // Only flash "Syncing…" for local saves or when reconnecting.
                    if from_local_write || !was_online {
                        let _ = app_handle.emit("sync-status", "syncing");
                    }

                    match sync::sync_bidirectional(&pool_clone, from_local_write).await {
                        Ok(result) => {
                            if !was_online {
                                println!("MongoDB connection restored — full sync completed");
                            }
                            was_online = true;
                            let _ = app_handle.emit("sync-status", "online");
                            // Always refresh UI after sync (silent).
                            let _ = app_handle.emit("sync-complete", ());
                            // Silent live notification when cloud data changed this device.
                            if result.pulled > 0 || result.deleted > 0 {
                                let _ = app_handle.emit(
                                    "sync-remote-update",
                                    serde_json::json!({
                                        "pulled": result.pulled,
                                        "deleted": result.deleted,
                                        "pushed": result.pushed,
                                    }),
                                );
                            }
                        }
                        Err(e) => {
                            if was_online {
                                eprintln!("MongoDB sync lost connection: {}", e);
                            } else {
                                eprintln!("MongoDB sync offline/failed: {}", e);
                            }
                            was_online = false;
                            let _ = app_handle.emit("sync-status", "offline");
                        }
                    }
                }
            });

            app.manage(AppState {
                pool,
                session: Mutex::new(None),
                sync_trigger: tx,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sync_db,
            commands::sync_force_catchup,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_session,
            commands::pets_list,
            commands::pets_get,
            commands::pets_create,
            commands::pets_update,
            commands::pets_delete,
            commands::medical_list,
            commands::medical_add,
            commands::medical_update,
            commands::medical_delete,
            commands::vaccinations_list,
            commands::vaccinations_upsert,
            commands::vaccinations_delete,
            commands::hospitalizations_list,
            commands::hospitalizations_upsert,
            commands::hospitalizations_delete,
            commands::clinic_get,
            commands::clinic_update,
            commands::grooming_list,
            commands::grooming_add,
            commands::grooming_update,
            commands::grooming_delete,
            commands::lab_tests_list,
            commands::lab_tests_list_all,
            commands::lab_test_create,
            commands::lab_test_update,
            commands::lab_test_delete,
            commands::lab_analytes_list,
            commands::lab_analyte_upsert,
            commands::lab_analyte_delete,
            commands::lab_order_create,
            commands::lab_orders_for_pet,
            commands::lab_order_delete,
            commands::lab_result_save,
            commands::lab_result_get,
            commands::lab_results_history,
            commands::lab_results_for_history,
            commands::lab_result_update,
            commands::dashboard_vaccination_reminders,
            commands::opd_requests_list,
            commands::opd_request_create,
            commands::opd_request_claim,
            commands::opd_request_delete,
            commands::opd_consultations_list,
            commands::opd_consultation_create,
            commands::opd_consultation_update,
            commands::opd_consultation_delete,
            commands::opd_request_reopen,
            commands::opd_dashboard_summary,
            commands::opd_catalog_list,
            commands::opd_catalog_create,
            commands::opd_catalog_delete,
            commands::opd_catalog_rename,
            commands::users_list,
            commands::users_create,
            commands::users_set_active,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
