use mongodb::{Client, options::ClientOptions};
use mongodb::bson::{doc, Document, Bson};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::sync::OnceLock;

pub type DbPool = Pool<SqliteConnectionManager>;

static MONGO_CLIENT: OnceLock<Client> = OnceLock::new();
static ID_INDEXES_DONE: OnceLock<()> = OnceLock::new();

/// Single MongoDB database used for all store / retrieve / sync.
pub const MONGO_DB: &str = "petcare";

// Baked into the binary at compile time by build.rs via `cargo:rustc-env=MONGODB_URI=...`
// See build.rs — it reads a `.env` file (or an actual env var) at BUILD time only.
const MONGODB_URI: &str = env!("MONGODB_URI");

pub async fn get_mongo_client() -> Option<&'static Client> {
    if let Some(client) = MONGO_CLIENT.get() {
        return Some(client);
    }

    match ClientOptions::parse(MONGODB_URI).await {
        Ok(mut options) => {
            // Force the petcare database even if the URI omits a path.
            options.default_database = Some(MONGO_DB.to_string());
            match Client::with_options(options) {
                Ok(client) => {
                    println!("MongoDB client ready (database={MONGO_DB})");
                    let _ = MONGO_CLIENT.set(client);
                    MONGO_CLIENT.get()
                }
                Err(e) => {
                    eprintln!("Failed to create MongoDB client: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to parse MongoDB URI: {}", e);
            None
        }
    }
}

pub fn mongo_db_name(_client: &Client) -> String {
    MONGO_DB.to_string()
}

const SYNC_COLLECTIONS: &[&str] = &[
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
    "sync_tombstones",
];

async fn ensure_unique_id_indexes(client: &Client) {
    if ID_INDEXES_DONE.get().is_some() {
        return;
    }
    let db = client.database(MONGO_DB);
    for collection_name in SYNC_COLLECTIONS {
        if *collection_name == "sync_tombstones" {
            continue;
        }
        let collection = db.collection::<Document>(collection_name);
        let model = mongodb::IndexModel::builder()
            .keys(doc! { "id": 1 })
            .options(
                mongodb::options::IndexOptions::builder()
                    .unique(true)
                    .name("uniq_app_id".to_string())
                    .build(),
            )
            .build();
        if let Err(e) = collection.create_index(model).await {
            // Duplicate key while building index, or already exists — non-fatal.
            eprintln!("MongoDB id index on {collection_name}: {e}");
        }
        // Speeds incremental pulls filtered by synced_at / updated_at.
        let ts_model = mongodb::IndexModel::builder()
            .keys(doc! { "synced_at": 1 })
            .options(
                mongodb::options::IndexOptions::builder()
                    .name("idx_synced_at".to_string())
                    .build(),
            )
            .build();
        if let Err(e) = collection.create_index(ts_model).await {
            eprintln!("MongoDB synced_at index on {collection_name}: {e}");
        }
    }
    let _ = ID_INDEXES_DONE.set(());
}

fn doc_revision(doc: &Document) -> Option<String> {
    // Prefer server-stamped synced_at so device clock skew cannot win LWW.
    doc.get_str("synced_at")
        .ok()
        .or_else(|| doc.get_str("updated_at").ok())
        .or_else(|| doc.get_str("created_at").ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn parse_rev(raw: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    chrono::DateTime::parse_from_rfc3339(&s.replace(' ', "T"))
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Fixed-width UTC stamp. Mongo compares `synced_at` as a *string*, so every writer
/// must use one format; `+00:00` with a full-width fraction keeps lexicographic order
/// equal to chronological order, including against stamps already in the database.
pub fn canonical_ts(dt: chrono::DateTime<chrono::Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.9f+00:00").to_string()
}

/// Offset between this device's clock and the MongoDB server clock, in milliseconds.
static CLOCK_SKEW_MS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
/// Device-clock millis when the skew was last measured (0 = never).
static SKEW_MEASURED_AT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

async fn read_server_millis(client: &Client) -> Option<i64> {
    // `hello` is run against the app database: the clinic's Atlas user has no rights
    // on `admin`, so the old lookup failed every time and silently fell back to the
    // device clock — which is what let skewed clocks corrupt pull cursors.
    for db in [MONGO_DB, "admin"] {
        match client.database(db).run_command(doc! { "hello": 1 }).await {
            Ok(reply) => {
                if let Ok(dt) = reply.get_datetime("localTime") {
                    return Some(dt.timestamp_millis());
                }
            }
            Err(e) => eprintln!("MongoDB hello on {db} failed: {e}"),
        }
    }
    None
}

/// MongoDB server time, so `synced_at` is comparable across devices with wrong clocks.
/// The skew is measured at most once a minute rather than once per pushed document.
pub async fn mongo_server_time(client: &Client) -> chrono::DateTime<chrono::Utc> {
    use std::sync::atomic::Ordering::Relaxed;

    let device_ms = chrono::Utc::now().timestamp_millis();
    let measured_at = SKEW_MEASURED_AT.load(Relaxed);
    if measured_at == 0 || (device_ms - measured_at).abs() > 60_000 {
        if let Some(server_ms) = read_server_millis(client).await {
            let skew = server_ms - chrono::Utc::now().timestamp_millis();
            CLOCK_SKEW_MS.store(skew, Relaxed);
            if skew.abs() > 60_000 {
                println!("MongoDB clock skew on this device: {skew} ms (using server time)");
            }
        }
        // Recorded either way so a failing lookup is not retried on every document.
        SKEW_MEASURED_AT.store(device_ms, Relaxed);
    }
    chrono::Utc::now() + chrono::Duration::milliseconds(CLOCK_SKEW_MS.load(Relaxed))
}

/// Skew-corrected "now" for local `updated_at` stamps (sync-safe across devices).
/// Uses the last measured MongoDB skew; before the first sync this equals device UTC.
pub fn approx_server_now() -> String {
    use std::sync::atomic::Ordering::Relaxed;
    canonical_ts(
        chrono::Utc::now() + chrono::Duration::milliseconds(CLOCK_SKEW_MS.load(Relaxed)),
    )
}

/// True if `incoming` is strictly older than `existing` (should not overwrite Mongo).
fn is_stale_push(incoming: Option<&str>, existing: Option<&str>) -> bool {
    match (incoming.and_then(parse_rev), existing.and_then(parse_rev)) {
        (Some(inc), Some(ex)) => inc < ex,
        (None, Some(_)) => true,
        _ => false,
    }
}

fn opd_status_rank(s: &str) -> i32 {
    match s {
        "completed" => 3,
        "in_progress" => 2,
        "pending" => 1,
        _ => 0,
    }
}

/// Returns `true` when MongoDB was actually written, `false` when push was skipped as stale.
pub async fn upsert_document(collection_name: &str, id: &str, doc: Document) -> Result<bool, String> {
    let client = get_mongo_client().await.ok_or_else(|| "MongoDB client is not initialized".to_string())?;
    let db_name = mongo_db_name(client);
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(collection_name);

    let mut set_doc = doc;
    set_doc.remove("_id");
    let incoming_rev = doc_revision(&set_doc);

    // Server-side LWW: never let an older offline copy overwrite a newer cloud row.
    if let Some(existing) = collection
        .find_one(doc! { "id": id })
        .await
        .map_err(|e| e.to_string())?
    {
        let existing_rev = doc_revision(&existing);
        let skip = if collection_name == "opd_requests" {
            let incoming_status = set_doc.get_str("status").unwrap_or("");
            let existing_status = existing.get_str("status").unwrap_or("");
            let in_rank = opd_status_rank(incoming_status);
            let ex_rank = opd_status_rank(existing_status);
            if in_rank > ex_rank {
                false
            } else if in_rank < ex_rank {
                // Reopen: pending with newer timestamp beats completed on cloud.
                !(incoming_status == "pending"
                    && existing_status == "completed"
                    && !is_stale_push(incoming_rev.as_deref(), existing_rev.as_deref()))
            } else {
                is_stale_push(incoming_rev.as_deref(), existing_rev.as_deref())
            }
        } else {
            is_stale_push(incoming_rev.as_deref(), existing_rev.as_deref())
        };
        if skip {
            println!(
                "MongoDB push skipped stale {collection_name}/{id} (cloud newer or lower clinical status)"
            );
            return Ok(false);
        }
    }

    // Fresh cloud stamp (server clock) so other devices' incremental pulls see this write.
    set_doc.insert("synced_at", canonical_ts(mongo_server_time(client).await));
    let filter = doc! { "id": id };
    let update = doc! { "$set": set_doc };
    let options = mongodb::options::UpdateOptions::builder().upsert(true).build();

    collection
        .update_one(filter, update)
        .with_options(options)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[allow(dead_code)]
pub async fn delete_document(collection_name: &str, id: &str) -> Result<(), String> {
    let client = get_mongo_client().await.ok_or_else(|| "MongoDB client is not initialized".to_string())?;
    let db_name = mongo_db_name(client);
    let db = client.database(&db_name);
    let collection = db.collection::<Document>(collection_name);

    let filter = doc! { "id": id };
    collection.delete_one(filter).await.map_err(|e| e.to_string())?;
    Ok(())
}

fn to_bson_array(json_str: &Option<String>) -> Bson {
    if let Some(s) = json_str {
        if let Ok(vec) = serde_json::from_str::<Vec<String>>(s) {
            return Bson::Array(vec.into_iter().map(Bson::String).collect());
        }
    }
    Bson::Array(Vec::new())
}

fn medicines_to_bson(json_str: &Option<String>) -> Bson {
    if let Some(s) = json_str {
        if let Ok(vec) = serde_json::from_str::<Vec<serde_json::Value>>(s) {
            let mut bson_arr = Vec::new();
            for v in vec {
                if let Ok(b) = mongodb::bson::to_bson(&v) {
                    bson_arr.push(b);
                }
            }
            return Bson::Array(bson_arr);
        }
    }
    Bson::Array(Vec::new())
}

pub async fn sync_user(pool: &DbPool, user_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, username, password_hash, display_name, role, created_at, active, COALESCE(updated_at, created_at) FROM users WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![user_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "username": r.get::<_, String>(1)?,
                "password_hash": r.get::<_, String>(2)?,
                "display_name": r.get::<_, String>(3)?,
                "role": r.get::<_, String>(4)?,
                "created_at": r.get::<_, String>(5)?,
                "active": r.get::<_, i64>(6)? != 0,
                "updated_at": r.get::<_, String>(7)?,
            })
        }).map_err(|e| e.to_string())?
    };

    // Never upload stub accounts created for FK repair — a blank hash would wipe
    // the real password on every other device via last-write-wins.
    if row
        .get_str("password_hash")
        .map(|h| h.is_empty())
        .unwrap_or(true)
    {
        eprintln!("MongoDB push skipped users/{user_id}: blank password stub");
        return Ok(true);
    }

    // Avoid duplicate username docs when a fresh install seeded a different UUID.
    let username = row.get_str("username").unwrap_or("").to_string();
    if !username.is_empty() {
        let client = get_mongo_client()
            .await
            .ok_or_else(|| "MongoDB client is not initialized".to_string())?;
        let collection = client
            .database(MONGO_DB)
            .collection::<Document>("users");
        if let Some(existing) = collection
            .find_one(doc! { "username": &username, "id": { "$ne": user_id } })
            .await
            .map_err(|e| e.to_string())?
        {
            let other = existing.get_str("id").unwrap_or("?");
            eprintln!(
                "MongoDB push skipped users/{user_id}: username '{username}' already exists as {other}"
            );
            return Ok(true);
        }
    }

    upsert_document("users", user_id, row).await
}

pub async fn sync_pet(pool: &DbPool, pet_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![pet_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "card_id": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "species": r.get::<_, Option<String>>(3)?,
                "breed": r.get::<_, Option<String>>(4)?,
                "age": r.get::<_, Option<String>>(5)?,
                "date_of_birth": r.get::<_, Option<String>>(6)?,
                "sex": r.get::<_, Option<String>>(7)?,
                "weight": r.get::<_, Option<String>>(8)?,
                "vaccine_status": r.get::<_, Option<String>>(9)?,
                "deworming_status": r.get::<_, Option<String>>(10)?,
                "owner_name": r.get::<_, Option<String>>(11)?,
                "owner_phone": r.get::<_, Option<String>>(12)?,
                "owner_address": r.get::<_, Option<String>>(13)?,
                "owner_email": r.get::<_, Option<String>>(14)?,
                "notes": r.get::<_, Option<String>>(15)?,
                "created_at": r.get::<_, String>(16)?,
                "updated_at": r.get::<_, String>(17)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("pets", pet_id, row).await
}

pub async fn sync_medical_entry(pool: &DbPool, entry_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight, COALESCE(updated_at, created_at) FROM medical_history_entries WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![entry_id], |r| {
            let dx_raw: Option<String> = r.get(5)?;
            let ddx_raw: Option<String> = r.get(6)?;
            let paths_raw: Option<String> = r.get(15)?;
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "entry_type": r.get::<_, String>(2)?,
                "title": r.get::<_, Option<String>>(3)?,
                "body": r.get::<_, Option<String>>(4)?,
                "dx_items": to_bson_array(&dx_raw),
                "ddx_items": to_bson_array(&ddx_raw),
                "dx_note": r.get::<_, Option<String>>(7)?,
                "ddx_note": r.get::<_, Option<String>>(8)?,
                "administered_date": r.get::<_, Option<String>>(9)?,
                "next_due_date": r.get::<_, Option<String>>(10)?,
                "reminder_days_before": r.get::<_, Option<i64>>(11)?,
                "external_file_path": r.get::<_, Option<String>>(12)?,
                "lab_result_id": r.get::<_, Option<String>>(13)?,
                "created_at": r.get::<_, String>(14)?,
                "external_file_paths": to_bson_array(&paths_raw),
                "body_weight": r.get::<_, Option<String>>(16)?,
                "updated_at": r.get::<_, String>(17)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("medical_history_entries", entry_id, row).await
}

pub async fn sync_vaccination(pool: &DbPool, vax_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight, COALESCE(updated_at, created_at) FROM vaccinations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![vax_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "vaccine_name": r.get::<_, String>(2)?,
                "administered_date": r.get::<_, Option<String>>(3)?,
                "next_due_date": r.get::<_, Option<String>>(4)?,
                "reminder_days_before": r.get::<_, Option<i64>>(5)?,
                "notes": r.get::<_, Option<String>>(6)?,
                "created_at": r.get::<_, String>(7)?,
                "body_weight": r.get::<_, Option<String>>(8)?,
                "updated_at": r.get::<_, String>(9)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("vaccinations", vax_id, row).await
}

pub async fn sync_grooming_event(pool: &DbPool, event_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight, COALESCE(updated_at, created_at) FROM grooming_events WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![event_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "service_type": r.get::<_, String>(2)?,
                "administered_date": r.get::<_, Option<String>>(3)?,
                "next_due_date": r.get::<_, Option<String>>(4)?,
                "reminder_days_before": r.get::<_, Option<i64>>(5)?,
                "performed_date": r.get::<_, String>(6)?,
                "notes": r.get::<_, Option<String>>(7)?,
                "created_at": r.get::<_, String>(8)?,
                "body_weight": r.get::<_, Option<String>>(9)?,
                "updated_at": r.get::<_, String>(10)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("grooming_events", event_id, row).await
}

pub async fn sync_hospitalization(pool: &DbPool, hosp_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at, COALESCE(updated_at, created_at) FROM hospitalizations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![hosp_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "cage_number": r.get::<_, String>(2)?,
                "check_in_date": r.get::<_, String>(3)?,
                "check_out_date": r.get::<_, Option<String>>(4)?,
                "created_at": r.get::<_, String>(5)?,
                "updated_at": r.get::<_, String>(6)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("hospitalizations", hosp_id, row).await
}

pub async fn sync_clinic(pool: &DbPool, clinic_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![clinic_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "email": r.get::<_, String>(2)?,
                "address": r.get::<_, String>(3)?,
                "phone": r.get::<_, String>(4)?,
                "timing": r.get::<_, String>(5)?,
                "created_at": r.get::<_, String>(6)?,
                "updated_at": r.get::<_, String>(7)?,
                "logo": r.get::<_, Option<String>>(8)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("clinics", clinic_id, row).await
}

pub async fn sync_lab_test(pool: &DbPool, test_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, code, default_report_hours, active, created_at, COALESCE(updated_at, created_at) FROM lab_tests WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![test_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "code": r.get::<_, Option<String>>(2)?,
                "default_report_hours": r.get::<_, Option<i64>>(3)?,
                "active": r.get::<_, i64>(4)?,
                "created_at": r.get::<_, String>(5)?,
                "updated_at": r.get::<_, String>(6)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("lab_tests", test_id, row).await
}

pub async fn sync_lab_analyte(pool: &DbPool, analyte_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks, COALESCE(updated_at, '') FROM lab_analytes WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![analyte_id], |r| {
            let updated: String = r.get(8)?;
            let mut d = doc! {
                "id": r.get::<_, String>(0)?,
                "lab_test_id": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "unit": r.get::<_, Option<String>>(3)?,
                "normal_min": r.get::<_, Option<f64>>(4)?,
                "normal_max": r.get::<_, Option<f64>>(5)?,
                "sort_order": r.get::<_, i64>(6)?,
                "remarks": r.get::<_, Option<String>>(7)?,
            };
            if !updated.is_empty() {
                d.insert("updated_at", updated);
            }
            Ok(d)
        }).map_err(|e| e.to_string())?
    };

    upsert_document("lab_analytes", analyte_id, row).await
}

pub async fn sync_lab_order(pool: &DbPool, order_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at, COALESCE(updated_at, created_at) FROM lab_orders WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![order_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "lab_test_id": r.get::<_, String>(2)?,
                "receipt_number": r.get::<_, Option<String>>(3)?,
                "tentative_report_at": r.get::<_, Option<String>>(4)?,
                "status": r.get::<_, String>(5)?,
                "created_at": r.get::<_, String>(6)?,
                "updated_at": r.get::<_, String>(7)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("lab_orders", order_id, row).await
}

pub async fn sync_lab_result(pool: &DbPool, result_id: &str) -> Result<bool, String> {
    let mut doc = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, lab_order_id, pet_id, lab_test_id, created_at, notes, COALESCE(updated_at, created_at) FROM lab_results WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![result_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "lab_order_id": r.get::<_, String>(1)?,
                "pet_id": r.get::<_, String>(2)?,
                "lab_test_id": r.get::<_, String>(3)?,
                "created_at": r.get::<_, String>(4)?,
                "notes": r.get::<_, Option<String>>(5)?,
                "updated_at": r.get::<_, String>(6)?,
            })
        }).map_err(|e| e.to_string())?
    };

    let values_list = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut val_stmt = conn
            .prepare("SELECT id, analyte_id, analyte_name, unit, normal_min, normal_max, observed_value, remarks FROM lab_result_values WHERE lab_result_id = ?1")
            .map_err(|e| e.to_string())?;
        let val_rows = val_stmt.query_map(params![result_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "analyte_id": r.get::<_, String>(1)?,
                "analyte_name": r.get::<_, String>(2)?,
                "unit": r.get::<_, Option<String>>(3)?,
                "normal_min": r.get::<_, Option<f64>>(4)?,
                "normal_max": r.get::<_, Option<f64>>(5)?,
                "observed_value": r.get::<_, String>(6)?,
                "remarks": r.get::<_, Option<String>>(7)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for r in val_rows {
            if let Ok(d) = r {
                list.push(d);
            }
        }
        list
    };

    doc.insert("values", Bson::Array(values_list.into_iter().map(Bson::Document).collect()));

    upsert_document("lab_results", result_id, doc).await
}

pub async fn sync_opd_request(pool: &DbPool, req_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, pet_id, requested_by_user_id, requested_by_name, status, assigned_vet_id, assigned_vet_name, created_at, claimed_at, completed_at, COALESCE(updated_at, created_at) FROM opd_requests WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![req_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "pet_id": r.get::<_, String>(1)?,
                "requested_by_user_id": r.get::<_, String>(2)?,
                "requested_by_name": r.get::<_, String>(3)?,
                "status": r.get::<_, String>(4)?,
                "assigned_vet_id": r.get::<_, Option<String>>(5)?,
                "assigned_vet_name": r.get::<_, Option<String>>(6)?,
                "created_at": r.get::<_, String>(7)?,
                "claimed_at": r.get::<_, Option<String>>(8)?,
                "completed_at": r.get::<_, Option<String>>(9)?,
                "updated_at": r.get::<_, String>(10)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("opd_requests", req_id, row).await
}

pub async fn sync_opd_consultation(pool: &DbPool, cons_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, temperature, physical_exam, history_observations, dx_items, ddx_items, diagnosis_note, differential_diagnosis_note, symptoms, recommended_lab_test_ids, recommended_lab_test_names, custom_lab_tests, medicines_json, clinical_treatment_remark, in_house_prescription, recommended_food, next_visit_at, created_at, body_weight, COALESCE(updated_at, created_at), COALESCE(vaccinated, 0), COALESCE(deworming, 0), prognosis FROM opd_consultations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![cons_id], |r| {
            let obs_raw: Option<String> = r.get(8)?;
            let dx_raw: Option<String> = r.get(9)?;
            let ddx_raw: Option<String> = r.get(10)?;
            let sym_raw: Option<String> = r.get(13)?;
            let lab_ids_raw: Option<String> = r.get(14)?;
            let lab_names_raw: Option<String> = r.get(15)?;
            let custom_labs_raw: Option<String> = r.get(16)?;
            let meds_raw: Option<String> = r.get(17)?;

            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "request_id": r.get::<_, String>(1)?,
                "pet_id": r.get::<_, String>(2)?,
                "vet_id": r.get::<_, String>(3)?,
                "vet_name": r.get::<_, String>(4)?,
                "doctor_signature_name": r.get::<_, String>(5)?,
                "temperature": r.get::<_, Option<String>>(6)?,
                "physical_exam": r.get::<_, Option<String>>(7)?,
                "history_observations": to_bson_array(&obs_raw),
                "dx_items": to_bson_array(&dx_raw),
                "ddx_items": to_bson_array(&ddx_raw),
                "diagnosis_note": r.get::<_, Option<String>>(11)?,
                "differential_diagnosis_note": r.get::<_, Option<String>>(12)?,
                "symptoms": to_bson_array(&sym_raw),
                "recommended_lab_test_ids": to_bson_array(&lab_ids_raw),
                "recommended_lab_test_names": to_bson_array(&lab_names_raw),
                "custom_lab_tests": to_bson_array(&custom_labs_raw),
                "medicines": medicines_to_bson(&meds_raw),
                "clinical_treatment_remark": r.get::<_, Option<String>>(18)?,
                "in_house_prescription": r.get::<_, Option<String>>(19)?,
                "recommended_food": r.get::<_, Option<String>>(20)?,
                "next_visit_at": r.get::<_, Option<String>>(21)?,
                "created_at": r.get::<_, String>(22)?,
                "body_weight": r.get::<_, Option<String>>(23)?,
                "updated_at": r.get::<_, String>(24)?,
                "vaccinated": r.get::<_, i64>(25)? != 0,
                "deworming": r.get::<_, i64>(26)? != 0,
                "prognosis": r.get::<_, Option<String>>(27)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("opd_consultations", cons_id, row).await
}

pub async fn sync_opd_catalog_item(pool: &DbPool, item_id: &str) -> Result<bool, String> {
    let row = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, type, name, active, created_at, COALESCE(updated_at, created_at) FROM opd_catalog_items WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![item_id], |r| {
            Ok(doc! {
                "id": r.get::<_, String>(0)?,
                "type": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "active": r.get::<_, i64>(3)? != 0,
                "created_at": r.get::<_, String>(4)?,
                "updated_at": r.get::<_, String>(5)?,
            })
        }).map_err(|e| e.to_string())?
    };

    upsert_document("opd_catalog_items", item_id, row).await
}

#[allow(dead_code)]
fn fetch_ids(pool: &DbPool, table_name: &str) -> Result<Vec<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&format!("SELECT id FROM {}", table_name)).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for r in rows {
        if let Ok(id) = r {
            ids.push(id);
        }
    }
    Ok(ids)
}

pub async fn flush_pending_deletes(pool: &DbPool) -> Result<usize, String> {
    let rows = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT collection, record_id, deleted_at FROM pending_deletes")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in mapped {
            out.push(row.map_err(|e| e.to_string())?);
        }
        out
    };

    let mut flushed = 0usize;
    for (collection, record_id, deleted_at) in rows {
        // One unflushable delete must never abort the sync: that used to return early
        // from sync_bidirectional, so the device stopped pulling and pushing entirely.
        if let Err(e) = delete_document(&collection, &record_id).await {
            eprintln!("MongoDB delete failed for {collection}/{record_id}: {e}");
            continue;
        }
        let tombstone_id = format!("{collection}:{record_id}");
        if let Err(e) = upsert_document(
            "sync_tombstones",
            &tombstone_id,
            doc! {
                "id": &tombstone_id,
                "collection": &collection,
                "record_id": &record_id,
                "deleted_at": &deleted_at,
            },
        )
        .await
        {
            eprintln!("MongoDB tombstone failed for {tombstone_id}: {e}");
            continue;
        }

        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM pending_deletes WHERE collection = ?1 AND record_id = ?2",
            params![collection, record_id],
        )
        .map_err(|e| e.to_string())?;
        flushed += 1;
    }
    Ok(flushed)
}

pub struct SyncResult {
    pub pulled: usize,
    pub deleted: usize,
    pub pushed: usize,
}

pub async fn sync_bidirectional(pool: &DbPool, _push_first: bool) -> Result<SyncResult, String> {
    let client = get_mongo_client()
        .await
        .ok_or_else(|| "MongoDB connection not configured or offline".to_string())?;

    ensure_unique_id_indexes(client).await;

    // 1) Push offline deletes first so other devices can drop them.
    match flush_pending_deletes(pool).await {
        Ok(n) if n > 0 => println!("Flushed {n} pending deletes to MongoDB"),
        Ok(_) => {}
        Err(e) => eprintln!("MongoDB delete flush failed (continuing with sync): {e}"),
    }

    // Always pull → merge (LWW) → push.
    // Push-first used to let a stale offline device overwrite newer cloud OPD/pets.
    // Local writes stay in sync_dirty through the pull (pulling=1), then upload.
    let pull_stats = crate::pull::pull_all_data(pool).await?;
    let pushed = sync_dirty_data(pool).await?;

    println!(
        "MongoDB pull completed: {} records imported, {} local rows removed via tombstones",
        pull_stats.pulled, pull_stats.deleted
    );
    if pushed > 0 {
        println!("MongoDB fast push uploaded {pushed} dirty record(s)");
    }

    Ok(SyncResult {
        pulled: pull_stats.pulled,
        deleted: pull_stats.deleted,
        pushed,
    })
}

pub async fn sync_dirty_data(pool: &DbPool) -> Result<usize, String> {
    if get_mongo_client().await.is_none() {
        return Err("MongoDB connection not configured or offline".to_string());
    }

    let mut pushed = 0usize;
    let mut push_errors = 0usize;

    // Claim each queued row *before* uploading it. Clearing afterwards lost any edit the
    // user made while that row's upload was in flight; re-queueing on failure keeps
    // offline retries working.
    macro_rules! push_dirty {
        ($table:expr, $sync_fn:expr) => {{
            let ids = {
                let conn = pool.get().map_err(|e| e.to_string())?;
                crate::db::dirty_ids(&conn, $table)?
            };
            for id in ids {
                if let Ok(conn) = pool.get() {
                    let _ = crate::db::clear_dirty(&conn, $table, &id);
                }
                let requeue = |reason: &str| {
                    if let Ok(conn) = pool.get() {
                        if let Err(e) = crate::db::mark_dirty(&conn, $table, &id) {
                            eprintln!("Could not re-queue {} {} ({reason}): {e}", $table, id);
                        }
                    }
                };
                match $sync_fn(pool, &id).await {
                    Ok(true) => pushed += 1,
                    Ok(false) => {
                        // Cloud had a newer copy — retry after the next pull merges it.
                        requeue("cloud newer");
                    }
                    Err(e) if e.contains("no rows") => {
                        // Row was deleted locally; the delete flushes via pending_deletes.
                    }
                    Err(e) => {
                        push_errors += 1;
                        eprintln!("MongoDB push failed for {} {}: {}", $table, id, e);
                        requeue("push failed");
                    }
                }
            }
        }};
    }

    push_dirty!("users", sync_user);
    push_dirty!("pets", sync_pet);
    push_dirty!("medical_history_entries", sync_medical_entry);
    push_dirty!("vaccinations", sync_vaccination);
    push_dirty!("grooming_events", sync_grooming_event);
    push_dirty!("hospitalizations", sync_hospitalization);
    push_dirty!("clinics", sync_clinic);
    push_dirty!("lab_tests", sync_lab_test);
    push_dirty!("lab_analytes", sync_lab_analyte);
    push_dirty!("lab_orders", sync_lab_order);
    push_dirty!("lab_results", sync_lab_result);
    push_dirty!("opd_requests", sync_opd_request);
    push_dirty!("opd_consultations", sync_opd_consultation);
    push_dirty!("opd_catalog_items", sync_opd_catalog_item);

    if push_errors > 0 {
        eprintln!("MongoDB push finished with {push_errors} error(s)");
    }

    Ok(pushed)
}

#[allow(dead_code)]
pub async fn sync_all_data(pool: &DbPool) -> Result<(), String> {
    // Back-compat / forced full push: mark everything dirty then push.
    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        for table in [
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
        ] {
            conn.execute(
                &format!(
                    "INSERT OR IGNORE INTO sync_dirty(collection, record_id)
                     SELECT '{table}', id FROM {table}"
                ),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let _ = sync_dirty_data(pool).await?;
    Ok(())
}








// use mongodb::{Client, options::ClientOptions};
// use mongodb::bson::{doc, Document, Bson};
// use r2d2::Pool;
// use r2d2_sqlite::SqliteConnectionManager;
// use rusqlite::params;
// use std::env;
// use std::sync::OnceLock;

// pub type DbPool = Pool<SqliteConnectionManager>;

// static MONGO_CLIENT: OnceLock<Option<Client>> = OnceLock::new();

// pub async fn get_mongo_client() -> Option<&'static Client> {
//     if let Some(client_opt) = MONGO_CLIENT.get() {
//         return client_opt.as_ref();
//     }

//     let uri = env::var("MONGODB_URI")
//         .ok()
//         .or_else(|| {
//             // Try reading from ../web/.env.local (development environment)
//             std::fs::read_to_string("../web/.env.local")
//                 .ok()
//                 .and_then(|content| {
//                     content.lines()
//                         .find(|line| line.starts_with("MONGODB_URI="))
//                         .map(|line| line["MONGODB_URI=".len()..].trim().to_string())
//                 })
//         })
//         .or_else(|| {
//             // Try reading from ./web/.env.local or web/.env.local if app runs in root folder
//             std::fs::read_to_string("web/.env.local")
//                 .ok()
//                 .and_then(|content| {
//                     content.lines()
//                         .find(|line| line.starts_with("MONGODB_URI="))
//                         .map(|line| line["MONGODB_URI=".len()..].trim().to_string())
//                 })
//         });

//     let client = if let Some(uri) = uri {
//         if let Ok(options) = ClientOptions::parse(uri).await {
//             Client::with_options(options).ok()
//         } else {
//             None
//         }
//     } else {
//         None
//     };

//     let _ = MONGO_CLIENT.set(client);
//     MONGO_CLIENT.get().and_then(|opt| opt.as_ref())
// }

// pub async fn upsert_document(collection_name: &str, id: &str, doc: Document) -> Result<bool, String> {
//     if let Some(client) = get_mongo_client().await {
//         let db_name = client.default_database().map(|db| db.name().to_string()).unwrap_or_else(|| "test".to_string());
//         let db = client.database(&db_name);
//         let collection = db.collection::<Document>(collection_name);

//         let filter = doc! { "id": id };
//         let update = doc! { "$set": doc };
//         let options = mongodb::options::UpdateOptions::builder().upsert(true).build();

//         collection.update_one(filter, update).with_options(options).await
//             .map_err(|e| e.to_string())?;
//     }
//     Ok(())
// }

// #[allow(dead_code)]
// pub async fn delete_document(collection_name: &str, id: &str) -> Result<bool, String> {
//     if let Some(client) = get_mongo_client().await {
//         let db_name = client.default_database().map(|db| db.name().to_string()).unwrap_or_else(|| "test".to_string());
//         let db = client.database(&db_name);
//         let collection = db.collection::<Document>(collection_name);

//         let filter = doc! { "id": id };
//         collection.delete_one(filter).await.map_err(|e| e.to_string())?;
//     }
//     Ok(())
// }

// fn to_bson_array(json_str: &Option<String>) -> Bson {
//     if let Some(s) = json_str {
//         if let Ok(vec) = serde_json::from_str::<Vec<String>>(s) {
//             return Bson::Array(vec.into_iter().map(Bson::String).collect());
//         }
//     }
//     Bson::Array(Vec::new())
// }

// fn medicines_to_bson(json_str: &Option<String>) -> Bson {
//     if let Some(s) = json_str {
//         if let Ok(vec) = serde_json::from_str::<Vec<serde_json::Value>>(s) {
//             let mut bson_arr = Vec::new();
//             for v in vec {
//                 if let Ok(b) = mongodb::bson::to_bson(&v) {
//                     bson_arr.push(b);
//                 }
//             }
//             return Bson::Array(bson_arr);
//         }
//     }
//     Bson::Array(Vec::new())
// }

// pub async fn sync_user(pool: &DbPool, user_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, username, password_hash, display_name, role, created_at, active FROM users WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![user_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "username": r.get::<_, String>(1)?,
//                 "password_hash": r.get::<_, String>(2)?,
//                 "display_name": r.get::<_, String>(3)?,
//                 "role": r.get::<_, String>(4)?,
//                 "created_at": r.get::<_, String>(5)?,
//                 "active": r.get::<_, i64>(6)? != 0,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("users", user_id, row).await
// }

// pub async fn sync_pet(pool: &DbPool, pet_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, card_id, name, species, breed, age, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![pet_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "card_id": r.get::<_, String>(1)?,
//                 "name": r.get::<_, String>(2)?,
//                 "species": r.get::<_, Option<String>>(3)?,
//                 "breed": r.get::<_, Option<String>>(4)?,
//                 "age": r.get::<_, Option<String>>(5)?,
//                 "sex": r.get::<_, Option<String>>(6)?,
//                 "weight": r.get::<_, Option<String>>(7)?,
//                 "vaccine_status": r.get::<_, Option<String>>(8)?,
//                 "deworming_status": r.get::<_, Option<String>>(9)?,
//                 "owner_name": r.get::<_, Option<String>>(10)?,
//                 "owner_phone": r.get::<_, Option<String>>(11)?,
//                 "owner_address": r.get::<_, Option<String>>(12)?,
//                 "owner_email": r.get::<_, Option<String>>(13)?,
//                 "notes": r.get::<_, Option<String>>(14)?,
//                 "created_at": r.get::<_, String>(15)?,
//                 "updated_at": r.get::<_, String>(16)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("pets", pet_id, row).await
// }

// pub async fn sync_medical_entry(pool: &DbPool, entry_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![entry_id], |r| {
//             let dx_raw: Option<String> = r.get(5)?;
//             let ddx_raw: Option<String> = r.get(6)?;
//             let paths_raw: Option<String> = r.get(15)?;
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "entry_type": r.get::<_, String>(2)?,
//                 "title": r.get::<_, Option<String>>(3)?,
//                 "body": r.get::<_, Option<String>>(4)?,
//                 "dx_items": to_bson_array(&dx_raw),
//                 "ddx_items": to_bson_array(&ddx_raw),
//                 "dx_note": r.get::<_, Option<String>>(7)?,
//                 "ddx_note": r.get::<_, Option<String>>(8)?,
//                 "administered_date": r.get::<_, Option<String>>(9)?,
//                 "next_due_date": r.get::<_, Option<String>>(10)?,
//                 "reminder_days_before": r.get::<_, Option<i64>>(11)?,
//                 "external_file_path": r.get::<_, Option<String>>(12)?,
//                 "lab_result_id": r.get::<_, Option<String>>(13)?,
//                 "created_at": r.get::<_, String>(14)?,
//                 "external_file_paths": to_bson_array(&paths_raw),
//                 "body_weight": r.get::<_, Option<String>>(16)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("medical_history_entries", entry_id, row).await
// }

// pub async fn sync_vaccination(pool: &DbPool, vax_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![vax_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "vaccine_name": r.get::<_, String>(2)?,
//                 "administered_date": r.get::<_, Option<String>>(3)?,
//                 "next_due_date": r.get::<_, Option<String>>(4)?,
//                 "reminder_days_before": r.get::<_, Option<i64>>(5)?,
//                 "notes": r.get::<_, Option<String>>(6)?,
//                 "created_at": r.get::<_, String>(7)?,
//                 "body_weight": r.get::<_, Option<String>>(8)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("vaccinations", vax_id, row).await
// }

// pub async fn sync_grooming_event(pool: &DbPool, event_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![event_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "service_type": r.get::<_, String>(2)?,
//                 "administered_date": r.get::<_, Option<String>>(3)?,
//                 "next_due_date": r.get::<_, Option<String>>(4)?,
//                 "reminder_days_before": r.get::<_, Option<i64>>(5)?,
//                 "performed_date": r.get::<_, String>(6)?,
//                 "notes": r.get::<_, Option<String>>(7)?,
//                 "created_at": r.get::<_, String>(8)?,
//                 "body_weight": r.get::<_, Option<String>>(9)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("grooming_events", event_id, row).await
// }

// pub async fn sync_hospitalization(pool: &DbPool, hosp_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at FROM hospitalizations WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![hosp_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "cage_number": r.get::<_, String>(2)?,
//                 "check_in_date": r.get::<_, String>(3)?,
//                 "check_out_date": r.get::<_, Option<String>>(4)?,
//                 "created_at": r.get::<_, String>(5)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("hospitalizations", hosp_id, row).await
// }

// pub async fn sync_clinic(pool: &DbPool, clinic_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![clinic_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "name": r.get::<_, String>(1)?,
//                 "email": r.get::<_, String>(2)?,
//                 "address": r.get::<_, String>(3)?,
//                 "phone": r.get::<_, String>(4)?,
//                 "timing": r.get::<_, String>(5)?,
//                 "created_at": r.get::<_, String>(6)?,
//                 "updated_at": r.get::<_, String>(7)?,
//                 "logo": r.get::<_, Option<String>>(8)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("clinics", clinic_id, row).await
// }

// pub async fn sync_lab_test(pool: &DbPool, test_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![test_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "name": r.get::<_, String>(1)?,
//                 "code": r.get::<_, Option<String>>(2)?,
//                 "default_report_hours": r.get::<_, Option<i64>>(3)?,
//                 "active": r.get::<_, i64>(4)?,
//                 "created_at": r.get::<_, String>(5)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("lab_tests", test_id, row).await
// }

// pub async fn sync_lab_analyte(pool: &DbPool, analyte_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![analyte_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "lab_test_id": r.get::<_, String>(1)?,
//                 "name": r.get::<_, String>(2)?,
//                 "unit": r.get::<_, Option<String>>(3)?,
//                 "normal_min": r.get::<_, Option<f64>>(4)?,
//                 "normal_max": r.get::<_, Option<f64>>(5)?,
//                 "sort_order": r.get::<_, i64>(6)?,
//                 "remarks": r.get::<_, Option<String>>(7)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("lab_analytes", analyte_id, row).await
// }

// pub async fn sync_lab_order(pool: &DbPool, order_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at FROM lab_orders WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![order_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "lab_test_id": r.get::<_, String>(2)?,
//                 "receipt_number": r.get::<_, Option<String>>(3)?,
//                 "tentative_report_at": r.get::<_, Option<String>>(4)?,
//                 "status": r.get::<_, String>(5)?,
//                 "created_at": r.get::<_, String>(6)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("lab_orders", order_id, row).await
// }

// pub async fn sync_lab_result(pool: &DbPool, result_id: &str) -> Result<bool, String> {
//     let mut doc = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, lab_order_id, pet_id, lab_test_id, created_at, notes FROM lab_results WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![result_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "lab_order_id": r.get::<_, String>(1)?,
//                 "pet_id": r.get::<_, String>(2)?,
//                 "lab_test_id": r.get::<_, String>(3)?,
//                 "created_at": r.get::<_, String>(4)?,
//                 "notes": r.get::<_, Option<String>>(5)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     let values_list = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut val_stmt = conn
//             .prepare("SELECT id, analyte_id, analyte_name, unit, normal_min, normal_max, observed_value, remarks FROM lab_result_values WHERE lab_result_id = ?1")
//             .map_err(|e| e.to_string())?;
//         let val_rows = val_stmt.query_map(params![result_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "analyte_id": r.get::<_, String>(1)?,
//                 "analyte_name": r.get::<_, String>(2)?,
//                 "unit": r.get::<_, Option<String>>(3)?,
//                 "normal_min": r.get::<_, Option<f64>>(4)?,
//                 "normal_max": r.get::<_, Option<f64>>(5)?,
//                 "observed_value": r.get::<_, String>(6)?,
//                 "remarks": r.get::<_, Option<String>>(7)?,
//             })
//         }).map_err(|e| e.to_string())?;

//         let mut list = Vec::new();
//         for r in val_rows {
//             if let Ok(d) = r {
//                 list.push(d);
//             }
//         }
//         list
//     };

//     doc.insert("values", Bson::Array(values_list.into_iter().map(Bson::Document).collect()));

//     upsert_document("lab_results", result_id, doc).await
// }

// pub async fn sync_opd_request(pool: &DbPool, req_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, pet_id, requested_by_user_id, requested_by_name, status, assigned_vet_id, assigned_vet_name, created_at, claimed_at, completed_at FROM opd_requests WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![req_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "pet_id": r.get::<_, String>(1)?,
//                 "requested_by_user_id": r.get::<_, String>(2)?,
//                 "requested_by_name": r.get::<_, String>(3)?,
//                 "status": r.get::<_, String>(4)?,
//                 "assigned_vet_id": r.get::<_, Option<String>>(5)?,
//                 "assigned_vet_name": r.get::<_, Option<String>>(6)?,
//                 "created_at": r.get::<_, String>(7)?,
//                 "claimed_at": r.get::<_, Option<String>>(8)?,
//                 "completed_at": r.get::<_, Option<String>>(9)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("opd_requests", req_id, row).await
// }

// pub async fn sync_opd_consultation(pool: &DbPool, cons_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, temperature, physical_exam, history_observations, dx_items, ddx_items, diagnosis_note, differential_diagnosis_note, symptoms, recommended_lab_test_ids, recommended_lab_test_names, custom_lab_tests, medicines_json, clinical_treatment_remark, in_house_prescription, recommended_food, next_visit_at, created_at, body_weight FROM opd_consultations WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![cons_id], |r| {
//             let obs_raw: Option<String> = r.get(8)?;
//             let dx_raw: Option<String> = r.get(9)?;
//             let ddx_raw: Option<String> = r.get(10)?;
//             let sym_raw: Option<String> = r.get(13)?;
//             let lab_ids_raw: Option<String> = r.get(14)?;
//             let lab_names_raw: Option<String> = r.get(15)?;
//             let custom_labs_raw: Option<String> = r.get(16)?;
//             let meds_raw: Option<String> = r.get(17)?;
            
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "request_id": r.get::<_, String>(1)?,
//                 "pet_id": r.get::<_, String>(2)?,
//                 "vet_id": r.get::<_, String>(3)?,
//                 "vet_name": r.get::<_, String>(4)?,
//                 "doctor_signature_name": r.get::<_, String>(5)?,
//                 "temperature": r.get::<_, Option<String>>(6)?,
//                 "physical_exam": r.get::<_, Option<String>>(7)?,
//                 "history_observations": to_bson_array(&obs_raw),
//                 "dx_items": to_bson_array(&dx_raw),
//                 "ddx_items": to_bson_array(&ddx_raw),
//                 "diagnosis_note": r.get::<_, Option<String>>(11)?,
//                 "differential_diagnosis_note": r.get::<_, Option<String>>(12)?,
//                 "symptoms": to_bson_array(&sym_raw),
//                 "recommended_lab_test_ids": to_bson_array(&lab_ids_raw),
//                 "recommended_lab_test_names": to_bson_array(&lab_names_raw),
//                 "custom_lab_tests": to_bson_array(&custom_labs_raw),
//                 "medicines": medicines_to_bson(&meds_raw),
//                 "clinical_treatment_remark": r.get::<_, Option<String>>(18)?,
//                 "in_house_prescription": r.get::<_, Option<String>>(19)?,
//                 "recommended_food": r.get::<_, Option<String>>(20)?,
//                 "next_visit_at": r.get::<_, Option<String>>(21)?,
//                 "created_at": r.get::<_, String>(22)?,
//                 "body_weight": r.get::<_, Option<String>>(23)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("opd_consultations", cons_id, row).await
// }

// pub async fn sync_opd_catalog_item(pool: &DbPool, item_id: &str) -> Result<bool, String> {
//     let row = {
//         let conn = pool.get().map_err(|e| e.to_string())?;
//         let mut stmt = conn
//             .prepare("SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE id = ?1")
//             .map_err(|e| e.to_string())?;
//         stmt.query_row(params![item_id], |r| {
//             Ok(doc! {
//                 "id": r.get::<_, String>(0)?,
//                 "type": r.get::<_, String>(1)?,
//                 "name": r.get::<_, String>(2)?,
//                 "active": r.get::<_, i64>(3)? != 0,
//                 "created_at": r.get::<_, String>(4)?,
//             })
//         }).map_err(|e| e.to_string())?
//     };

//     upsert_document("opd_catalog_items", item_id, row).await
// }

// fn fetch_ids(pool: &DbPool, table_name: &str) -> Result<Vec<String>, String> {
//     let conn = pool.get().map_err(|e| e.to_string())?;
//     let mut stmt = conn.prepare(&format!("SELECT id FROM {}", table_name)).map_err(|e| e.to_string())?;
//     let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
//     let mut ids = Vec::new();
//     for r in rows {
//         if let Ok(id) = r {
//             ids.push(id);
//         }
//     }
//     Ok(ids)
// }

// pub async fn sync_all_data(pool: &DbPool) -> Result<bool, String> {
//     if get_mongo_client().await.is_none() {
//         return Err("MongoDB connection not configured or offline".to_string());
//     }

//     // 1. users
//     if let Ok(ids) = fetch_ids(pool, "users") {
//         for id in ids {
//             let _ = sync_user(pool, &id).await;
//         }
//     }

//     // 2. pets
//     if let Ok(ids) = fetch_ids(pool, "pets") {
//         for id in ids {
//             let _ = sync_pet(pool, &id).await;
//         }
//     }

//     // 3. medical_history_entries
//     if let Ok(ids) = fetch_ids(pool, "medical_history_entries") {
//         for id in ids {
//             let _ = sync_medical_entry(pool, &id).await;
//         }
//     }

//     // 4. vaccinations
//     if let Ok(ids) = fetch_ids(pool, "vaccinations") {
//         for id in ids {
//             let _ = sync_vaccination(pool, &id).await;
//         }
//     }

//     // 5. grooming_events
//     if let Ok(ids) = fetch_ids(pool, "grooming_events") {
//         for id in ids {
//             let _ = sync_grooming_event(pool, &id).await;
//         }
//     }

//     // 6. hospitalizations
//     if let Ok(ids) = fetch_ids(pool, "hospitalizations") {
//         for id in ids {
//             let _ = sync_hospitalization(pool, &id).await;
//         }
//     }

//     // 7. clinics
//     if let Ok(ids) = fetch_ids(pool, "clinics") {
//         for id in ids {
//             let _ = sync_clinic(pool, &id).await;
//         }
//     }

//     // 8. lab_tests
//     if let Ok(ids) = fetch_ids(pool, "lab_tests") {
//         for id in ids {
//             let _ = sync_lab_test(pool, &id).await;
//         }
//     }

//     // 9. lab_analytes
//     if let Ok(ids) = fetch_ids(pool, "lab_analytes") {
//         for id in ids {
//             let _ = sync_lab_analyte(pool, &id).await;
//         }
//     }

//     // 10. lab_orders
//     if let Ok(ids) = fetch_ids(pool, "lab_orders") {
//         for id in ids {
//             let _ = sync_lab_order(pool, &id).await;
//         }
//     }

//     // 11. lab_results
//     if let Ok(ids) = fetch_ids(pool, "lab_results") {
//         for id in ids {
//             let _ = sync_lab_result(pool, &id).await;
//         }
//     }

//     // 12. opd_requests
//     if let Ok(ids) = fetch_ids(pool, "opd_requests") {
//         for id in ids {
//             let _ = sync_opd_request(pool, &id).await;
//         }
//     }

//     // 13. opd_consultations
//     if let Ok(ids) = fetch_ids(pool, "opd_consultations") {
//         for id in ids {
//             let _ = sync_opd_consultation(pool, &id).await;
//         }
//     }

//     // 14. opd_catalog_items
//     if let Ok(ids) = fetch_ids(pool, "opd_catalog_items") {
//         for id in ids {
//             let _ = sync_opd_catalog_item(pool, &id).await;
//         }
//     }

//     Ok(())
// }
