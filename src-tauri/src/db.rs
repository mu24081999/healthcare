use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::fs;
use std::path::PathBuf;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn app_db_path() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "Could not resolve application data directory".to_string())?
        .join("PetCareClinic");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pet_care.sqlite"))
}

pub fn init_pool(db_path: PathBuf) -> Result<DbPool, String> {
    let manager = SqliteConnectionManager::file(db_path);
    Pool::builder()
        .build(manager)
        .map_err(|e| e.to_string())
}

pub fn migrate(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS pets (
            id TEXT PRIMARY KEY,
            card_id TEXT UNIQUE,
            name TEXT NOT NULL,
            species TEXT,
            breed TEXT,
            age TEXT,
            sex TEXT,
            weight TEXT,
            vaccine_status TEXT,
            deworming_status TEXT,
            owner_name TEXT,
            owner_phone TEXT,
            owner_address TEXT,
            owner_email TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS medical_history_entries (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            entry_type TEXT NOT NULL,
            title TEXT,
            body TEXT,
            administered_date TEXT,
            next_due_date TEXT,
            reminder_days_before INTEGER DEFAULT 7,
            external_file_path TEXT,
            lab_result_id TEXT,
            created_at TEXT NOT NULL,
            body_weight TEXT
        );

        CREATE TABLE IF NOT EXISTS vaccinations (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            vaccine_name TEXT NOT NULL,
            administered_date TEXT,
            next_due_date TEXT,
            reminder_days_before INTEGER DEFAULT 7,
            notes TEXT,
            created_at TEXT NOT NULL,
            body_weight TEXT
        );

        CREATE TABLE IF NOT EXISTS grooming_events (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            service_type TEXT NOT NULL,
            administered_date TEXT,
            next_due_date TEXT,
            reminder_days_before INTEGER DEFAULT 7,
            performed_date TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            body_weight TEXT
        );

        CREATE TABLE IF NOT EXISTS hospitalizations (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            cage_number TEXT NOT NULL,
            check_in_date TEXT NOT NULL,
            check_out_date TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clinics (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            timing TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            logo TEXT
        );

        CREATE TABLE IF NOT EXISTS lab_tests (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            code TEXT,
            default_report_hours INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lab_analytes (
            id TEXT PRIMARY KEY,
            lab_test_id TEXT NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            unit TEXT,
            normal_min REAL,
            normal_max REAL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            remarks TEXT
        );

        CREATE TABLE IF NOT EXISTS lab_orders (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id),
            lab_test_id TEXT NOT NULL REFERENCES lab_tests(id),
            receipt_number TEXT UNIQUE,
            tentative_report_at TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lab_results (
            id TEXT PRIMARY KEY,
            lab_order_id TEXT NOT NULL REFERENCES lab_orders(id),
            pet_id TEXT NOT NULL,
            lab_test_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS lab_result_values (
            id TEXT PRIMARY KEY,
            lab_result_id TEXT NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
            analyte_id TEXT NOT NULL,
            analyte_name TEXT NOT NULL,
            unit TEXT,
            normal_min REAL,
            normal_max REAL,
            observed_value TEXT NOT NULL,
            remarks TEXT
        );

        CREATE TABLE IF NOT EXISTS opd_requests (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            requested_by_user_id TEXT NOT NULL,
            requested_by_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            assigned_vet_id TEXT,
            assigned_vet_name TEXT,
            created_at TEXT NOT NULL,
            claimed_at TEXT,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS opd_consultations (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE REFERENCES opd_requests(id) ON DELETE CASCADE,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            vet_id TEXT NOT NULL REFERENCES users(id),
            vet_name TEXT NOT NULL,
            doctor_signature_name TEXT NOT NULL,
            temperature TEXT,
            physical_exam TEXT,
            history_observations TEXT,
            dx_items TEXT,
            ddx_items TEXT,
            diagnosis_note TEXT,
            differential_diagnosis_note TEXT,
            symptoms TEXT,
            recommended_lab_test_ids TEXT,
            recommended_lab_test_names TEXT,
            custom_lab_tests TEXT,
            medicines_json TEXT,
            clinical_treatment_remark TEXT,
            in_house_prescription TEXT,
            recommended_food TEXT,
            next_visit_at TEXT,
            created_at TEXT NOT NULL,
            body_weight TEXT,
            vaccinated INTEGER NOT NULL DEFAULT 0,
            deworming INTEGER NOT NULL DEFAULT 0,
            prognosis TEXT
        );

        CREATE TABLE IF NOT EXISTS opd_catalog_items (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_medical_pet ON medical_history_entries(pet_id);
        CREATE INDEX IF NOT EXISTS idx_vax_pet ON vaccinations(pet_id);
        CREATE INDEX IF NOT EXISTS idx_groom_pet ON grooming_events(pet_id);
        CREATE INDEX IF NOT EXISTS idx_lab_order_pet ON lab_orders(pet_id);
        CREATE INDEX IF NOT EXISTS idx_opd_request_pet ON opd_requests(pet_id);
        CREATE INDEX IF NOT EXISTS idx_opd_request_status ON opd_requests(status);
        CREATE INDEX IF NOT EXISTS idx_opd_consultation_pet ON opd_consultations(pet_id);
        CREATE INDEX IF NOT EXISTS idx_opd_consultation_next_visit ON opd_consultations(next_visit_at);
        CREATE INDEX IF NOT EXISTS idx_opd_catalog_type ON opd_catalog_items(type);

        CREATE TABLE IF NOT EXISTS pending_deletes (
            collection TEXT NOT NULL,
            record_id TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            PRIMARY KEY (collection, record_id)
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    ensure_users_active_column(conn)?;
    ensure_pet_card_id_column(conn)?;
    ensure_pet_profile_columns(conn)?;
    ensure_medical_history_columns(conn)?;
    ensure_grooming_columns(conn)?;
    ensure_hospitalization_table(conn)?;
    ensure_clinic_table(conn)?;
    ensure_opd_consultation_columns(conn)?;
    ensure_opd_updated_at_columns(conn)?;
    ensure_vax_medical_updated_at_columns(conn)?;
    ensure_case_updated_at_columns(conn)?;
    ensure_meta_updated_at_columns(conn)?;
    ensure_lab_analytes_columns(conn)?;
    migrate_lab_result_values(conn)?;
    ensure_bodyweight_columns(conn)?;
    migrate_user_roles(conn)?;
    sync_legacy_staff_logins(conn)?;
    ensure_pending_deletes_table(conn)?;
    ensure_sync_fast_path(conn)?;
    Ok(())
}

fn ensure_pending_deletes_table(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS pending_deletes (
            collection TEXT NOT NULL,
            record_id TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            PRIMARY KEY (collection, record_id)
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

/// Dirty-row + pull-cursor tables so sync can push/pull only what changed.
fn ensure_sync_fast_path(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_dirty (
            collection TEXT NOT NULL,
            record_id TEXT NOT NULL,
            PRIMARY KEY (collection, record_id)
        );
        "#,
    )
    .map_err(|e| e.to_string())?;

    let tables = [
        "users",
        "pets",
        "medical_history_entries",
        "vaccinations",
        "grooming_events",
        "hospitalizations",
        "clinics",
        "lab_tests",
        "lab_analytes",
        "lab_orders",
        "lab_results",
        "opd_requests",
        "opd_consultations",
        "opd_catalog_items",
    ];

    // Every local write is queued for upload, unconditionally. These triggers used to
    // skip queueing whenever a pull was in progress, so a pet or prescription saved
    // during the ~1s sync cycle was never uploaded and stayed on that device forever.
    // The pull now snapshots and restores the queue itself (see pull.rs) instead.
    for table in tables {
        let ai = format!("{table}_sync_dirty_ai");
        let au = format!("{table}_sync_dirty_au");
        // Recreate so older guarded trigger bodies are replaced.
        let _ = conn.execute(&format!("DROP TRIGGER IF EXISTS {ai}"), []);
        let _ = conn.execute(&format!("DROP TRIGGER IF EXISTS {au}"), []);
        for (name, event) in [(&ai, "INSERT"), (&au, "UPDATE")] {
            conn.execute(
                &format!(
                    "CREATE TRIGGER IF NOT EXISTS {name} AFTER {event} ON {table}
                     BEGIN
                       INSERT OR IGNORE INTO sync_dirty(collection, record_id)
                       VALUES ('{table}', NEW.id);
                     END;"
                ),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Leftover from the old sticky-flag scheme; a stuck value must not linger.
    let _ = conn.execute(
        "DELETE FROM sync_state WHERE key IN ('pulling', 'pull_suppress_until')",
        [],
    );

    // One-time repair after OPD reopen / case LWW fixes: re-queue local rows and
    // clear the pull cursor so every device re-merges cloud pets, OPD, and case data.
    let reseeded: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_state WHERE key = 'dirty_reseed_v7'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if reseeded == 0 {
        for table in tables {
            conn.execute(
                &format!(
                    "INSERT OR IGNORE INTO sync_dirty(collection, record_id)
                     SELECT '{table}', id FROM {table}"
                ),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        let _ = conn.execute("DELETE FROM sync_state WHERE key = 'pull_cursor'", []);
        conn.execute(
            "INSERT OR REPLACE INTO sync_state(key, value) VALUES ('dirty_reseed_v7', '1')",
            [],
        )
        .map_err(|e| e.to_string())?;
        println!("Sync repair: re-queued all local rows and reset pull cursor (v7)");
    }

    // One-time repair for rows the old trigger guard never queued: re-queue every local
    // row and clear the cursor so this device both uploads and re-downloads everything
    // once. Heals pets and prescriptions that were only ever saved on one device.
    let reseeded_v6: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_state WHERE key = 'dirty_reseed_v6'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if reseeded_v6 == 0 {
        for table in tables {
            conn.execute(
                &format!(
                    "INSERT OR IGNORE INTO sync_dirty(collection, record_id)
                     SELECT '{table}', id FROM {table}"
                ),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        let _ = conn.execute("DELETE FROM sync_state WHERE key = 'pull_cursor'", []);
        conn.execute(
            "INSERT OR REPLACE INTO sync_state(key, value) VALUES ('dirty_reseed_v6', '1')",
            [],
        )
        .map_err(|e| e.to_string())?;
        println!("Sync repair: re-queued all local rows and reset pull cursor (v6)");
    }

    Ok(())
}

pub fn sync_state_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM sync_state WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

pub fn sync_state_set(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn dirty_ids(conn: &rusqlite::Connection, collection: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT record_id FROM sync_dirty WHERE collection = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![collection], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

pub fn clear_dirty(
    conn: &rusqlite::Connection,
    collection: &str,
    record_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM sync_dirty WHERE collection = ?1 AND record_id = ?2",
        params![collection, record_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Always queue a row for upload, even when sync triggers are suppressed during pull.
pub fn mark_dirty(
    conn: &rusqlite::Connection,
    collection: &str,
    record_id: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO sync_dirty(collection, record_id) VALUES (?1, ?2)",
        params![collection, record_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Queue a remote delete so it still syncs after offline edits.
pub fn queue_remote_delete(
    conn: &rusqlite::Connection,
    collection: &str,
    record_id: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO pending_deletes (collection, record_id, deleted_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(collection, record_id) DO UPDATE SET deleted_at = excluded.deleted_at",
        params![collection, record_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pending_delete_ids(
    conn: &rusqlite::Connection,
    collection: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT record_id FROM pending_deletes WHERE collection = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![collection], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

fn ensure_bodyweight_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let ensure_col =
        |table: &str, name: &str, sql_type: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
            let n: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1", table),
                    params![name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if n == 0 {
                conn.execute(&format!("ALTER TABLE {} ADD COLUMN {} {}", table, name, sql_type), [])
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        };
    ensure_col("medical_history_entries", "body_weight", "TEXT", conn)?;
    ensure_col("vaccinations", "body_weight", "TEXT", conn)?;
    ensure_col("grooming_events", "body_weight", "TEXT", conn)?;
    ensure_col("opd_consultations", "body_weight", "TEXT", conn)?;
    Ok(())
}

fn ensure_pet_profile_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let ensure_col =
        |name: &str, sql_type: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('pets') WHERE name = ?1",
                    params![name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if n == 0 {
                conn.execute(&format!("ALTER TABLE pets ADD COLUMN {} {}", name, sql_type), [])
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        };
    ensure_col("age", "TEXT", conn)?;
    ensure_col("date_of_birth", "TEXT", conn)?;
    ensure_col("sex", "TEXT", conn)?;
    ensure_col("weight", "TEXT", conn)?;
    ensure_col("vaccine_status", "TEXT", conn)?;
    ensure_col("deworming_status", "TEXT", conn)?;
    ensure_col("owner_address", "TEXT", conn)?;
    Ok(())
}

fn ensure_medical_history_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let ensure_col =
        |name: &str, sql_type: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('medical_history_entries') WHERE name = ?1",
                    params![name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if n == 0 {
                conn.execute(
                    &format!("ALTER TABLE medical_history_entries ADD COLUMN {} {}", name, sql_type),
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        };
    ensure_col("administered_date", "TEXT", conn)?;
    ensure_col("next_due_date", "TEXT", conn)?;
    ensure_col("reminder_days_before", "INTEGER DEFAULT 7", conn)?;
    ensure_col("dx_items", "TEXT", conn)?;
    ensure_col("ddx_items", "TEXT", conn)?;
    ensure_col("dx_note", "TEXT", conn)?;
    ensure_col("ddx_note", "TEXT", conn)?;
    ensure_col("external_file_paths", "TEXT", conn)?;
    Ok(())
}

fn ensure_grooming_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let ensure_col =
        |name: &str, sql_type: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('grooming_events') WHERE name = ?1",
                    params![name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if n == 0 {
                conn.execute(
                    &format!("ALTER TABLE grooming_events ADD COLUMN {} {}", name, sql_type),
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        };
    ensure_col("administered_date", "TEXT", conn)?;
    ensure_col("next_due_date", "TEXT", conn)?;
    ensure_col("reminder_days_before", "INTEGER DEFAULT 7", conn)?;
    Ok(())
}

fn ensure_hospitalization_table(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS hospitalizations (
            id TEXT PRIMARY KEY,
            pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
            cage_number TEXT NOT NULL,
            check_in_date TEXT NOT NULL,
            check_out_date TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hospitalizations_pet ON hospitalizations(pet_id);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_clinic_table(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS clinics (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            timing TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            logo TEXT
        );
        "#,
    )
    .map_err(|e| e.to_string())?;

    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clinics') WHERE name = 'logo'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        conn.execute("ALTER TABLE clinics ADD COLUMN logo TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_opd_consultation_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let ensure_col = |name: &str, sql_type: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('opd_consultations') WHERE name = ?1",
                params![name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n == 0 {
            conn.execute(
                &format!("ALTER TABLE opd_consultations ADD COLUMN {} {}", name, sql_type),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    ensure_col("temperature", "TEXT", conn)?;
    ensure_col("history_observations", "TEXT", conn)?;
    ensure_col("dx_items", "TEXT", conn)?;
    ensure_col("ddx_items", "TEXT", conn)?;
    ensure_col("clinical_treatment_remark", "TEXT", conn)?;
    ensure_col("physical_exam", "TEXT", conn)?;
    ensure_col("in_house_prescription", "TEXT", conn)?;
    ensure_col("vaccinated", "INTEGER NOT NULL DEFAULT 0", conn)?;
    ensure_col("deworming", "INTEGER NOT NULL DEFAULT 0", conn)?;
    ensure_col("prognosis", "TEXT", conn)?;
    Ok(())
}

/// Last-write-wins timestamps for offline multi-device OPD edits.
fn ensure_opd_updated_at_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let add_col = |table: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
        let n: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at'"),
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n == 0 {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    add_col("opd_requests", conn)?;
    add_col("opd_consultations", conn)?;

    conn.execute(
        "UPDATE opd_requests
         SET updated_at = COALESCE(completed_at, claimed_at, created_at)
         WHERE updated_at IS NULL OR updated_at = ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE opd_consultations
         SET updated_at = created_at
         WHERE updated_at IS NULL OR updated_at = ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// LWW timestamps so vaccination / deworming edits survive multi-device sync.
fn ensure_vax_medical_updated_at_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let add_col = |table: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
        let n: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at'"
                ),
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n == 0 {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    add_col("vaccinations", conn)?;
    add_col("medical_history_entries", conn)?;

    conn.execute(
        "UPDATE vaccinations
         SET updated_at = created_at
         WHERE updated_at IS NULL OR updated_at = ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE medical_history_entries
         SET updated_at = created_at
         WHERE updated_at IS NULL OR updated_at = ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// LWW timestamps for pet-case rows that previously had none (edits were lost on sync).
fn ensure_case_updated_at_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let add_col = |table: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
        let n: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at'"
                ),
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n == 0 {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    add_col("grooming_events", conn)?;
    add_col("hospitalizations", conn)?;
    add_col("lab_orders", conn)?;
    add_col("lab_results", conn)?;

    for (table, fallback) in [
        ("grooming_events", "created_at"),
        ("hospitalizations", "created_at"),
        ("lab_orders", "created_at"),
        ("lab_results", "created_at"),
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET updated_at = {fallback}
                 WHERE updated_at IS NULL OR updated_at = ''"
            ),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// LWW timestamps for catalog / users / lab-meta rows (previously created_at-only).
fn ensure_meta_updated_at_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let add_col = |table: &str, conn: &mut rusqlite::Connection| -> Result<(), String> {
        let n: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = 'updated_at'"
                ),
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if n == 0 {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    };
    add_col("users", conn)?;
    add_col("lab_tests", conn)?;
    add_col("lab_analytes", conn)?;
    add_col("opd_catalog_items", conn)?;

    for (table, fallback) in [
        ("users", "created_at"),
        ("lab_tests", "created_at"),
        ("opd_catalog_items", "created_at"),
    ] {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET updated_at = {fallback}
                 WHERE updated_at IS NULL OR updated_at = ''"
            ),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    // lab_analytes have no created_at — leave null until first edit/pull.
    Ok(())
}

fn ensure_users_active_column(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'active'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        conn.execute(
            "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_pet_card_id_column(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('pets') WHERE name = 'card_id'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        conn.execute("ALTER TABLE pets ADD COLUMN card_id TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE pets SET card_id = 'PET-' || UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 10)) WHERE card_id IS NULL OR card_id = ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pets_card_id ON pets(card_id)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn sync_legacy_staff_logins(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let manager_taken: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'manager'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let admin_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'admin'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if admin_left > 0 && manager_taken == 0 {
        let hash = bcrypt::hash("manager", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE users SET username = 'manager', password_hash = ?1, display_name = 'Clinic manager', role = 'manager' WHERE username = 'admin'",
            params![hash],
        )
        .map_err(|e| e.to_string())?;
    }

    let vet_taken: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'vet'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let attender_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'attender'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if attender_left > 0 && vet_taken == 0 {
        let hash = bcrypt::hash("vet", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE users SET username = 'vet', password_hash = ?1, display_name = 'Veterinarian', role = 'vet' WHERE username = 'attender'",
            params![hash],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate_user_roles(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    if sql.contains("'admin', 'attender'") {
        conn.execute_batch(
            r#"
            CREATE TABLE users_new (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO users_new SELECT id, username, password_hash, display_name,
                CASE role WHEN 'admin' THEN 'manager' WHEN 'attender' THEN 'vet' ELSE role END,
                created_at,
                COALESCE(active, 1) FROM users;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
            "#,
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE users SET role = 'manager' WHERE role = 'admin'",
            [],
        )
        .ok();
        conn.execute(
            "UPDATE users SET role = 'vet' WHERE role = 'attender'",
            [],
        )
        .ok();
    }
    Ok(())
}

/// Stable seed IDs so empty installs do not push duplicate usernames to Mongo.
const SEED_SUPERADMIN_ID: &str = "00000000-0000-4000-8000-000000000001";
const SEED_MANAGER_ID: &str = "00000000-0000-4000-8000-000000000002";
const SEED_VET_ID: &str = "00000000-0000-4000-8000-000000000003";

pub fn seed_users_if_empty(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok(());
    }
    let now = crate::sync::approx_server_now();
    let hash_s = bcrypt::hash("superadmin", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6)",
        params![SEED_SUPERADMIN_ID, "superadmin", hash_s, "Super administrator", "superadmin", now],
    )
    .map_err(|e| e.to_string())?;
    let hash_m = bcrypt::hash("manager", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6)",
        params![SEED_MANAGER_ID, "manager", hash_m, "Clinic manager", "manager", now],
    )
    .map_err(|e| e.to_string())?;
    let hash_v = bcrypt::hash("vet", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6)",
        params![SEED_VET_ID, "vet", hash_v, "Veterinarian", "vet", now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_superadmin_user(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'superadmin'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n > 0 {
        return Ok(());
    }
    let now = crate::sync::approx_server_now();
    let hash = bcrypt::hash("superadmin", bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6)",
        params![SEED_SUPERADMIN_ID, "superadmin", hash, "Super administrator", "superadmin", now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_conn(pool: &DbPool) -> Result<PooledConnection<SqliteConnectionManager>, String> {
    pool.get().map_err(|e| e.to_string())
}

fn ensure_lab_analytes_columns(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('lab_analytes') WHERE name = 'remarks'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n == 0 {
        conn.execute("ALTER TABLE lab_analytes ADD COLUMN remarks TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    let n2: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('lab_result_values') WHERE name = 'remarks'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if n2 == 0 {
        conn.execute("ALTER TABLE lab_result_values ADD COLUMN remarks TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate_lab_result_values(conn: &mut rusqlite::Connection) -> Result<(), String> {
    let col_type: String = conn
        .query_row(
            "SELECT type FROM pragma_table_info('lab_result_values') WHERE name = 'observed_value'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.to_string());
    if col_type == "REAL" {
        conn.execute_batch(
            r#"
            CREATE TABLE lab_result_values_new (
                id TEXT PRIMARY KEY,
                lab_result_id TEXT NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
                analyte_id TEXT NOT NULL,
                analyte_name TEXT NOT NULL,
                unit TEXT,
                normal_min REAL,
                normal_max REAL,
                observed_value TEXT NOT NULL,
                remarks TEXT
            );
            INSERT INTO lab_result_values_new SELECT id, lab_result_id, analyte_id, analyte_name, unit, normal_min, normal_max, CAST(observed_value AS TEXT), remarks FROM lab_result_values;
            DROP TABLE lab_result_values;
            ALTER TABLE lab_result_values_new RENAME TO lab_result_values;
            "#,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
