use mongodb::bson::{Bson, Document};
use mongodb::Client;
use rusqlite::{params, Connection};

use crate::sync::{DbPool, MONGO_DB};

pub struct PullStats {
    pub pulled: usize,
    pub deleted: usize,
}

/// Fetch documents from the single `petcare` database only.
async fn fetch_collection(
    client: &Client,
    collection_name: &str,
    since: Option<&str>,
) -> Result<Vec<Document>, String> {
    let collection = client
        .database(MONGO_DB)
        .collection::<Document>(collection_name);
    let filter = match since {
        Some(ts) if !ts.is_empty() => mongodb::bson::doc! {
            "$or": [
                { "synced_at": { "$gte": ts } },
                { "updated_at": { "$gte": ts } },
                { "created_at": { "$gte": ts } },
                { "deleted_at": { "$gte": ts } },
            ]
        },
        _ => mongodb::bson::doc! {},
    };
    let mut cursor = collection
        .find(filter)
        .await
        .map_err(|e| e.to_string())?;
    let mut docs = Vec::new();
    while cursor.advance().await.map_err(|e| e.to_string())? {
        docs.push(
            cursor
                .deserialize_current()
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(docs)
}

/// Cursor stamp for a document. Only `synced_at` is server-generated, so device
/// clocks can never push the cursor ahead of reality; the others are last-resort
/// fallbacks for documents written by very old builds.
fn doc_ts(doc: &Document) -> String {
    doc.get_str("synced_at")
        .or_else(|_| doc.get_str("updated_at"))
        .or_else(|_| doc.get_str("created_at"))
        .or_else(|_| doc.get_str("deleted_at"))
        .unwrap_or("")
        .to_string()
}

fn str_field(doc: &Document, key: &str) -> Result<String, String> {
    doc.get_str(key)
        .map(|s| s.to_string())
        .map_err(|_| format!("Missing or invalid string field '{key}'"))
}

fn opt_str(doc: &Document, key: &str) -> Option<String> {
    doc.get(key).and_then(|v| match v {
        Bson::String(s) => Some(s.clone()),
        Bson::Null => None,
        _ => None,
    })
}

fn opt_i64(doc: &Document, key: &str) -> Option<i64> {
    doc.get(key).and_then(|v| match v {
        Bson::Int32(n) => Some(*n as i64),
        Bson::Int64(n) => Some(*n),
        Bson::Double(n) => Some(*n as i64),
        Bson::Null => None,
        _ => None,
    })
}

fn opt_f64(doc: &Document, key: &str) -> Option<f64> {
    doc.get(key).and_then(|v| match v {
        Bson::Double(n) => Some(*n),
        Bson::Int32(n) => Some(*n as f64),
        Bson::Int64(n) => Some(*n as f64),
        Bson::Null => None,
        _ => None,
    })
}

fn bool_field(doc: &Document, key: &str) -> bool {
    doc.get(key).map(|v| match v {
        Bson::Boolean(b) => *b,
        Bson::Int32(n) => *n != 0,
        Bson::Int64(n) => *n != 0,
        _ => false,
    })
    .unwrap_or(false)
}

fn int_field(doc: &Document, key: &str, default: i64) -> i64 {
    opt_i64(doc, key).unwrap_or(default)
}

fn string_array_to_json(doc: &Document, key: &str) -> String {
    let arr = doc
        .get_array(key)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| match v {
                    Bson::String(s) => Some(s.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

fn medicines_to_json(doc: &Document, key: &str) -> String {
    let arr = doc.get_array(key).cloned().unwrap_or_default();
    let values: Vec<serde_json::Value> = arr
        .iter()
        .filter_map(|v| bson_to_json_value(v))
        .collect();
    serde_json::to_string(&values).unwrap_or_else(|_| "[]".to_string())
}

fn bson_to_json_value(bson: &Bson) -> Option<serde_json::Value> {
    match bson {
        Bson::Document(d) => {
            let mut map = serde_json::Map::new();
            for (k, v) in d {
                if let Some(j) = bson_to_json_value(v) {
                    map.insert(k.clone(), j);
                }
            }
            Some(serde_json::Value::Object(map))
        }
        Bson::String(s) => Some(serde_json::Value::String(s.clone())),
        Bson::Int32(n) => Some(serde_json::Value::Number((*n).into())),
        Bson::Int64(n) => Some(serde_json::Value::Number((*n).into())),
        Bson::Double(n) => serde_json::Number::from_f64(*n).map(serde_json::Value::Number),
        Bson::Boolean(b) => Some(serde_json::Value::Bool(*b)),
        Bson::Null => Some(serde_json::Value::Null),
        Bson::Array(items) => Some(serde_json::Value::Array(
            items.iter().filter_map(bson_to_json_value).collect(),
        )),
        _ => None,
    }
}

fn upsert_row(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<(), String> {
    conn.execute(sql, params).map_err(|e| e.to_string())?;
    Ok(())
}

/// Apply one remote row; never abort the whole pull for a single conflict.
fn upsert_row_soft(
    conn: &Connection,
    label: &str,
    collection: &str,
    record_id: &str,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    doc: &Document,
) -> bool {
    match upsert_row(conn, sql, params) {
        Ok(()) => {
            remote_won(conn, collection, record_id);
            note_doc_applied(doc);
            true
        }
        Err(e) => {
            eprintln!("MongoDB pull skipped {label}: {e}");
            note_soft_failed(doc, label);
            false
        }
    }
}

fn local_ts(conn: &Connection, table: &str, id: &str, column: &str) -> Option<String> {
    conn.query_row(
        &format!("SELECT {column} FROM {table} WHERE id = ?1"),
        params![id],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// Parse RFC3339 (or close) timestamps for LWW. Falls back to string compare.
fn parse_ts(raw: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&chrono::Utc));
    }
    // Some older rows used space instead of `T`.
    let normalized = s.replace(' ', "T");
    chrono::DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// True when remote should replace local (remote strictly newer, or local missing).
fn should_apply_remote(local: Option<String>, remote: Option<&str>) -> bool {
    match (local, remote) {
        (None, _) => true,
        (Some(_), None) => true,
        (Some(local_ts), Some(remote_ts)) => match (parse_ts(&local_ts), parse_ts(remote_ts)) {
            (Some(l), Some(r)) => r > l,
            _ => remote_ts > local_ts.as_str(),
        },
    }
}

/// Track max synced_at we actually observed in this pull batch.
fn bump_max_ts(max: &mut String, candidate: &str) {
    if candidate.is_empty() {
        return;
    }
    match (parse_ts(max.as_str()), parse_ts(candidate)) {
        (Some(a), Some(b)) if b > a => *max = candidate.to_string(),
        (None, Some(_)) => *max = candidate.to_string(),
        (None, None) if candidate > max.as_str() => *max = candidate.to_string(),
        _ => {}
    }
}

thread_local! {
    /// Max cursor stamp from docs that were *successfully applied* this pull.
    static APPLIED_MAX_TS: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    /// Oldest stamp among soft-failed docs — cursor must not leap past these.
    static SOFT_FAIL_MIN_TS: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn reset_applied_max_ts() {
    APPLIED_MAX_TS.with(|c| c.borrow_mut().clear());
    SOFT_FAIL_MIN_TS.with(|c| c.borrow_mut().clear());
}

fn note_doc_applied(doc: &Document) {
    APPLIED_MAX_TS.with(|c| bump_max_ts(&mut c.borrow_mut(), &doc_ts(doc)));
}

fn note_soft_failed(doc: &Document, label: &str) {
    let ts = doc_ts(doc);
    if ts.is_empty() {
        return;
    }
    eprintln!("MongoDB pull soft-fail hold for cursor: {label} @ {ts}");
    SOFT_FAIL_MIN_TS.with(|c| {
        let mut min = c.borrow_mut();
        if min.is_empty() {
            *min = ts;
            return;
        }
        // Keep the *oldest* soft-fail stamp so the cursor cannot leap past it.
        match (parse_ts(min.as_str()), parse_ts(&ts)) {
            (Some(a), Some(b)) if b < a => *min = ts,
            (None, Some(_)) => *min = ts,
            (None, None) if ts.as_str() < min.as_str() => *min = ts,
            _ => {}
        }
    });
}

/// Applied-max capped by oldest soft-fail so a permanently soft-skipped doc stays in
/// the incremental fetch window. Empty when there is nothing safe to advance to.
fn take_cursor_max_ts() -> String {
    let applied = APPLIED_MAX_TS.with(|c| std::mem::take(&mut *c.borrow_mut()));
    let soft_min = SOFT_FAIL_MIN_TS.with(|c| std::mem::take(&mut *c.borrow_mut()));
    if soft_min.is_empty() {
        return applied;
    }
    if applied.is_empty() {
        eprintln!(
            "MongoDB pull cursor held (soft-fail only; oldest soft-fail={soft_min})"
        );
        return String::new();
    }
    let capped = match (parse_ts(&applied), parse_ts(&soft_min)) {
        (Some(a), Some(s)) if a > s => {
            eprintln!(
                "MongoDB pull cursor capped at soft-fail stamp {soft_min} (applied was ahead)"
            );
            soft_min
        }
        (Some(_), Some(_)) => applied,
        _ if applied.as_str() > soft_min.as_str() => {
            eprintln!(
                "MongoDB pull cursor capped at soft-fail stamp {soft_min} (applied was ahead)"
            );
            soft_min
        }
        _ => applied,
    };
    capped
}

/// Prefer server `synced_at` for LWW so skewed device clocks cannot win.
fn remote_rev(doc: &Document) -> Option<String> {
    opt_str(doc, "synced_at")
        .or_else(|| opt_str(doc, "updated_at"))
        .or_else(|| opt_str(doc, "created_at"))
}

/// Upload queue snapshot held for the duration of one pull transaction.
const DIRTY_SNAPSHOT: &str = "pull_dirty_snapshot";

/// Remember the upload queue before merging remote rows. Merging fires the dirty
/// triggers, so the queue is restored from this snapshot before the pull commits.
fn snapshot_dirty(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(&format!(
        "CREATE TEMP TABLE IF NOT EXISTS {DIRTY_SNAPSHOT} (
             collection TEXT NOT NULL,
             record_id TEXT NOT NULL,
             PRIMARY KEY (collection, record_id)
         );
         DELETE FROM {DIRTY_SNAPSHOT};
         INSERT INTO {DIRTY_SNAPSHOT}(collection, record_id)
             SELECT collection, record_id FROM sync_dirty;"
    ))
    .map_err(|e| e.to_string())
}

/// Drop queue entries this merge created; keep every entry that was already queued.
fn restore_dirty(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(&format!(
        "DELETE FROM sync_dirty;
         INSERT OR IGNORE INTO sync_dirty(collection, record_id)
             SELECT collection, record_id FROM {DIRTY_SNAPSHOT};"
    ))
    .map_err(|e| e.to_string())
}

/// After a remote row wins, drop local dirty so we don't push a stale overwrite.
fn remote_won(conn: &Connection, collection: &str, id: &str) {
    let _ = crate::db::clear_dirty(conn, collection, id);
    let _ = conn.execute(
        &format!("DELETE FROM {DIRTY_SNAPSHOT} WHERE collection = ?1 AND record_id = ?2"),
        params![collection, id],
    );
}

/// The local row is newer than the cloud copy: keep it queued so this pull cannot
/// swallow the pending push when it restores the queue snapshot.
fn keep_local_dirty(conn: &Connection, collection: &str, id: &str) {
    let _ = crate::db::mark_dirty(conn, collection, id);
    let _ = conn.execute(
        &format!("INSERT OR IGNORE INTO {DIRTY_SNAPSHOT}(collection, record_id) VALUES (?1, ?2)"),
        params![collection, id],
    );
}

fn is_pending_delete(pending: &[String], id: &str) -> bool {
    pending.iter().any(|p| p == id)
}

/// Free a secondary UNIQUE key held by a different local row so remote can land.
fn clear_unique_conflict(
    conn: &Connection,
    table: &str,
    column: &str,
    value: &str,
    keep_id: &str,
) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    // Prefer renaming over deleting so local-only data is not lost silently.
    conn.execute(
        &format!(
            "UPDATE {table}
             SET {column} = {column} || '-dup-' || substr(id, 1, 8)
             WHERE {column} = ?1 AND id != ?2"
        ),
        params![value, keep_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn pull_users(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let (Ok(username), Ok(password_hash), Ok(display_name), Ok(role), Ok(created_at)) = (
            str_field(doc, "username"),
            str_field(doc, "password_hash"),
            str_field(doc, "display_name"),
            str_field(doc, "role"),
            str_field(doc, "created_at"),
        ) else {
            eprintln!("MongoDB pull skipped users/{id}: missing required fields");
            continue;
        };
        let active = if bool_field(doc, "active") { 1 } else { 0 };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "users", &id, "updated_at")
            .or_else(|| local_ts(conn, "users", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "users", &id);
            continue;
        }
        // Never let a blank-password cloud stub overwrite a real local hash.
        if password_hash.is_empty() {
            let local_hash: Option<String> = conn
                .query_row(
                    "SELECT password_hash FROM users WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .ok();
            if local_hash.as_deref().is_some_and(|h| !h.is_empty()) {
                eprintln!("MongoDB pull skipped users/{id}: blank remote password");
                keep_local_dirty(conn, "users", &id);
                continue;
            }
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| created_at.clone());

        // Same username, different device-seeded UUID: remap FKs then replace.
        // Deleting without remap left sessions pointing at missing users → Close OPD FK errors.
        let mut old_ids = Vec::new();
        {
            let mut stmt = match conn.prepare("SELECT id FROM users WHERE username = ?1 AND id != ?2")
            {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("MongoDB pull skipped users/{id}: {e}");
                    continue;
                }
            };
            let rows = match stmt.query_map(params![username, id], |r| r.get::<_, String>(0)) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("MongoDB pull skipped users/{id}: {e}");
                    continue;
                }
            };
            for row in rows {
                if let Ok(old_id) = row {
                    old_ids.push(old_id);
                }
            }
        }
        for old_id in &old_ids {
            let _ = conn.execute(
                "UPDATE opd_consultations SET vet_id = ?1 WHERE vet_id = ?2",
                params![id, old_id],
            );
            let _ = conn.execute(
                "UPDATE opd_requests SET assigned_vet_id = ?1 WHERE assigned_vet_id = ?2",
                params![id, old_id],
            );
            let _ = conn.execute(
                "UPDATE opd_requests SET requested_by_user_id = ?1 WHERE requested_by_user_id = ?2",
                params![id, old_id],
            );
            let _ = conn.execute("DELETE FROM users WHERE id = ?1", params![old_id]);
        }

        if upsert_row_soft(
            conn,
            &format!("users/{id}"),
            "users",
            &id,
            "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               username = excluded.username,
               password_hash = excluded.password_hash,
               display_name = excluded.display_name,
               role = excluded.role,
               created_at = excluded.created_at,
               active = excluded.active,
               updated_at = excluded.updated_at",
            &[
                &id,
                &username,
                &password_hash,
                &display_name,
                &role,
                &created_at,
                &active,
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_pets(conn: &Connection, docs: &[Document], pending: &[String]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        if is_pending_delete(pending, &id) {
            continue;
        }
        // Prefer server synced_at for LWW; fall back for legacy Atlas pets.
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "pets", &id, "updated_at")
            .or_else(|| local_ts(conn, "pets", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "pets", &id);
            continue;
        }
        let (Ok(card_id), Ok(name)) = (str_field(doc, "card_id"), str_field(doc, "name")) else {
            eprintln!("MongoDB pull skipped pets/{id}: missing required fields");
            continue;
        };
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let created_at = str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone());
        let _ = clear_unique_conflict(conn, "pets", "card_id", &card_id, &id);
        if upsert_row_soft(
            conn,
            &format!("pets/{id}"),
            "pets",
            &id,
            "INSERT INTO pets (
                id, card_id, name, species, breed, age, date_of_birth, sex, weight,
                vaccine_status, deworming_status, owner_name, owner_phone,
                owner_address, owner_email, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
               card_id = excluded.card_id,
               name = excluded.name,
               species = excluded.species,
               breed = excluded.breed,
               age = excluded.age,
               date_of_birth = excluded.date_of_birth,
               sex = excluded.sex,
               weight = excluded.weight,
               vaccine_status = excluded.vaccine_status,
               deworming_status = excluded.deworming_status,
               owner_name = excluded.owner_name,
               owner_phone = excluded.owner_phone,
               owner_address = excluded.owner_address,
               owner_email = excluded.owner_email,
               notes = excluded.notes,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            &[
                &id,
                &card_id,
                &name,
                &opt_str(doc, "species"),
                &opt_str(doc, "breed"),
                &opt_str(doc, "age"),
                &opt_str(doc, "date_of_birth"),
                &opt_str(doc, "sex"),
                &opt_str(doc, "weight"),
                &opt_str(doc, "vaccine_status"),
                &opt_str(doc, "deworming_status"),
                &opt_str(doc, "owner_name"),
                &opt_str(doc, "owner_phone"),
                &opt_str(doc, "owner_address"),
                &opt_str(doc, "owner_email"),
                &opt_str(doc, "notes"),
                &created_at,
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_medical_entries(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "medical_history_entries", &id, "updated_at")
            .or_else(|| local_ts(conn, "medical_history_entries", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            // Local edit is newer — keep/re-queue dirty so the update pushes.
            keep_local_dirty(conn, "medical_history_entries", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let (Ok(pet_id), Ok(entry_type)) =
            (str_field(doc, "pet_id"), str_field(doc, "entry_type"))
        else {
            eprintln!("MongoDB pull skipped medical_history_entries/{id}: missing required fields");
            continue;
        };
        if upsert_row_soft(
            conn,
            &format!("medical_history_entries/{id}"),
            "medical_history_entries",
            &id,
            "INSERT INTO medical_history_entries (
                id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note,
                administered_date, next_due_date, reminder_days_before, external_file_path,
                lab_result_id, created_at, external_file_paths, body_weight, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               entry_type = excluded.entry_type,
               title = excluded.title,
               body = excluded.body,
               dx_items = excluded.dx_items,
               ddx_items = excluded.ddx_items,
               dx_note = excluded.dx_note,
               ddx_note = excluded.ddx_note,
               administered_date = excluded.administered_date,
               next_due_date = excluded.next_due_date,
               reminder_days_before = excluded.reminder_days_before,
               external_file_path = excluded.external_file_path,
               lab_result_id = excluded.lab_result_id,
               created_at = excluded.created_at,
               external_file_paths = excluded.external_file_paths,
               body_weight = excluded.body_weight,
               updated_at = excluded.updated_at",
            &[
                &id,
                &pet_id,
                &entry_type,
                &opt_str(doc, "title"),
                &opt_str(doc, "body"),
                &string_array_to_json(doc, "dx_items"),
                &string_array_to_json(doc, "ddx_items"),
                &opt_str(doc, "dx_note"),
                &opt_str(doc, "ddx_note"),
                &opt_str(doc, "administered_date"),
                &opt_str(doc, "next_due_date"),
                &opt_i64(doc, "reminder_days_before"),
                &opt_str(doc, "external_file_path"),
                &opt_str(doc, "lab_result_id"),
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &string_array_to_json(doc, "external_file_paths"),
                &opt_str(doc, "body_weight"),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_vaccinations(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "vaccinations", &id, "updated_at")
            .or_else(|| local_ts(conn, "vaccinations", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "vaccinations", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let (Ok(pet_id), Ok(vaccine_name)) =
            (str_field(doc, "pet_id"), str_field(doc, "vaccine_name"))
        else {
            eprintln!("MongoDB pull skipped vaccinations/{id}: missing required fields");
            continue;
        };
        if upsert_row_soft(
            conn,
            &format!("vaccinations/{id}"),
            "vaccinations",
            &id,
            "INSERT INTO vaccinations (
                id, pet_id, vaccine_name, administered_date, next_due_date,
                reminder_days_before, notes, created_at, body_weight, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               vaccine_name = excluded.vaccine_name,
               administered_date = excluded.administered_date,
               next_due_date = excluded.next_due_date,
               reminder_days_before = excluded.reminder_days_before,
               notes = excluded.notes,
               created_at = excluded.created_at,
               body_weight = excluded.body_weight,
               updated_at = excluded.updated_at",
            &[
                &id,
                &pet_id,
                &vaccine_name,
                &opt_str(doc, "administered_date"),
                &opt_str(doc, "next_due_date"),
                &opt_i64(doc, "reminder_days_before"),
                &opt_str(doc, "notes"),
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &opt_str(doc, "body_weight"),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_grooming_events(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "grooming_events", &id, "updated_at")
            .or_else(|| local_ts(conn, "grooming_events", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "grooming_events", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        if upsert_row_soft(
            conn,
            &format!("grooming_events/{id}"),
            "grooming_events",
            &id,
            "INSERT INTO grooming_events (
                id, pet_id, service_type, administered_date, next_due_date,
                reminder_days_before, performed_date, notes, created_at, body_weight, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               service_type = excluded.service_type,
               administered_date = excluded.administered_date,
               next_due_date = excluded.next_due_date,
               reminder_days_before = excluded.reminder_days_before,
               performed_date = excluded.performed_date,
               notes = excluded.notes,
               created_at = excluded.created_at,
               body_weight = excluded.body_weight,
               updated_at = excluded.updated_at",
            &[
                &id,
                &str_field(doc, "pet_id").unwrap_or_default(),
                &str_field(doc, "service_type").unwrap_or_default(),
                &opt_str(doc, "administered_date"),
                &opt_str(doc, "next_due_date"),
                &opt_i64(doc, "reminder_days_before"),
                &str_field(doc, "performed_date").unwrap_or_default(),
                &opt_str(doc, "notes"),
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &opt_str(doc, "body_weight"),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_hospitalizations(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "hospitalizations", &id, "updated_at")
            .or_else(|| local_ts(conn, "hospitalizations", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "hospitalizations", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        if upsert_row_soft(
            conn,
            &format!("hospitalizations/{id}"),
            "hospitalizations",
            &id,
            "INSERT INTO hospitalizations (
                id, pet_id, cage_number, check_in_date, check_out_date, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               cage_number = excluded.cage_number,
               check_in_date = excluded.check_in_date,
               check_out_date = excluded.check_out_date,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            &[
                &id,
                &str_field(doc, "pet_id").unwrap_or_default(),
                &str_field(doc, "cage_number").unwrap_or_default(),
                &str_field(doc, "check_in_date").unwrap_or_default(),
                &opt_str(doc, "check_out_date"),
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_clinics(conn: &Connection, docs: &[Document], pending: &[String]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        if is_pending_delete(pending, &id) {
            continue;
        }
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "clinics", &id, "updated_at");
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "clinics", &id);
            continue;
        }
        if upsert_row_soft(
            conn,
            &format!("clinics/{id}"),
            "clinics",
            &id,
            "INSERT INTO clinics (id, name, email, address, phone, timing, created_at, updated_at, logo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               email = excluded.email,
               address = excluded.address,
               phone = excluded.phone,
               timing = excluded.timing,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at,
               logo = excluded.logo",
            &[
                &id,
                &str_field(doc, "name").unwrap_or_default(),
                &str_field(doc, "email").unwrap_or_default(),
                &str_field(doc, "address").unwrap_or_default(),
                &str_field(doc, "phone").unwrap_or_default(),
                &str_field(doc, "timing").unwrap_or_default(),
                &str_field(doc, "created_at").unwrap_or_default(),
                &str_field(doc, "updated_at").unwrap_or_default(),
                &opt_str(doc, "logo"),
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_lab_tests(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "lab_tests", &id, "updated_at")
            .or_else(|| local_ts(conn, "lab_tests", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "lab_tests", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| crate::sync::approx_server_now());
        let active = int_field(doc, "active", 1);
        if upsert_row_soft(
            conn,
            &format!("lab_tests/{id}"),
            "lab_tests",
            &id,
            "INSERT INTO lab_tests (id, name, code, default_report_hours, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               code = excluded.code,
               default_report_hours = excluded.default_report_hours,
               active = excluded.active,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            &[
                &id,
                &str_field(doc, "name").unwrap_or_default(),
                &opt_str(doc, "code"),
                &opt_i64(doc, "default_report_hours"),
                &active,
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_lab_analytes(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "lab_analytes", &id, "updated_at");
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "lab_analytes", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| crate::sync::approx_server_now());
        let sort_order = int_field(doc, "sort_order", 0);
        if upsert_row_soft(
            conn,
            &format!("lab_analytes/{id}"),
            "lab_analytes",
            &id,
            "INSERT INTO lab_analytes (id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               lab_test_id = excluded.lab_test_id,
               name = excluded.name,
               unit = excluded.unit,
               normal_min = excluded.normal_min,
               normal_max = excluded.normal_max,
               sort_order = excluded.sort_order,
               remarks = excluded.remarks,
               updated_at = excluded.updated_at",
            &[
                &id,
                &str_field(doc, "lab_test_id").unwrap_or_default(),
                &str_field(doc, "name").unwrap_or_default(),
                &opt_str(doc, "unit"),
                &opt_f64(doc, "normal_min"),
                &opt_f64(doc, "normal_max"),
                &sort_order,
                &opt_str(doc, "remarks"),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_lab_orders(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let (Ok(pet_id), Ok(lab_test_id), Ok(status), Ok(created_at)) = (
            str_field(doc, "pet_id"),
            str_field(doc, "lab_test_id"),
            str_field(doc, "status"),
            str_field(doc, "created_at"),
        ) else {
            eprintln!("MongoDB pull skipped lab_orders/{id}: missing required fields");
            continue;
        };
        let receipt_number = opt_str(doc, "receipt_number");
        if let Some(ref receipt) = receipt_number {
            let _ = clear_unique_conflict(conn, "lab_orders", "receipt_number", receipt, &id);
        }
        let remote_updated = remote_rev(doc).or_else(|| Some(created_at.clone()));
        let local_updated = local_ts(conn, "lab_orders", &id, "updated_at")
            .or_else(|| local_ts(conn, "lab_orders", &id, "created_at"));
        let local_status: Option<String> = conn
            .query_row(
                "SELECT status FROM lab_orders WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        // Saving a report marks the order completed locally. Don't let an
        // older pending cloud copy revert that status — but a *newer* pending
        // (report deleted / reopened on another device) must apply.
        if local_status.as_deref() == Some("completed")
            && status == "pending"
            && !should_apply_remote(local_updated.clone(), remote_updated.as_deref())
        {
            keep_local_dirty(conn, "lab_orders", &id);
            continue;
        }
        if !should_apply_remote(local_updated, remote_updated.as_deref())
            && local_status.is_some()
            && !(status == "completed" && local_status.as_deref() == Some("pending"))
        {
            keep_local_dirty(conn, "lab_orders", &id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| crate::sync::approx_server_now());
        if upsert_row_soft(
            conn,
            &format!("lab_orders/{id}"),
            "lab_orders",
            &id,
            "INSERT INTO lab_orders (id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               lab_test_id = excluded.lab_test_id,
               receipt_number = excluded.receipt_number,
               tentative_report_at = excluded.tentative_report_at,
               status = excluded.status,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            &[
                &id,
                &pet_id,
                &lab_test_id,
                &receipt_number,
                &opt_str(doc, "tentative_report_at"),
                &status,
                &created_at,
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_lab_results(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let result_id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "lab_results", &result_id, "updated_at")
            .or_else(|| local_ts(conn, "lab_results", &result_id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "lab_results", &result_id);
            continue;
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| crate::sync::approx_server_now());

        // Snapshot prior values so a partial apply can restore them.
        let prior_values = snapshot_lab_result_values(conn, &result_id);

        if let Err(e) = upsert_row(
            conn,
            "INSERT INTO lab_results (id, lab_order_id, pet_id, lab_test_id, created_at, notes, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               lab_order_id = excluded.lab_order_id,
               pet_id = excluded.pet_id,
               lab_test_id = excluded.lab_test_id,
               created_at = excluded.created_at,
               notes = excluded.notes,
               updated_at = excluded.updated_at",
            &[
                &result_id,
                &str_field(doc, "lab_order_id").unwrap_or_default(),
                &str_field(doc, "pet_id").unwrap_or_default(),
                &str_field(doc, "lab_test_id").unwrap_or_default(),
                &str_field(doc, "created_at").unwrap_or_else(|_| updated_at.clone()),
                &opt_str(doc, "notes"),
                &updated_at,
            ],
        ) {
            eprintln!("MongoDB pull skipped lab_results/{result_id}: {e}");
            note_soft_failed(doc, &format!("lab_results/{result_id}"));
            continue;
        }

        let _ = conn.execute(
            "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
            params![result_id],
        );

        let mut values_ok = true;
        if let Ok(values) = doc.get_array("values") {
            for value in values {
                if let Bson::Document(v) = value {
                    let vid = match str_field(v, "id") {
                        Ok(x) => x,
                        Err(_) => continue,
                    };
                    if let Err(e) = upsert_row(
                        conn,
                        "INSERT INTO lab_result_values (
                            id, lab_result_id, analyte_id, analyte_name, unit,
                            normal_min, normal_max, observed_value, remarks
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                         ON CONFLICT(id) DO UPDATE SET
                           lab_result_id = excluded.lab_result_id,
                           analyte_id = excluded.analyte_id,
                           analyte_name = excluded.analyte_name,
                           unit = excluded.unit,
                           normal_min = excluded.normal_min,
                           normal_max = excluded.normal_max,
                           observed_value = excluded.observed_value,
                           remarks = excluded.remarks",
                        &[
                            &vid,
                            &result_id,
                            &str_field(v, "analyte_id").unwrap_or_default(),
                            &str_field(v, "analyte_name").unwrap_or_default(),
                            &opt_str(v, "unit"),
                            &opt_f64(v, "normal_min"),
                            &opt_f64(v, "normal_max"),
                            &str_field(v, "observed_value").unwrap_or_default(),
                            &opt_str(v, "remarks"),
                        ],
                    ) {
                        values_ok = false;
                        eprintln!(
                            "MongoDB pull skipped lab_result_values/{vid} for {result_id}: {e}"
                        );
                    }
                }
            }
        }
        if !values_ok {
            // Restore prior report so peers never briefly see an empty result.
            let _ = conn.execute(
                "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
                params![result_id],
            );
            restore_lab_result_values(conn, &result_id, &prior_values);
            note_soft_failed(doc, &format!("lab_results/{result_id}/values"));
            continue;
        }
        remote_won(conn, "lab_results", &result_id);
        note_doc_applied(doc);
        count += 1;
    }
    Ok(count)
}

#[derive(Clone)]
struct LabValueSnap {
    id: String,
    analyte_id: String,
    analyte_name: String,
    unit: Option<String>,
    normal_min: Option<f64>,
    normal_max: Option<f64>,
    observed_value: String,
    remarks: Option<String>,
}

fn snapshot_lab_result_values(conn: &Connection, result_id: &str) -> Vec<LabValueSnap> {
    let mut stmt = match conn.prepare(
        "SELECT id, analyte_id, analyte_name, unit, normal_min, normal_max, observed_value, remarks
         FROM lab_result_values WHERE lab_result_id = ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map(params![result_id], |r| {
        Ok(LabValueSnap {
            id: r.get(0)?,
            analyte_id: r.get(1)?,
            analyte_name: r.get(2)?,
            unit: r.get(3)?,
            normal_min: r.get(4)?,
            normal_max: r.get(5)?,
            observed_value: r.get(6)?,
            remarks: r.get(7)?,
        })
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(|r| r.ok()).collect()
}

fn restore_lab_result_values(conn: &Connection, result_id: &str, snaps: &[LabValueSnap]) {
    for v in snaps {
        let _ = upsert_row(
            conn,
            "INSERT INTO lab_result_values (
                id, lab_result_id, analyte_id, analyte_name, unit,
                normal_min, normal_max, observed_value, remarks
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               lab_result_id = excluded.lab_result_id,
               analyte_id = excluded.analyte_id,
               analyte_name = excluded.analyte_name,
               unit = excluded.unit,
               normal_min = excluded.normal_min,
               normal_max = excluded.normal_max,
               observed_value = excluded.observed_value,
               remarks = excluded.remarks",
            &[
                &v.id,
                &result_id,
                &v.analyte_id,
                &v.analyte_name,
                &v.unit,
                &v.normal_min,
                &v.normal_max,
                &v.observed_value,
                &v.remarks,
            ],
        );
    }
}

fn pull_opd_requests(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let remote_status = str_field(doc, "status").unwrap_or_default();
        let local_status: Option<String> = conn
            .query_row(
                "SELECT status FROM opd_requests WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "opd_requests", &id, "updated_at")
            .or_else(|| local_ts(conn, "opd_requests", &id, "created_at"));

        // Prefer later clinical status over clock skew (completed > in_progress > pending).
        let status_rank = |s: &str| -> i32 {
            match s {
                "completed" => 3,
                "in_progress" => 2,
                "pending" => 1,
                _ => 0,
            }
        };
        let force_reopen = local_status.as_deref() == Some("completed")
            && remote_status == "pending"
            && opt_str(doc, "completed_at").is_none()
            && should_apply_remote(local_updated.clone(), remote_updated.as_deref());
        // Reopen is pull-before-push: keep a fresh local pending row over an older cloud completed.
        let local_reopen_wins = local_status.as_deref() == Some("pending")
            && remote_status == "completed"
            && local_updated.is_some()
            && !should_apply_remote(local_updated.clone(), remote_updated.as_deref());
        if local_reopen_wins {
            keep_local_dirty(conn, "opd_requests", &id);
            continue;
        }
        // Apply a newer cloud reopen before the status-rank guard — otherwise a local
        // completed row permanently refuses the pending reopen from another device.
        if force_reopen {
            // fall through to upsert
        } else {
            let force_remote = match &local_status {
                Some(ls) if status_rank(&remote_status) > status_rank(ls) => true,
                Some(ls) if status_rank(&remote_status) < status_rank(ls) => {
                    // Local already further along — keep it and re-queue push.
                    keep_local_dirty(conn, "opd_requests", &id);
                    continue;
                }
                _ => false,
            };
            if !force_remote && !should_apply_remote(local_updated, remote_updated.as_deref()) {
                keep_local_dirty(conn, "opd_requests", &id);
                continue;
            }
        }
        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        if upsert_row_soft(
            conn,
            &format!("opd_requests/{id}"),
            "opd_requests",
            &id,
            "INSERT INTO opd_requests (
                id, pet_id, requested_by_user_id, requested_by_name, status,
                assigned_vet_id, assigned_vet_name, created_at, claimed_at, completed_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               pet_id = excluded.pet_id,
               requested_by_user_id = excluded.requested_by_user_id,
               requested_by_name = excluded.requested_by_name,
               status = excluded.status,
               assigned_vet_id = excluded.assigned_vet_id,
               assigned_vet_name = excluded.assigned_vet_name,
               created_at = excluded.created_at,
               claimed_at = excluded.claimed_at,
               completed_at = excluded.completed_at,
               updated_at = excluded.updated_at",
            &[
                &id,
                &str_field(doc, "pet_id").unwrap_or_default(),
                &str_field(doc, "requested_by_user_id").unwrap_or_default(),
                &str_field(doc, "requested_by_name").unwrap_or_default(),
                &remote_status,
                &opt_str(doc, "assigned_vet_id"),
                &opt_str(doc, "assigned_vet_name"),
                &str_field(doc, "created_at").unwrap_or_default(),
                &opt_str(doc, "claimed_at"),
                &opt_str(doc, "completed_at"),
                &updated_at,
            ],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn pull_opd_consultations(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let request_id = match str_field(doc, "request_id") {
            Ok(v) => v,
            Err(e) => {
                eprintln!("MongoDB pull skipped opd_consultations/{id}: {e}");
                continue;
            }
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "opd_consultations", &id, "updated_at")
            .or_else(|| local_ts(conn, "opd_consultations", &id, "created_at"));

        if !should_apply_remote(local_updated.clone(), remote_updated.as_deref()) {
            // Local edit is newer — keep/re-queue dirty so the update pushes.
            keep_local_dirty(conn, "opd_consultations", &id);
            continue;
        }

        // One consultation per OPD request — drop stale local siblings only.
        // Canonical create id is `opd-cons-{request_id}`. Only tombstone siblings
        // to Mongo when the winning remote row is that canonical id (safe cleanup
        // of legacy duplicates). Never tombstone when applying a non-canonical
        // winner — that could delete a still-valid peer copy.
        let canonical_id = format!("opd-cons-{request_id}");
        let others: Vec<String> = match conn.prepare(
            "SELECT id FROM opd_consultations WHERE request_id = ?1 AND id != ?2",
        ) {
            Ok(mut stmt) => match stmt.query_map(params![request_id, id], |r| {
                r.get::<_, String>(0)
            }) {
                Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                Err(e) => {
                    eprintln!(
                        "MongoDB pull opd_consultations/{id}: could not list siblings: {e}"
                    );
                    Vec::new()
                }
            },
            Err(e) => {
                eprintln!(
                    "MongoDB pull opd_consultations/{id}: could not prepare sibling query: {e}"
                );
                Vec::new()
            }
        };
        for other_id in others {
            let _ = conn.execute(
                "DELETE FROM opd_consultations WHERE id = ?1",
                params![other_id],
            );
            if id == canonical_id {
                let _ = crate::db::queue_remote_delete(conn, "opd_consultations", &other_id);
            }
        }

        // Ensure vet exists so FK does not fail if we re-enable checks later.
        let vet_id = str_field(doc, "vet_id").unwrap_or_default();
        let vet_name = str_field(doc, "vet_name").unwrap_or_default();
        if !vet_id.is_empty() {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM users WHERE id = ?1",
                    params![vet_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if exists == 0 {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, created_at, active)
                     VALUES (?1, ?2, '', ?3, 'vet', ?4, 1)",
                    params![
                        vet_id,
                        format!("synced_{}", &vet_id[..8.min(vet_id.len())]),
                        if vet_name.is_empty() {
                            "Synced vet".to_string()
                        } else {
                            vet_name.clone()
                        },
                        chrono::Utc::now().to_rfc3339(),
                    ],
                );
            }
        }

        let updated_at = remote_updated
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let vaccinated = if bool_field(doc, "vaccinated") { 1_i64 } else { 0_i64 };
        let deworming = if bool_field(doc, "deworming") { 1_i64 } else { 0_i64 };
        if let Err(e) = upsert_row(
            conn,
            "INSERT INTO opd_consultations (
                id, request_id, pet_id, vet_id, vet_name, doctor_signature_name,
                temperature, physical_exam, history_observations, dx_items, ddx_items,
                diagnosis_note, differential_diagnosis_note, symptoms,
                recommended_lab_test_ids, recommended_lab_test_names, custom_lab_tests,
                medicines_json, clinical_treatment_remark, in_house_prescription,
                recommended_food, next_visit_at, created_at, body_weight, updated_at,
                vaccinated, deworming, prognosis
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)
             ON CONFLICT(id) DO UPDATE SET
               request_id = excluded.request_id,
               pet_id = excluded.pet_id,
               vet_id = excluded.vet_id,
               vet_name = excluded.vet_name,
               doctor_signature_name = excluded.doctor_signature_name,
               temperature = excluded.temperature,
               physical_exam = excluded.physical_exam,
               history_observations = excluded.history_observations,
               dx_items = excluded.dx_items,
               ddx_items = excluded.ddx_items,
               diagnosis_note = excluded.diagnosis_note,
               differential_diagnosis_note = excluded.differential_diagnosis_note,
               symptoms = excluded.symptoms,
               recommended_lab_test_ids = excluded.recommended_lab_test_ids,
               recommended_lab_test_names = excluded.recommended_lab_test_names,
               custom_lab_tests = excluded.custom_lab_tests,
               medicines_json = excluded.medicines_json,
               clinical_treatment_remark = excluded.clinical_treatment_remark,
               in_house_prescription = excluded.in_house_prescription,
               recommended_food = excluded.recommended_food,
               next_visit_at = excluded.next_visit_at,
               created_at = excluded.created_at,
               body_weight = excluded.body_weight,
               updated_at = excluded.updated_at,
               vaccinated = excluded.vaccinated,
               deworming = excluded.deworming,
               prognosis = excluded.prognosis",
            &[
                &id,
                &request_id,
                &str_field(doc, "pet_id").unwrap_or_default(),
                &vet_id,
                &vet_name,
                &str_field(doc, "doctor_signature_name").unwrap_or_default(),
                &opt_str(doc, "temperature"),
                &opt_str(doc, "physical_exam"),
                &string_array_to_json(doc, "history_observations"),
                &string_array_to_json(doc, "dx_items"),
                &string_array_to_json(doc, "ddx_items"),
                &opt_str(doc, "diagnosis_note"),
                &opt_str(doc, "differential_diagnosis_note"),
                &string_array_to_json(doc, "symptoms"),
                &string_array_to_json(doc, "recommended_lab_test_ids"),
                &string_array_to_json(doc, "recommended_lab_test_names"),
                &string_array_to_json(doc, "custom_lab_tests"),
                &medicines_to_json(doc, "medicines"),
                &opt_str(doc, "clinical_treatment_remark"),
                &opt_str(doc, "in_house_prescription"),
                &opt_str(doc, "recommended_food"),
                &opt_str(doc, "next_visit_at"),
                &str_field(doc, "created_at").unwrap_or_default(),
                &opt_str(doc, "body_weight"),
                &updated_at,
                &vaccinated,
                &deworming,
                &opt_str(doc, "prognosis"),
            ],
        ) {
            eprintln!("MongoDB pull skipped opd_consultations/{id}: {e}");
            continue;
        }
        remote_won(conn, "opd_consultations", &id);
        note_doc_applied(doc);
        count += 1;
    }
    Ok(count)
}

fn pull_opd_catalog_items(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut count = 0;
    for doc in docs {
        let id = match str_field(doc, "id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let (Ok(item_type), Ok(name), Ok(created_at)) = (
            str_field(doc, "type"),
            str_field(doc, "name"),
            str_field(doc, "created_at"),
        ) else {
            eprintln!("MongoDB pull skipped opd_catalog_items/{id}: missing required fields");
            continue;
        };
        let remote_updated = remote_rev(doc);
        let local_updated = local_ts(conn, "opd_catalog_items", &id, "updated_at")
            .or_else(|| local_ts(conn, "opd_catalog_items", &id, "created_at"));
        if !should_apply_remote(local_updated, remote_updated.as_deref()) {
            keep_local_dirty(conn, "opd_catalog_items", &id);
            continue;
        }
        let updated_at = remote_updated.unwrap_or_else(|| created_at.clone());
        let active = if bool_field(doc, "active") { 1 } else { 0 };
        if upsert_row_soft(
            conn,
            &format!("opd_catalog_items/{id}"),
            "opd_catalog_items",
            &id,
            "INSERT INTO opd_catalog_items (id, type, name, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               type = excluded.type,
               name = excluded.name,
               active = excluded.active,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            &[&id, &item_type, &name, &active, &created_at, &updated_at],
            doc,
        ) {
            count += 1;
        }
    }
    Ok(count)
}

fn apply_tombstones(conn: &Connection, docs: &[Document]) -> Result<usize, String> {
    let mut deleted = 0usize;
    for doc in docs {
        let collection = match str_field(doc, "collection") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let record_id = match str_field(doc, "record_id") {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Never resurrect something we are still trying to delete locally.
        let pending = match crate::db::pending_delete_ids(conn, &collection) {
            Ok(ids) => ids,
            Err(e) => {
                eprintln!(
                    "MongoDB pull tombstone skipped {collection}/{record_id}: pending list failed: {e}"
                );
                continue;
            }
        };
        if pending.iter().any(|id| id == &record_id) {
            continue;
        }

        let table = match collection.as_str() {
            "users" => "users",
            "pets" => "pets",
            "medical_history_entries" => "medical_history_entries",
            "vaccinations" => "vaccinations",
            "grooming_events" => "grooming_events",
            "hospitalizations" => "hospitalizations",
            "clinics" => "clinics",
            "lab_tests" => "lab_tests",
            "lab_analytes" => "lab_analytes",
            "lab_orders" => "lab_orders",
            "lab_results" => "lab_results",
            "opd_requests" => "opd_requests",
            "opd_consultations" => "opd_consultations",
            "opd_catalog_items" => "opd_catalog_items",
            _ => continue,
        };

        if table == "lab_results" {
            if let Err(e) = conn.execute(
                "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
                params![record_id],
            ) {
                eprintln!(
                    "MongoDB pull tombstone skipped lab_result_values for {record_id}: {e}"
                );
                continue;
            }
        }

        match conn.execute(
            &format!("DELETE FROM {table} WHERE id = ?1"),
            params![record_id],
        ) {
            Ok(n) => deleted += n,
            Err(e) => {
                eprintln!("MongoDB pull tombstone skipped {collection}/{record_id}: {e}");
            }
        }
    }
    Ok(deleted)
}

fn filter_pending(docs: Vec<Document>, pending: &[String]) -> Vec<Document> {
    if pending.is_empty() {
        return docs;
    }
    docs.into_iter()
        .filter(|doc| {
            doc.get_str("id")
                .map(|id| !pending.iter().any(|p| p == id))
                .unwrap_or(true)
        })
        .collect()
}

pub async fn pull_all_data(pool: &DbPool) -> Result<PullStats, String> {
    let client = crate::sync::get_mongo_client()
        .await
        .ok_or_else(|| "MongoDB connection not configured or offline".to_string())?;

    let since = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        crate::db::sync_state_get(&conn, "pull_cursor")
    };
    // Overlap window: concurrent peer writes (pets + related data on other
    // devices) can land while this pull's find() is already in flight. A tiny
    // 2s saved lookback was not enough and permanently skipped those rows once
    // the cursor jumped ahead via other collections in the same batch.
    const PULL_OVERLAP_SECS: i64 = 600; // 10 minutes
    let since_query = since.as_ref().and_then(|s| {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        parse_ts(s).map(|dt| {
            crate::sync::canonical_ts(dt - chrono::Duration::seconds(PULL_OVERLAP_SECS))
        })
    });
    let since_ref = since_query.as_deref().filter(|s| !s.is_empty());

    // Fetch all collections in parallel — biggest latency win for live devices.
    let (
        users,
        pets,
        medical,
        vaccinations,
        grooming,
        hospitalizations,
        clinics,
        lab_tests,
        lab_analytes,
        lab_orders,
        lab_results,
        opd_requests,
        opd_consultations,
        opd_catalog_items,
        tombstones,
    ) = tokio::join!(
        fetch_collection(client, "users", since_ref),
        fetch_collection(client, "pets", since_ref),
        fetch_collection(client, "medical_history_entries", since_ref),
        fetch_collection(client, "vaccinations", since_ref),
        fetch_collection(client, "grooming_events", since_ref),
        fetch_collection(client, "hospitalizations", since_ref),
        fetch_collection(client, "clinics", since_ref),
        fetch_collection(client, "lab_tests", since_ref),
        fetch_collection(client, "lab_analytes", since_ref),
        fetch_collection(client, "lab_orders", since_ref),
        fetch_collection(client, "lab_results", since_ref),
        fetch_collection(client, "opd_requests", since_ref),
        fetch_collection(client, "opd_consultations", since_ref),
        fetch_collection(client, "opd_catalog_items", since_ref),
        fetch_collection(client, "sync_tombstones", since_ref),
    );

    // Fail closed: never advance the cursor if any collection fetch failed.
    // Treating Err as [] previously caused devices to skip forever.
    macro_rules! need {
        ($name:expr, $r:expr) => {
            match $r {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("MongoDB fetch failed for {}: {e}", $name);
                    return Err(format!("MongoDB fetch failed for {}: {e}", $name));
                }
            }
        };
    }

    let users = need!("users", users);
    let pets = need!("pets", pets);
    let medical = need!("medical_history_entries", medical);
    let vaccinations = need!("vaccinations", vaccinations);
    let grooming = need!("grooming_events", grooming);
    let hospitalizations = need!("hospitalizations", hospitalizations);
    let clinics = need!("clinics", clinics);
    let lab_tests = need!("lab_tests", lab_tests);
    let lab_analytes = need!("lab_analytes", lab_analytes);
    let lab_orders = need!("lab_orders", lab_orders);
    let lab_results = need!("lab_results", lab_results);
    let opd_requests = need!("opd_requests", opd_requests);
    let opd_consultations = need!("opd_consultations", opd_consultations);
    let opd_catalog_items = need!("opd_catalog_items", opd_catalog_items);
    let tombstones = need!("sync_tombstones", tombstones);

    // Cursor advances only from docs that were successfully applied (not merely fetched).
    reset_applied_max_ts();

    let conn = pool.get().map_err(|e| e.to_string())?;
    // Sync imports may arrive out of parent/child order across devices.
    // Temporarily disable FK checks for the merge, then restore them.
    conn.execute_batch("PRAGMA foreign_keys = OFF")
        .map_err(|e| e.to_string())?;

    let pull_result = (|| -> Result<(PullStats, bool), String> {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

        snapshot_dirty(&tx)?;

        let pending_pets = crate::db::pending_delete_ids(&tx, "pets")?;
        let pending_clinics = crate::db::pending_delete_ids(&tx, "clinics")?;
        let pending_medical = crate::db::pending_delete_ids(&tx, "medical_history_entries")?;
        let pending_vax = crate::db::pending_delete_ids(&tx, "vaccinations")?;
        let pending_groom = crate::db::pending_delete_ids(&tx, "grooming_events")?;
        let pending_hosp = crate::db::pending_delete_ids(&tx, "hospitalizations")?;
        let pending_lab_orders = crate::db::pending_delete_ids(&tx, "lab_orders")?;
        let pending_lab_results = crate::db::pending_delete_ids(&tx, "lab_results")?;
        let pending_analytes = crate::db::pending_delete_ids(&tx, "lab_analytes")?;
        let pending_opd_cons = crate::db::pending_delete_ids(&tx, "opd_consultations")?;
        let pending_opd_req = crate::db::pending_delete_ids(&tx, "opd_requests")?;

        let medical = filter_pending(medical, &pending_medical);
        let vaccinations = filter_pending(vaccinations, &pending_vax);
        let grooming = filter_pending(grooming, &pending_groom);
        let hospitalizations = filter_pending(hospitalizations, &pending_hosp);
        let lab_orders = filter_pending(lab_orders, &pending_lab_orders);
        let lab_results = filter_pending(lab_results, &pending_lab_results);
        let lab_analytes = filter_pending(lab_analytes, &pending_analytes);
        let opd_consultations = filter_pending(opd_consultations, &pending_opd_cons);
        let opd_requests = filter_pending(opd_requests, &pending_opd_req);

        let mut pulled = 0usize;
        let mut apply_failed = false;
        let mut soft = |label: &str, result: Result<usize, String>| {
            match result {
                Ok(n) => pulled += n,
                Err(e) => {
                    apply_failed = true;
                    eprintln!("MongoDB pull collection {label} failed: {e}");
                }
            }
        };

        soft("users", pull_users(&tx, &users));
        soft("pets", pull_pets(&tx, &pets, &pending_pets));
        soft("medical_history_entries", pull_medical_entries(&tx, &medical));
        soft("vaccinations", pull_vaccinations(&tx, &vaccinations));
        soft("grooming_events", pull_grooming_events(&tx, &grooming));
        soft("hospitalizations", pull_hospitalizations(&tx, &hospitalizations));
        soft("clinics", pull_clinics(&tx, &clinics, &pending_clinics));
        soft("lab_tests", pull_lab_tests(&tx, &lab_tests));
        soft("lab_analytes", pull_lab_analytes(&tx, &lab_analytes));
        soft("lab_orders", pull_lab_orders(&tx, &lab_orders));
        soft("lab_results", pull_lab_results(&tx, &lab_results));
        soft("opd_requests", pull_opd_requests(&tx, &opd_requests));
        soft("opd_consultations", pull_opd_consultations(&tx, &opd_consultations));
        soft("opd_catalog_items", pull_opd_catalog_items(&tx, &opd_catalog_items));

        let deleted = match apply_tombstones(&tx, &tombstones) {
            Ok(n) => {
                for doc in &tombstones {
                    note_doc_applied(doc);
                }
                n
            }
            Err(e) => {
                apply_failed = true;
                eprintln!("MongoDB pull tombstones failed: {e}");
                0
            }
        };

        restore_dirty(&tx)?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok((PullStats { pulled, deleted }, apply_failed))
    })();

    let _ = conn.execute_batch("PRAGMA foreign_keys = ON");
    let max_synced = take_cursor_max_ts();

    let pull_result = match pull_result {
        Ok((stats, apply_failed)) => {
            // Only move cursor forward when this batch observed timestamps AND every
            // collection applied without a hard abort. Advancing after a partial apply
            // permanently skips the remaining docs until a full catch-up.
            if !apply_failed && !max_synced.is_empty() {
                // Clamp to the MongoDB clock. A single document stamped by a device whose
                // clock runs ahead used to drag the cursor into the future, after which
                // `$gte` matched nothing and this device silently stopped pulling.
                let server_now = crate::sync::mongo_server_time(client).await;
                let seen = parse_ts(&max_synced).unwrap_or(server_now);
                let capped = if seen > server_now { server_now } else { seen };
                // Keep a small saved lookback; the larger overlap is applied at query time.
                let cursor = crate::sync::canonical_ts(capped - chrono::Duration::seconds(30));
                // Never move the cursor backwards.
                let advance = match since.as_deref() {
                    Some(prev) if !prev.is_empty() => match (parse_ts(prev), parse_ts(&cursor)) {
                        (Some(p), Some(c)) => c >= p,
                        _ => cursor >= prev.to_string(),
                    },
                    _ => true,
                };
                if advance {
                    let _ = crate::db::sync_state_set(&conn, "pull_cursor", &cursor);
                    println!(
                        "MongoDB pull cursor → {cursor} (pulled={}, deleted={})",
                        stats.pulled, stats.deleted
                    );
                }
            } else if apply_failed {
                eprintln!(
                    "MongoDB pull cursor held (apply failure; pulled={}, deleted={})",
                    stats.pulled, stats.deleted
                );
            } else if since_ref.is_none() {
                println!("MongoDB pull: empty database (no cursor set)");
            }
            Ok(stats)
        }
        Err(e) => Err(e),
    };

    pull_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    fn test_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        crate::db::migrate(&mut conn).expect("migrate");
        conn.execute("DELETE FROM sync_dirty", []).expect("reset queue");
        conn
    }

    fn add_pet(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO pets (id, card_id, name, created_at, updated_at)
             VALUES (?1, ?1, ?1, '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            params![id],
        )
        .expect("insert pet");
    }

    fn queued(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT record_id FROM sync_dirty WHERE collection = 'pets' ORDER BY record_id")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn local_write_is_queued_for_upload() {
        let conn = test_db();
        add_pet(&conn, "pet-a");
        assert_eq!(queued(&conn), vec!["pet-a"], "a new pet must be queued");
    }

    #[test]
    fn pull_keeps_writes_queued_and_drops_its_own_merges() {
        let conn = test_db();
        // Saved before the pull and still waiting to upload.
        add_pet(&conn, "pet-waiting");

        snapshot_dirty(&conn).expect("snapshot");
        // The pull merging a peer's row must not queue it back to Mongo.
        add_pet(&conn, "pet-from-cloud");
        restore_dirty(&conn).expect("restore");

        assert_eq!(
            queued(&conn),
            vec!["pet-waiting"],
            "pending upload survives a pull; merged rows are not pushed back"
        );
    }

    #[test]
    fn newer_local_row_stays_queued_through_a_pull() {
        let conn = test_db();
        add_pet(&conn, "pet-edited");
        conn.execute("DELETE FROM sync_dirty", []).unwrap();

        snapshot_dirty(&conn).expect("snapshot");
        keep_local_dirty(&conn, "pets", "pet-edited");
        restore_dirty(&conn).expect("restore");

        assert_eq!(
            queued(&conn),
            vec!["pet-edited"],
            "a local row newer than the cloud copy must still be pushed"
        );
    }

    #[test]
    fn remote_winner_is_not_pushed_back() {
        let conn = test_db();
        add_pet(&conn, "pet-stale");

        snapshot_dirty(&conn).expect("snapshot");
        remote_won(&conn, "pets", "pet-stale");
        restore_dirty(&conn).expect("restore");

        assert!(
            queued(&conn).is_empty(),
            "a row the cloud won must not overwrite the cloud on the next push"
        );
    }

    #[test]
    fn canonical_stamps_sort_chronologically_as_strings() {
        // Mongo compares synced_at as a string, so ordering must match time order.
        let base = chrono::DateTime::parse_from_rfc3339("2026-09-06T17:48:10.490780300+00:00")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let earlier = crate::sync::canonical_ts(base - chrono::Duration::milliseconds(1));
        let later = crate::sync::canonical_ts(base + chrono::Duration::seconds(1));
        assert!(earlier < later, "{earlier} should sort before {later}");
        // And against stamps already stored by earlier builds.
        let existing = "2026-09-06T17:48:10.490780300+00:00";
        assert!(earlier.as_str() < existing, "{earlier} < {existing}");
        assert!(later.as_str() > existing, "{later} > {existing}");
    }

    #[test]
    fn opd_reopen_applies_when_remote_pending_is_newer() {
        let force_reopen = should_apply_remote(
            Some("2026-09-06T10:00:00.000000000+00:00".to_string()),
            Some("2026-09-06T11:00:00.000000000+00:00"),
        );
        assert!(
            force_reopen,
            "newer remote reopen timestamp must beat local completed"
        );
    }

    #[test]
    fn pets_without_updated_at_still_pull() {
        let conn = test_db();
        let docs = vec![doc! {
            "id": "pet-old",
            "card_id": "C-1",
            "name": "Buddy",
            "created_at": "2026-01-01T00:00:00+00:00",
        }];
        let n = pull_pets(&conn, &docs, &[]).expect("pull pets");
        assert_eq!(n, 1, "legacy pets missing updated_at must still apply");
        let name: String = conn
            .query_row("SELECT name FROM pets WHERE id = 'pet-old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Buddy");
    }

    #[test]
    fn medical_pull_skips_bad_doc_without_aborting() {
        let conn = test_db();
        add_pet(&conn, "pet-m");
        let docs = vec![
            doc! {
                "id": "med-bad",
                "created_at": "2026-01-01T00:00:00+00:00",
                // missing pet_id / entry_type
            },
            doc! {
                "id": "med-good",
                "pet_id": "pet-m",
                "entry_type": "note",
                "created_at": "2026-01-02T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            },
        ];
        let n = pull_medical_entries(&conn, &docs).expect("pull medical");
        assert_eq!(n, 1, "one bad doc must not abort the rest of the collection");
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM medical_history_entries WHERE id = 'med-good'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn remote_rev_prefers_synced_at_over_updated_at() {
        let doc = doc! {
            "synced_at": "2026-09-06T12:00:00.000000000+00:00",
            "updated_at": "2026-09-06T10:00:00.000000000+00:00",
            "created_at": "2026-09-06T09:00:00.000000000+00:00",
        };
        assert_eq!(
            remote_rev(&doc).as_deref(),
            Some("2026-09-06T12:00:00.000000000+00:00")
        );
    }

    #[test]
    fn lab_order_applies_when_synced_at_newer_than_local_updated_at() {
        let conn = test_db();
        add_pet(&conn, "pet-lo");
        conn.execute(
            "INSERT INTO lab_tests (id, name, active, created_at, updated_at)
             VALUES ('test-1', 'CBC', 1, '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO lab_orders (id, pet_id, lab_test_id, status, created_at, updated_at)
             VALUES ('lo-1', 'pet-lo', 'test-1', 'pending',
                     '2026-09-06T10:00:00+00:00', '2026-09-06T11:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM sync_dirty", []).unwrap();

        // Device clock stamped updated_at older, but server synced_at is newer.
        let docs = vec![doc! {
            "id": "lo-1",
            "pet_id": "pet-lo",
            "lab_test_id": "test-1",
            "status": "completed",
            "created_at": "2026-09-06T10:00:00+00:00",
            "updated_at": "2026-09-06T10:30:00+00:00",
            "synced_at": "2026-09-06T12:00:00.000000000+00:00",
        }];
        let n = pull_lab_orders(&conn, &docs).expect("pull lab orders");
        assert_eq!(n, 1, "newer synced_at must win over older updated_at");
        let status: String = conn
            .query_row("SELECT status FROM lab_orders WHERE id = 'lo-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "completed");
    }

    #[test]
    fn lab_result_values_restored_when_remote_value_apply_fails() {
        let conn = test_db();
        add_pet(&conn, "pet-lr");
        conn.execute(
            "INSERT INTO lab_tests (id, name, active, created_at, updated_at)
             VALUES ('test-lr', 'CBC', 1, '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO lab_orders (id, pet_id, lab_test_id, status, created_at, updated_at)
             VALUES ('lo-lr', 'pet-lr', 'test-lr', 'completed',
                     '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO lab_results (id, lab_order_id, pet_id, lab_test_id, created_at, updated_at)
             VALUES ('lr-1', 'lo-lr', 'pet-lr', 'test-lr',
                     '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO lab_result_values (
                id, lab_result_id, analyte_id, analyte_name, observed_value
             ) VALUES ('val-local', 'lr-1', 'a1', 'WBC', '12.0')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM sync_dirty", []).unwrap();

        // Snapshot / restore path: simulate failure by restoring after a wipe.
        let prior = snapshot_lab_result_values(&conn, "lr-1");
        assert_eq!(prior.len(), 1);
        conn.execute(
            "DELETE FROM lab_result_values WHERE lab_result_id = 'lr-1'",
            [],
        )
        .unwrap();
        let gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lab_result_values WHERE lab_result_id = 'lr-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0);
        restore_lab_result_values(&conn, "lr-1", &prior);
        let observed: String = conn
            .query_row(
                "SELECT observed_value FROM lab_result_values WHERE id = 'val-local'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(observed, "12.0");
    }

    #[test]
    fn soft_fail_caps_cursor_behind_applied_max() {
        reset_applied_max_ts();
        let applied = doc! { "synced_at": "2026-09-06T12:00:00.000000000+00:00" };
        let soft = doc! { "synced_at": "2026-09-06T10:00:00.000000000+00:00" };
        note_doc_applied(&applied);
        note_soft_failed(&soft, "pets/bad");
        let cursor = take_cursor_max_ts();
        assert_eq!(
            cursor, "2026-09-06T10:00:00.000000000+00:00",
            "cursor must not leap past oldest soft-fail"
        );
    }

    #[test]
    fn opd_sibling_cleanup_tombstones_only_for_canonical_winner() {
        let conn = test_db();
        add_pet(&conn, "pet-opd");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active)
             VALUES ('vet-1', 'vet1', 'hash', 'Vet', 'vet', '2026-01-01T00:00:00+00:00', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO opd_requests (
                id, pet_id, requested_by_user_id, requested_by_name, status, created_at, updated_at
             ) VALUES ('req-1', 'pet-opd', 'vet-1', 'Vet', 'completed',
                       '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        // Legacy non-canonical local sibling.
        conn.execute(
            "INSERT INTO opd_consultations (
                id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, created_at, updated_at
             ) VALUES ('legacy-cons', 'req-1', 'pet-opd', 'vet-1', 'Vet', 'Vet',
                       '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM sync_dirty", []).unwrap();
        conn.execute("DELETE FROM pending_deletes", []).unwrap();

        let canonical = "opd-cons-req-1";
        let docs = vec![doc! {
            "id": canonical,
            "request_id": "req-1",
            "pet_id": "pet-opd",
            "vet_id": "vet-1",
            "vet_name": "Vet",
            "doctor_signature_name": "Vet",
            "created_at": "2026-09-06T11:00:00+00:00",
            "updated_at": "2026-09-06T11:00:00+00:00",
            "synced_at": "2026-09-06T11:00:00.000000000+00:00",
        }];
        let n = pull_opd_consultations(&conn, &docs).expect("pull consultations");
        assert_eq!(n, 1);
        let legacy_gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM opd_consultations WHERE id = 'legacy-cons'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy_gone, 0, "local sibling must be removed");
        let pending = crate::db::pending_delete_ids(&conn, "opd_consultations").unwrap();
        assert!(
            pending.iter().any(|id| id == "legacy-cons"),
            "canonical winner may tombstone legacy sibling"
        );
    }

    #[test]
    fn opd_non_canonical_winner_does_not_tombstone_sibling() {
        let conn = test_db();
        add_pet(&conn, "pet-opd2");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active)
             VALUES ('vet-2', 'vet2', 'hash', 'Vet', 'vet', '2026-01-01T00:00:00+00:00', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO opd_requests (
                id, pet_id, requested_by_user_id, requested_by_name, status, created_at, updated_at
             ) VALUES ('req-2', 'pet-opd2', 'vet-2', 'Vet', 'completed',
                       '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO opd_consultations (
                id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, created_at, updated_at
             ) VALUES ('opd-cons-req-2', 'req-2', 'pet-opd2', 'vet-2', 'Vet', 'Vet',
                       '2026-09-06T10:00:00+00:00', '2026-09-06T10:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM sync_dirty", []).unwrap();
        conn.execute("DELETE FROM pending_deletes", []).unwrap();

        // Non-canonical remote wins (legacy cloud id).
        let docs = vec![doc! {
            "id": "random-uuid-cons",
            "request_id": "req-2",
            "pet_id": "pet-opd2",
            "vet_id": "vet-2",
            "vet_name": "Vet",
            "doctor_signature_name": "Vet",
            "created_at": "2026-09-06T12:00:00+00:00",
            "updated_at": "2026-09-06T12:00:00+00:00",
            "synced_at": "2026-09-06T12:00:00.000000000+00:00",
        }];
        let n = pull_opd_consultations(&conn, &docs).expect("pull consultations");
        assert_eq!(n, 1);
        let pending = crate::db::pending_delete_ids(&conn, "opd_consultations").unwrap();
        assert!(
            pending.is_empty(),
            "non-canonical winner must not tombstone siblings to Mongo"
        );
    }
}
