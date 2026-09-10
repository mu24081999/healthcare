use crate::db::{self, DbPool};
use bcrypt::{hash as bcrypt_hash, verify};
use chrono::Datelike;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct SessionUser {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
}

pub struct AppState {
    pub pool: DbPool,
    pub session: Mutex<Option<SessionUser>>,
    pub sync_trigger: tokio::sync::mpsc::Sender<()>,
}

impl AppState {
    // Called after every successful write to SQLite so the async sync worker
    // (listening on the receiving end of sync_trigger, see main.rs) picks it
    // up and pushes the latest state to MongoDB. try_send is non-blocking and
    // fine to call repeatedly — if a sync is already queued/running, this is
    // just a no-op signal.
    pub fn trigger_sync(&self) {
        let _ = self.sync_trigger.try_send(());
    }
}


fn require_login(state: &AppState) -> Result<SessionUser, String> {
    state
        .session
        .lock()
        .map_err(|_| "lock error".to_string())?
        .clone()
        .ok_or_else(|| "Not signed in".to_string())
}

fn require_clinic_access(state: &AppState) -> Result<SessionUser, String> {
    let user = require_login(state)?;
    if user.role != "superadmin" && user.role != "manager" && user.role != "vet" {
        return Err("Forbidden".to_string());
    }
    Ok(user)
}

fn update_pet_weight(conn: &rusqlite::Connection, pet_id: &str, weight: &Option<String>) -> Result<(), String> {
    if let Some(w) = weight {
        let w = w.trim();
        if !w.is_empty() {
            conn.execute(
                "UPDATE pets SET weight = ?1, updated_at = ?2 WHERE id = ?3",
                params![w, crate::sync::approx_server_now(), pet_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Resolve a usable users.id for the current session (avoids Close OPD FK failures
/// after sync remaps seeded user UUIDs across devices).
fn resolve_session_user_id(
    state: &AppState,
    conn: &rusqlite::Connection,
    session: &SessionUser,
) -> Result<String, String> {
    let by_id: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE id = ?1",
            params![session.id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if by_id > 0 {
        return Ok(session.id.clone());
    }

    let by_username: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE username = ?1",
            params![session.username],
            |r| r.get(0),
        )
        .ok();
    if let Some(id) = by_username {
        if let Ok(mut guard) = state.session.lock() {
            if let Some(ref mut u) = *guard {
                u.id = id.clone();
            }
        }
        return Ok(id);
    }

    // Recreate a stub so FK references succeed; password is blank until next login sync.
    let now = crate::sync::approx_server_now();
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active)
         VALUES (?1, ?2, '', ?3, ?4, ?5, 1)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           role = excluded.role,
           active = 1",
        params![
            session.id,
            session.username,
            session.display_name,
            session.role,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    // Triggers queue the stub for upload — drop it so we never push a blank password.
    let _ = crate::db::clear_dirty(&conn, "users", &session.id);
    Ok(session.id.clone())
}

fn map_sqlite_user_err(e: String) -> String {
    if e.to_lowercase().contains("foreign key") {
        "Your account was updated by sync. Please sign out and sign back in, then try again."
            .to_string()
    } else {
        e
    }
}

#[derive(Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub fn auth_login(state: State<'_, AppState>, input: LoginInput) -> Result<SessionUser, String> {
    let conn = db::get_conn(&state.pool)?;
    let row: Result<(String, String, String, String, String, i64), rusqlite::Error> = conn.query_row(
        "SELECT id, username, password_hash, display_name, role, COALESCE(active, 1) FROM users WHERE username = ?1",
        params![input.username.trim()],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        },
    );
    let (id, username, hash, display_name, role, active_i) =
        row.map_err(|_| "Invalid username or password".to_string())?;
    if active_i == 0 {
        return Err("This account has been deactivated".to_string());
    }
    if !verify(input.password, &hash).unwrap_or(false) {
        return Err("Invalid username or password".to_string());
    }
    let user = SessionUser {
        id,
        username,
        display_name,
        role,
    };
    *state.session.lock().map_err(|_| "lock")? = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.lock().map_err(|_| "lock")? = None;
    Ok(())
}

#[tauri::command]
pub fn auth_session(state: State<'_, AppState>) -> Result<Option<SessionUser>, String> {
    Ok(state.session.lock().map_err(|_| "lock")?.clone())
}

#[derive(Serialize)]
pub struct PetRow {
    pub id: String,
    pub card_id: String,
    pub name: String,
    pub species: Option<String>,
    pub breed: Option<String>,
    pub age: Option<String>,
    pub date_of_birth: Option<String>,
    pub sex: Option<String>,
    pub weight: Option<String>,
    pub vaccine_status: Option<String>,
    pub deworming_status: Option<String>,
    pub owner_name: Option<String>,
    pub owner_phone: Option<String>,
    pub owner_address: Option<String>,
    pub owner_email: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct PetListRow {
    pub id: String,
    pub card_id: String,
    pub name: String,
    pub species: Option<String>,
    pub breed: Option<String>,
    pub age: Option<String>,
    pub date_of_birth: Option<String>,
    pub sex: Option<String>,
    pub weight: Option<String>,
    pub vaccine_status: Option<String>,
    pub deworming_status: Option<String>,
    pub owner_name: Option<String>,
    pub owner_phone: Option<String>,
    pub owner_address: Option<String>,
    pub owner_email: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub medical_count: i64,
    pub grooming_count: i64,
}

#[derive(Deserialize)]
pub struct PetInput {
    pub name: String,
    pub species: Option<String>,
    pub breed: Option<String>,
    pub age: Option<String>,
    #[serde(default)]
    pub date_of_birth: Option<String>,
    pub sex: Option<String>,
    pub weight: Option<String>,
    pub vaccine_status: Option<String>,
    pub deworming_status: Option<String>,
    pub owner_name: Option<String>,
    pub owner_phone: Option<String>,
    pub owner_address: Option<String>,
    pub owner_email: Option<String>,
    pub notes: Option<String>,
}

fn next_pet_card_id(conn: &rusqlite::Connection) -> Result<String, String> {
    for _ in 0..10 {
        let raw = Uuid::new_v4().simple().to_string();
        let card_id = format!("PET-{}", raw[..10].to_uppercase());
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pets WHERE card_id = ?1",
                params![card_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Ok(card_id);
        }
    }
    Err("Could not generate a unique pet card id".to_string())
}

#[tauri::command]
pub fn pets_list(state: State<'_, AppState>, query: Option<String>) -> Result<Vec<PetListRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut sql = "SELECT p.id, p.card_id, p.name, p.species, p.breed, p.age, p.date_of_birth, p.sex, p.weight, p.vaccine_status, p.deworming_status, p.owner_name, p.owner_phone, p.owner_address, p.owner_email, p.notes, p.created_at, p.updated_at, \
             (SELECT COUNT(*) FROM medical_history_entries m WHERE m.pet_id = p.id), \
             (SELECT COUNT(*) FROM grooming_events g WHERE g.pet_id = p.id) \
             FROM pets p".to_string();
    let q = query.unwrap_or_default().trim().to_string();
    let mut params_vec: Vec<String> = Vec::new();
    if !q.is_empty() {
        sql.push_str(" WHERE p.name LIKE ?1 OR p.owner_name LIKE ?1 OR p.owner_phone LIKE ?1");
        params_vec.push(format!("%{}%", q));
    }
    sql.push_str(" ORDER BY p.name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut map_row = |r: &rusqlite::Row<'_>| -> Result<PetListRow, rusqlite::Error> {
        Ok(PetListRow {
            id: r.get(0)?,
            card_id: r.get(1)?,
            name: r.get(2)?,
            species: r.get(3)?,
            breed: r.get(4)?,
            age: r.get(5)?,
            date_of_birth: r.get(6)?,
            sex: r.get(7)?,
            weight: r.get(8)?,
            vaccine_status: r.get(9)?,
            deworming_status: r.get(10)?,
            owner_name: r.get(11)?,
            owner_phone: r.get(12)?,
            owner_address: r.get(13)?,
            owner_email: r.get(14)?,
            notes: r.get(15)?,
            created_at: r.get(16)?,
            updated_at: r.get(17)?,
            medical_count: r.get(18)?,
            grooming_count: r.get(19)?,
        })
    };
    let mut out = Vec::new();
    if params_vec.is_empty() {
        let rows = stmt.query_map([], &mut map_row).map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let rows = stmt
            .query_map(params![params_vec[0]], &mut map_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn pets_get(state: State<'_, AppState>, id: String) -> Result<PetRow, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    conn.query_row(
        "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
        params![id],
        |r| {
            Ok(PetRow {
                id: r.get(0)?,
                card_id: r.get(1)?,
                name: r.get(2)?,
                species: r.get(3)?,
                breed: r.get(4)?,
                age: r.get(5)?,
                date_of_birth: r.get(6)?,
                sex: r.get(7)?,
                weight: r.get(8)?,
                vaccine_status: r.get(9)?,
                deworming_status: r.get(10)?,
                owner_name: r.get(11)?,
                owner_phone: r.get(12)?,
                owner_address: r.get(13)?,
                owner_email: r.get(14)?,
                notes: r.get(15)?,
                created_at: r.get(16)?,
                updated_at: r.get(17)?,
            })
        },
    )
    .map_err(|_| "Pet not found".to_string())
}

#[tauri::command]
pub fn pets_create(state: State<'_, AppState>, input: PetInput) -> Result<PetRow, String> {
    require_login(&state)?;
    if input.name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if input.species.clone().unwrap_or_default().trim().is_empty() {
        return Err("Species is required".to_string());
    }
    if input.owner_name.clone().unwrap_or_default().trim().is_empty() {
        return Err("Owner name is required".to_string());
    }
    if input.owner_phone.clone().unwrap_or_default().trim().is_empty() {
        return Err("Owner phone is required".to_string());
    }
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    let card_id = next_pet_card_id(&conn)?;
    conn.execute(
        "INSERT INTO pets (id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            id,
            card_id,
            input.name.trim(),
            input.species,
            input.breed,
            input.age,
            input.date_of_birth,
            input.sex,
            input.weight,
            input.vaccine_status,
            input.deworming_status,
            input.owner_name,
            input.owner_phone,
            input.owner_address,
            input.owner_email,
            input.notes,
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "pets", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
        params![id],
        |r| {
            Ok(PetRow {
                id: r.get(0)?,
                card_id: r.get(1)?,
                name: r.get(2)?,
                species: r.get(3)?,
                breed: r.get(4)?,
                age: r.get(5)?,
                date_of_birth: r.get(6)?,
                sex: r.get(7)?,
                weight: r.get(8)?,
                vaccine_status: r.get(9)?,
                deworming_status: r.get(10)?,
                owner_name: r.get(11)?,
                owner_phone: r.get(12)?,
                owner_address: r.get(13)?,
                owner_email: r.get(14)?,
                notes: r.get(15)?,
                created_at: r.get(16)?,
                updated_at: r.get(17)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pets_update(state: State<'_, AppState>, id: String, input: PetInput) -> Result<PetRow, String> {
    require_login(&state)?;
    if input.name.trim().is_empty() {
        return Err("Name is required".to_string());
    }
    if input.species.clone().unwrap_or_default().trim().is_empty() {
        return Err("Species is required".to_string());
    }
    if input.owner_name.clone().unwrap_or_default().trim().is_empty() {
        return Err("Owner name is required".to_string());
    }
    if input.owner_phone.clone().unwrap_or_default().trim().is_empty() {
        return Err("Owner phone is required".to_string());
    }
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    let n = conn.execute(
        "UPDATE pets SET name = ?2, species = ?3, breed = ?4, age = ?5, date_of_birth = ?6, sex = ?7, weight = ?8, vaccine_status = ?9, deworming_status = ?10, owner_name = ?11, owner_phone = ?12, owner_address = ?13, owner_email = ?14, notes = ?15, updated_at = ?16 WHERE id = ?1",
        params![
            id,
            input.name.trim(),
            input.species,
            input.breed,
            input.age,
            input.date_of_birth,
            input.sex,
            input.weight,
            input.vaccine_status,
            input.deworming_status,
            input.owner_name,
            input.owner_phone,
            input.owner_address,
            input.owner_email,
            input.notes,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Pet not found".to_string());
    }
    db::mark_dirty(&conn, "pets", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
        params![id],
        |r| {
            Ok(PetRow {
                id: r.get(0)?,
                card_id: r.get(1)?,
                name: r.get(2)?,
                species: r.get(3)?,
                breed: r.get(4)?,
                age: r.get(5)?,
                date_of_birth: r.get(6)?,
                sex: r.get(7)?,
                weight: r.get(8)?,
                vaccine_status: r.get(9)?,
                deworming_status: r.get(10)?,
                owner_name: r.get(11)?,
                owner_phone: r.get(12)?,
                owner_address: r.get(13)?,
                owner_email: r.get(14)?,
                notes: r.get(15)?,
                created_at: r.get(16)?,
                updated_at: r.get(17)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pets_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Queue child tombstones before CASCADE so other devices drop case data too.
    let queue_children = |table: &str, col: &str| -> Result<(), String> {
        let mut stmt = tx
            .prepare(&format!("SELECT id FROM {table} WHERE {col} = ?1"))
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for cid in ids {
            db::queue_remote_delete(&tx, table, &cid)?;
        }
        Ok(())
    };
    queue_children("medical_history_entries", "pet_id")?;
    queue_children("vaccinations", "pet_id")?;
    queue_children("grooming_events", "pet_id")?;
    queue_children("hospitalizations", "pet_id")?;
    queue_children("lab_orders", "pet_id")?;
    queue_children("lab_results", "pet_id")?;
    queue_children("opd_consultations", "pet_id")?;
    queue_children("opd_requests", "pet_id")?;

    tx.execute("DELETE FROM pets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    db::queue_remote_delete(&tx, "pets", &id)?;
    tx.commit().map_err(|e| e.to_string())?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct MedicalRow {
    pub id: String,
    pub pet_id: String,
    pub entry_type: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub dx_items: Vec<String>,
    pub ddx_items: Vec<String>,
    pub dx_note: Option<String>,
    pub ddx_note: Option<String>,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub external_file_path: Option<String>,
    pub external_file_paths: Vec<String>,
    pub lab_result_id: Option<String>,
    pub created_at: String,
    pub body_weight: Option<String>,
}

#[derive(Deserialize)]
pub struct MedicalInput {
    pub entry_type: String,
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub dx_items: Option<Vec<String>>,
    #[serde(default)]
    pub ddx_items: Option<Vec<String>>,
    pub dx_note: Option<String>,
    pub ddx_note: Option<String>,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub external_file_path: Option<String>,
    #[serde(default)]
    pub external_file_paths: Option<Vec<String>>,
    pub body_weight: Option<String>,
}

fn medical_items_json(items: &Option<Vec<String>>) -> String {
    let v: Vec<String> = items
        .as_ref()
        .map(|list| {
            list.iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string())
}

fn map_medical_sql_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MedicalRow> {
    let dx_raw: Option<String> = r.get(5)?;
    let ddx_raw: Option<String> = r.get(6)?;
    let paths_raw: Option<String> = r.get(15)?;
    Ok(MedicalRow {
        id: r.get(0)?,
        pet_id: r.get(1)?,
        entry_type: r.get(2)?,
        title: r.get(3)?,
        body: r.get(4)?,
        dx_items: parse_string_array_json(dx_raw),
        ddx_items: parse_string_array_json(ddx_raw),
        dx_note: r.get(7)?,
        ddx_note: r.get(8)?,
        administered_date: r.get(9)?,
        next_due_date: r.get(10)?,
        reminder_days_before: r.get(11)?,
        external_file_path: r.get(12)?,
        lab_result_id: r.get(13)?,
        created_at: r.get(14)?,
        external_file_paths: parse_string_array_json(paths_raw),
        body_weight: r.get(16)?,
    })
}

#[tauri::command]
pub fn medical_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<MedicalRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE pet_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pet_id], |r| map_medical_sql_row(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn medical_add(state: State<'_, AppState>, pet_id: String, input: MedicalInput) -> Result<MedicalRow, String> {
    require_login(&state)?;
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    let dx_j = medical_items_json(&input.dx_items);
    let ddx_j = medical_items_json(&input.ddx_items);
    let paths_j = medical_items_json(&input.external_file_paths);
    let mut conn = db::get_conn(&state.pool)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO medical_history_entries (id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14, ?15, ?16, ?17)",
        params![
            id,
            pet_id,
            input.entry_type,
            input.title,
            input.body,
            dx_j,
            ddx_j,
            input.dx_note,
            input.ddx_note,
            input.administered_date,
            input.next_due_date,
            input.reminder_days_before,
            input.external_file_path,
            now,
            paths_j,
            input.body_weight,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    update_pet_weight(&tx, &pet_id, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "medical_history_entries", &id)?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &pet_id)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE id = ?1",
        params![id],
        |r| map_medical_sql_row(r),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn medical_update(
    state: State<'_, AppState>,
    pet_id: String,
    entry_id: String,
    input: MedicalInput,
) -> Result<MedicalRow, String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    let (lab_rid, _etype): (Option<String>, String) = conn
        .query_row(
            "SELECT lab_result_id, entry_type FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
            params![entry_id, pet_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Medical entry not found".to_string())?;
    let entry_type = if lab_rid.is_some() {
        "lab_report".to_string()
    } else {
        input.entry_type
    };
    let now = crate::sync::approx_server_now();
    let dx_j = medical_items_json(&input.dx_items);
    let ddx_j = medical_items_json(&input.ddx_items);
    let paths_j = medical_items_json(&input.external_file_paths);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE medical_history_entries SET entry_type = ?1, title = ?2, body = ?3, dx_items = ?4, ddx_items = ?5, dx_note = ?6, ddx_note = ?7, administered_date = ?8, next_due_date = ?9, reminder_days_before = ?10, external_file_path = ?11, external_file_paths = ?12, body_weight = ?13, updated_at = ?14 WHERE id = ?15 AND pet_id = ?16",
        params![
            entry_type,
            input.title,
            input.body,
            dx_j,
            ddx_j,
            input.dx_note,
            input.ddx_note,
            input.administered_date,
            input.next_due_date,
            input.reminder_days_before,
            input.external_file_path,
            paths_j,
            input.body_weight,
            now,
            entry_id,
            pet_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    update_pet_weight(&tx, &pet_id, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "medical_history_entries", &entry_id)?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &pet_id)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE id = ?1",
        params![entry_id],
        |r| map_medical_sql_row(r),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn medical_delete(state: State<'_, AppState>, pet_id: String, entry_id: String) -> Result<(), String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    let lab_rid: Option<String> = conn
        .query_row(
            "SELECT lab_result_id FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
            params![entry_id, pet_id],
            |r| r.get(0),
        )
        .map_err(|_| "Medical entry not found".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| e.to_string())?;
    if let Some(ref lrid) = lab_rid {
        let lo_id: String = tx
            .query_row(
                "SELECT lab_order_id FROM lab_results WHERE id = ?1",
                params![lrid],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
            params![lrid],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM lab_results WHERE id = ?1", params![lrid])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE lab_orders SET status = 'pending', updated_at = ?2 WHERE id = ?1",
            params![lo_id, crate::sync::approx_server_now()],
        )
        .map_err(|e| e.to_string())?;
        db::mark_dirty(&tx, "lab_orders", &lo_id)?;
    }
    let n = tx
        .execute(
            "DELETE FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
            params![entry_id, pet_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Medical entry not found".to_string());
    }
    db::queue_remote_delete(&tx, "medical_history_entries", &entry_id)?;
    if let Some(ref lrid) = lab_rid {
        db::queue_remote_delete(&tx, "lab_results", lrid)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct VaccinationRow {
    pub id: String,
    pub pet_id: String,
    pub vaccine_name: String,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
    pub body_weight: Option<String>,
}

#[derive(Deserialize)]
pub struct VaccinationInput {
    pub vaccine_name: String,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub notes: Option<String>,
    pub body_weight: Option<String>,
}

#[tauri::command]
pub fn vaccinations_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<VaccinationRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE pet_id = ?1 ORDER BY next_due_date ASC NULLS LAST")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pet_id], |r| {
            Ok(VaccinationRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                vaccine_name: r.get(2)?,
                administered_date: r.get(3)?,
                next_due_date: r.get(4)?,
                reminder_days_before: r.get(5)?,
                notes: r.get(6)?,
                created_at: r.get(7)?,
                body_weight: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn vaccinations_upsert(
    state: State<'_, AppState>,
    id: Option<String>,
    pet_id: String,
    input: VaccinationInput,
) -> Result<VaccinationRow, String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    let now = crate::sync::approx_server_now();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(ref eid) = id {
        tx.execute(
            "UPDATE vaccinations SET vaccine_name = ?2, administered_date = ?3, next_due_date = ?4, reminder_days_before = ?5, notes = ?6, body_weight = ?8, updated_at = ?9 WHERE id = ?1 AND pet_id = ?7",
            params![
                eid,
                input.vaccine_name,
                input.administered_date,
                input.next_due_date,
                input.reminder_days_before,
                input.notes,
                pet_id,
                input.body_weight,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        update_pet_weight(&tx, &pet_id, &input.body_weight)?;
        tx.commit().map_err(|e| e.to_string())?;
        let conn = db::get_conn(&state.pool)?;
        db::mark_dirty(&conn, "vaccinations", eid)?;
        if input
            .body_weight
            .as_ref()
            .map(|w| !w.trim().is_empty())
            .unwrap_or(false)
        {
            db::mark_dirty(&conn, "pets", &pet_id)?;
        }
        state.trigger_sync();
        return conn
            .query_row(
                "SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE id = ?1",
                params![eid],
                |r| {
                    Ok(VaccinationRow {
                        id: r.get(0)?,
                        pet_id: r.get(1)?,
                        vaccine_name: r.get(2)?,
                        administered_date: r.get(3)?,
                        next_due_date: r.get(4)?,
                        reminder_days_before: r.get(5)?,
                        notes: r.get(6)?,
                        created_at: r.get(7)?,
                        body_weight: r.get(8)?,
                    })
                },
            )
            .map_err(|e| e.to_string());
    }
    let nid = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO vaccinations (id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            nid,
            pet_id,
            input.vaccine_name,
            input.administered_date,
            input.next_due_date,
            input.reminder_days_before,
            input.notes,
            now,
            input.body_weight,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    update_pet_weight(&tx, &pet_id, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "vaccinations", &nid)?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &pet_id)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE id = ?1",
        params![nid],
        |r| {
            Ok(VaccinationRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                vaccine_name: r.get(2)?,
                administered_date: r.get(3)?,
                next_due_date: r.get(4)?,
                reminder_days_before: r.get(5)?,
                notes: r.get(6)?,
                created_at: r.get(7)?,
                body_weight: r.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vaccinations_delete(
    state: State<'_, AppState>,
    pet_id: String,
    vaccination_id: String,
) -> Result<(), String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let n = conn
        .execute(
            "DELETE FROM vaccinations WHERE id = ?1 AND pet_id = ?2",
            params![vaccination_id, pet_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Vaccination entry not found".to_string());
    }
    db::queue_remote_delete(&conn, "vaccinations", &vaccination_id)?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct HospitalizationRow {
    pub id: String,
    pub pet_id: String,
    pub cage_number: String,
    pub check_in_date: String,
    pub check_out_date: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct HospitalizationInput {
    pub pet_id: String,
    pub cage_number: String,
    pub check_in_date: String,
    pub check_out_date: Option<String>,
}

#[tauri::command]
pub fn hospitalizations_list(state: State<'_, AppState>) -> Result<Vec<HospitalizationRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at FROM hospitalizations ORDER BY check_in_date DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(HospitalizationRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                cage_number: r.get(2)?,
                check_in_date: r.get(3)?,
                check_out_date: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn hospitalizations_upsert(
    state: State<'_, AppState>,
    input: HospitalizationInput,
    id: Option<String>,
) -> Result<HospitalizationRow, String> {
    require_login(&state)?;
    if input.pet_id.trim().is_empty() || input.cage_number.trim().is_empty() || input.check_in_date.trim().is_empty() {
        return Err("pet_id, cage_number and check_in_date are required".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let now = crate::sync::approx_server_now();
    if let Some(eid) = id {
        let n = conn
            .execute(
                "UPDATE hospitalizations SET pet_id = ?2, cage_number = ?3, check_in_date = ?4, check_out_date = ?5, updated_at = ?6 WHERE id = ?1",
                params![eid, input.pet_id, input.cage_number.trim(), input.check_in_date, input.check_out_date, now],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Hospitalization not found".to_string());
        }
        db::mark_dirty(&conn, "hospitalizations", &eid)?;
        state.trigger_sync();
        return conn
            .query_row(
                "SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at FROM hospitalizations WHERE id = ?1",
                params![eid],
                |r| {
                    Ok(HospitalizationRow {
                        id: r.get(0)?,
                        pet_id: r.get(1)?,
                        cage_number: r.get(2)?,
                        check_in_date: r.get(3)?,
                        check_out_date: r.get(4)?,
                        created_at: r.get(5)?,
                    })
                },
            )
            .map_err(|e| e.to_string());
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO hospitalizations (id, pet_id, cage_number, check_in_date, check_out_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, input.pet_id, input.cage_number.trim(), input.check_in_date, input.check_out_date, now],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "hospitalizations", &id)?;
    state.trigger_sync();
    Ok(HospitalizationRow {
        id,
        pet_id: input.pet_id,
        cage_number: input.cage_number.trim().to_string(),
        check_in_date: input.check_in_date,
        check_out_date: input.check_out_date,
        created_at: now,
    })
}

#[tauri::command]
pub fn hospitalizations_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let n = conn
        .execute("DELETE FROM hospitalizations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Hospitalization not found".to_string());
    }
    db::queue_remote_delete(&conn, "hospitalizations", &id)?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct ClinicRow {
    pub id: String,
    pub name: String,
    pub email: String,
    pub address: String,
    pub phone: String,
    pub timing: String,
    pub created_at: String,
    pub updated_at: String,
    pub logo: Option<String>,
}

#[derive(Deserialize)]
pub struct ClinicInput {
    pub name: String,
    pub email: String,
    pub address: String,
    pub phone: String,
    pub timing: String,
    pub logo: Option<String>,
}

const GLOBAL_CLINIC_ID: &str = "global";

#[tauri::command]
pub fn clinic_get(state: State<'_, AppState>) -> Result<ClinicRow, String> {
    let conn = db::get_conn(&state.pool)?;
    let existing = conn
        .query_row(
            "SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1",
            params![GLOBAL_CLINIC_ID],
            |r| {
                Ok(ClinicRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    email: r.get(2)?,
                    address: r.get(3)?,
                    phone: r.get(4)?,
                    timing: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    logo: r.get(8)?,
                })
            },
        )
        .ok();
    if let Some(row) = existing {
        return Ok(row);
    }
    let now = crate::sync::approx_server_now();
    conn.execute(
        "INSERT INTO clinics (id, name, email, address, phone, timing, created_at, updated_at, logo) VALUES (?1, '', '', '', '', '', ?2, ?3, NULL)",
        params![GLOBAL_CLINIC_ID, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(ClinicRow {
        id: GLOBAL_CLINIC_ID.to_string(),
        name: "".to_string(),
        email: "".to_string(),
        address: "".to_string(),
        phone: "".to_string(),
        timing: "".to_string(),
        created_at: now.clone(),
        updated_at: now,
        logo: None,
    })
}

#[tauri::command]
pub fn clinic_update(state: State<'_, AppState>, input: ClinicInput) -> Result<ClinicRow, String> {
    require_superadmin(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let now = crate::sync::approx_server_now();
    conn.execute(
        "INSERT INTO clinics (id, name, email, address, phone, timing, created_at, updated_at, logo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, address = excluded.address, phone = excluded.phone, timing = excluded.timing, updated_at = excluded.updated_at, logo = excluded.logo",
        params![
            GLOBAL_CLINIC_ID,
            input.name.trim(),
            input.email.trim(),
            input.address.trim(),
            input.phone.trim(),
            input.timing.trim(),
            now,
            input.logo,
        ],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "clinics", GLOBAL_CLINIC_ID)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1",
        params![GLOBAL_CLINIC_ID],
        |r| {
            Ok(ClinicRow {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                address: r.get(3)?,
                phone: r.get(4)?,
                timing: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                logo: r.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct GroomingRow {
    pub id: String,
    pub pet_id: String,
    pub service_type: String,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub performed_date: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub body_weight: Option<String>,
}

#[derive(Deserialize)]
pub struct GroomingInput {
    pub service_type: String,
    pub administered_date: Option<String>,
    pub next_due_date: Option<String>,
    pub reminder_days_before: Option<i64>,
    pub performed_date: String,
    pub notes: Option<String>,
    pub body_weight: Option<String>,
}

#[tauri::command]
pub fn grooming_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<GroomingRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE pet_id = ?1 ORDER BY performed_date DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pet_id], |r| {
            Ok(GroomingRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                service_type: r.get(2)?,
                administered_date: r.get(3)?,
                next_due_date: r.get(4)?,
                reminder_days_before: r.get(5)?,
                performed_date: r.get(6)?,
                notes: r.get(7)?,
                created_at: r.get(8)?,
                body_weight: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn grooming_add(state: State<'_, AppState>, pet_id: String, input: GroomingInput) -> Result<GroomingRow, String> {
    require_login(&state)?;
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    let mut conn = db::get_conn(&state.pool)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO grooming_events (id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?9)",
        params![id, pet_id, input.service_type, input.administered_date, input.next_due_date, input.reminder_days_before, input.performed_date, input.notes, now, input.body_weight],
    )
    .map_err(|e| e.to_string())?;
    update_pet_weight(&tx, &pet_id, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "grooming_events", &id)?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &pet_id)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE id = ?1",
        params![id],
        |r| {
            Ok(GroomingRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                service_type: r.get(2)?,
                administered_date: r.get(3)?,
                next_due_date: r.get(4)?,
                reminder_days_before: r.get(5)?,
                performed_date: r.get(6)?,
                notes: r.get(7)?,
                created_at: r.get(8)?,
                body_weight: r.get(9)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn grooming_update(
    state: State<'_, AppState>,
    pet_id: String,
    grooming_id: String,
    input: GroomingInput,
) -> Result<GroomingRow, String> {
    require_login(&state)?;
    let now = crate::sync::approx_server_now();
    let mut conn = db::get_conn(&state.pool)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE grooming_events SET service_type = ?1, administered_date = ?2, next_due_date = ?3, reminder_days_before = ?4, performed_date = ?5, notes = ?6, body_weight = ?9, updated_at = ?10 WHERE id = ?7 AND pet_id = ?8",
        params![
            input.service_type,
            input.administered_date,
            input.next_due_date,
            input.reminder_days_before,
            input.performed_date,
            input.notes,
            grooming_id,
            pet_id,
            input.body_weight,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    update_pet_weight(&tx, &pet_id, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "grooming_events", &grooming_id)?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &pet_id)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE id = ?1",
        params![grooming_id],
        |r| {
            Ok(GroomingRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                service_type: r.get(2)?,
                administered_date: r.get(3)?,
                next_due_date: r.get(4)?,
                reminder_days_before: r.get(5)?,
                performed_date: r.get(6)?,
                notes: r.get(7)?,
                created_at: r.get(8)?,
                body_weight: r.get(9)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn grooming_delete(state: State<'_, AppState>, pet_id: String, grooming_id: String) -> Result<(), String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let n = conn.execute(
        "DELETE FROM grooming_events WHERE id = ?1 AND pet_id = ?2",
        params![grooming_id, pet_id],
    )
    .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Grooming entry not found".to_string());
    }
    db::queue_remote_delete(&conn, "grooming_events", &grooming_id)?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct LabTestRow {
    pub id: String,
    pub name: String,
    pub code: Option<String>,
    pub default_report_hours: Option<i64>,
    pub active: i64,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct LabTestInput {
    pub name: String,
    pub code: Option<String>,
    pub default_report_hours: Option<i64>,
}

#[tauri::command]
pub fn lab_tests_list(state: State<'_, AppState>) -> Result<Vec<LabTestRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE active = 1 ORDER BY name COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LabTestRow {
                id: r.get(0)?,
                name: r.get(1)?,
                code: r.get(2)?,
                default_report_hours: r.get(3)?,
                active: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn lab_tests_list_all(state: State<'_, AppState>) -> Result<Vec<LabTestRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests ORDER BY name COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LabTestRow {
                id: r.get(0)?,
                name: r.get(1)?,
                code: r.get(2)?,
                default_report_hours: r.get(3)?,
                active: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn lab_test_create(state: State<'_, AppState>, input: LabTestInput) -> Result<LabTestRow, String> {
    require_login(&state)?;
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    conn.execute(
        "INSERT INTO lab_tests (id, name, code, default_report_hours, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params![id, input.name, input.code, input.default_report_hours, now],
    )
    .map_err(|e| e.to_string())?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE id = ?1",
        params![id],
        |r| {
            Ok(LabTestRow {
                id: r.get(0)?,
                name: r.get(1)?,
                code: r.get(2)?,
                default_report_hours: r.get(3)?,
                active: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lab_test_update(state: State<'_, AppState>, id: String, input: LabTestInput) -> Result<LabTestRow, String> {
    require_login(&state)?;
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    conn.execute(
        "UPDATE lab_tests SET name = ?2, code = ?3, default_report_hours = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, input.name, input.code, input.default_report_hours, now],
    )
    .map_err(|e| e.to_string())?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE id = ?1",
        params![id],
        |r| {
            Ok(LabTestRow {
                id: r.get(0)?,
                name: r.get(1)?,
                code: r.get(2)?,
                default_report_hours: r.get(3)?,
                active: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lab_test_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_login(&state)?;
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    conn.execute(
        "UPDATE lab_tests SET active = 0, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )
        .map_err(|e| e.to_string())?;
    // This is a soft delete (active = 0), so it's really an UPDATE — the row
    // still exists in SQLite and sync_all_data will correctly push the
    // active:0 state to Mongo too.
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct AnalyteRow {
    pub id: String,
    pub lab_test_id: String,
    pub name: String,
    pub unit: Option<String>,
    pub normal_min: Option<f64>,
    pub normal_max: Option<f64>,
    pub sort_order: i64,
    pub remarks: Option<String>,
}

#[derive(Deserialize)]
pub struct AnalyteInput {
    pub name: String,
    pub unit: Option<String>,
    pub normal_min: Option<f64>,
    pub normal_max: Option<f64>,
    pub sort_order: Option<i64>,
    pub remarks: Option<String>,
}

#[tauri::command]
pub fn lab_analytes_list(state: State<'_, AppState>, lab_test_id: String) -> Result<Vec<AnalyteRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare("SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE lab_test_id = ?1 ORDER BY sort_order, name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![lab_test_id], |r| {
            Ok(AnalyteRow {
                id: r.get(0)?,
                lab_test_id: r.get(1)?,
                name: r.get(2)?,
                unit: r.get(3)?,
                normal_min: r.get(4)?,
                normal_max: r.get(5)?,
                sort_order: r.get(6)?,
                remarks: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn lab_analyte_upsert(
    state: State<'_, AppState>,
    lab_test_id: String,
    id: Option<String>,
    input: AnalyteInput,
) -> Result<AnalyteRow, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let sort = input.sort_order.unwrap_or(0);
    let now = crate::sync::approx_server_now();
    if let Some(ref eid) = id {
        conn.execute(
            "UPDATE lab_analytes SET name = ?2, unit = ?3, normal_min = ?4, normal_max = ?5, sort_order = ?6, remarks = ?8, updated_at = ?9 WHERE id = ?1 AND lab_test_id = ?7",
            params![
                eid,
                input.name,
                input.unit,
                input.normal_min,
                input.normal_max,
                sort,
                lab_test_id,
                input.remarks,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        state.trigger_sync();
        return conn
            .query_row(
                "SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE id = ?1",
                params![eid],
                |r| {
                    Ok(AnalyteRow {
                        id: r.get(0)?,
                        lab_test_id: r.get(1)?,
                        name: r.get(2)?,
                        unit: r.get(3)?,
                        normal_min: r.get(4)?,
                        normal_max: r.get(5)?,
                        sort_order: r.get(6)?,
                        remarks: r.get(7)?,
                    })
                },
            )
            .map_err(|e| e.to_string());
    }
    let nid = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO lab_analytes (id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            nid,
            lab_test_id,
            input.name,
            input.unit,
            input.normal_min,
            input.normal_max,
            sort,
            input.remarks,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE id = ?1",
        params![nid],
        |r| {
            Ok(AnalyteRow {
                id: r.get(0)?,
                lab_test_id: r.get(1)?,
                name: r.get(2)?,
                unit: r.get(3)?,
                normal_min: r.get(4)?,
                normal_max: r.get(5)?,
                sort_order: r.get(6)?,
                remarks: r.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lab_analyte_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    conn.execute("DELETE FROM lab_analytes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    db::queue_remote_delete(&conn, "lab_analytes", &id)?;
    state.trigger_sync();
    Ok(())
}

#[derive(Serialize)]
pub struct LabOrderRow {
    pub id: String,
    pub pet_id: String,
    pub lab_test_id: String,
    pub receipt_number: Option<String>,
    pub tentative_report_at: Option<String>,
    pub status: String,
    pub created_at: String,
    pub lab_result_id: Option<String>,
}

#[derive(Deserialize)]
pub struct LabOrderInput {
    pub pet_id: String,
    pub lab_test_id: String,
    pub tentative_report_at: Option<String>,
}

#[tauri::command]
pub fn lab_order_create(state: State<'_, AppState>, input: LabOrderInput) -> Result<LabOrderRow, String> {
    require_login(&state)?;
    let id = Uuid::new_v4().to_string();
    let receipt = format!("RCP-{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("0000"));
    let now = crate::sync::approx_server_now();
    let conn = db::get_conn(&state.pool)?;
    conn.execute(
        "INSERT INTO lab_orders (id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)",
        params![
            id,
            input.pet_id,
            input.lab_test_id,
            receipt,
            input.tentative_report_at,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "lab_orders", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at FROM lab_orders WHERE id = ?1",
        params![id],
        |r| {
            Ok(LabOrderRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                lab_test_id: r.get(2)?,
                receipt_number: r.get(3)?,
                tentative_report_at: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
                lab_result_id: None,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lab_orders_for_pet(state: State<'_, AppState>, pet_id: String) -> Result<Vec<LabOrderRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare(
            "SELECT o.id, o.pet_id, o.lab_test_id, o.receipt_number, o.tentative_report_at, o.status, o.created_at,
                    (SELECT r.id FROM lab_results r WHERE r.lab_order_id = o.id ORDER BY r.created_at DESC LIMIT 1)
             FROM lab_orders o WHERE o.pet_id = ?1 ORDER BY o.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pet_id], |r| {
            Ok(LabOrderRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                lab_test_id: r.get(2)?,
                receipt_number: r.get(3)?,
                tentative_report_at: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
                lab_result_id: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct LabResultValueInput {
    pub analyte_id: String,
    pub observed_value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabResultValuePatch {
    pub id: String,
    pub observed_value: String,
}

#[derive(Serialize)]
pub struct LabResultValueRow {
    pub id: String,
    pub analyte_name: String,
    pub unit: Option<String>,
    pub normal_min: Option<f64>,
    pub normal_max: Option<f64>,
    pub observed_value: String,
    pub remarks: Option<String>,
}

#[derive(Serialize)]
pub struct LabResultDetail {
    pub id: String,
    pub lab_order_id: String,
    pub pet_id: String,
    pub lab_test_id: String,
    pub created_at: String,
    pub notes: Option<String>,
    pub values: Vec<LabResultValueRow>,
}

#[tauri::command]
pub fn lab_result_save(
    state: State<'_, AppState>,
    lab_order_id: String,
    values: Vec<LabResultValueInput>,
    notes: Option<String>,
) -> Result<LabResultDetail, String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (pet_id, lab_test_id): (String, String) = tx
        .query_row(
            "SELECT pet_id, lab_test_id FROM lab_orders WHERE id = ?1",
            params![lab_order_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Lab order not found".to_string())?;

    let existing_id: Option<String> = tx
        .query_row(
            "SELECT id FROM lab_results WHERE lab_order_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![lab_order_id],
            |r| r.get(0),
        )
        .ok();
    let result_id = existing_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = crate::sync::approx_server_now();

    if existing_id.is_some() {
        tx.execute(
            "UPDATE lab_results SET notes = ?1, updated_at = ?2 WHERE id = ?3",
            params![notes, now, result_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
            params![result_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "INSERT INTO lab_results (id, lab_order_id, pet_id, lab_test_id, created_at, notes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)",
            params![result_id, lab_order_id, pet_id, lab_test_id, now, notes],
        )
        .map_err(|e| e.to_string())?;
        let med_id = Uuid::new_v4().to_string();
        let title = format!("Laboratory report ({})", now);
        tx.execute(
            "INSERT INTO medical_history_entries (id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, external_file_path, lab_result_id, created_at, updated_at) VALUES (?1, ?2, 'lab_report', ?3, NULL, '[]', '[]', NULL, NULL, NULL, ?4, ?5, ?5)",
            params![med_id, pet_id, title, result_id, now],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut value_rows: Vec<LabResultValueRow> = Vec::new();
    for v in values {
        let analyte: (String, Option<String>, Option<f64>, Option<f64>, Option<String>) = tx
            .query_row(
                "SELECT name, unit, normal_min, normal_max, remarks FROM lab_analytes WHERE id = ?1 AND lab_test_id = ?2",
                params![v.analyte_id, lab_test_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|_| "Unknown analyte for this test".to_string())?;
        let vid = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO lab_result_values (id, lab_result_id, analyte_id, analyte_name, unit, normal_min, normal_max, observed_value, remarks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                vid,
                result_id,
                v.analyte_id,
                analyte.0,
                analyte.1,
                analyte.2,
                analyte.3,
                v.observed_value,
                analyte.4,
            ],
        )
        .map_err(|e| e.to_string())?;
        value_rows.push(LabResultValueRow {
            id: vid,
            analyte_name: analyte.0,
            unit: analyte.1,
            normal_min: analyte.2,
            normal_max: analyte.3,
            observed_value: v.observed_value,
            remarks: analyte.4,
        });
    }

    tx.execute(
        "UPDATE lab_orders SET status = 'completed', updated_at = ?2 WHERE id = ?1",
        params![lab_order_id, now],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    db::mark_dirty(&conn, "lab_results", &result_id)?;
    db::mark_dirty(&conn, "lab_orders", &lab_order_id)?;
    state.trigger_sync();

    let created_at: String = {
        let conn = db::get_conn(&state.pool)?;
        conn.query_row(
            "SELECT created_at FROM lab_results WHERE id = ?1",
            params![result_id],
            |r| r.get(0),
        )
        .unwrap_or(now)
    };

    Ok(LabResultDetail {
        id: result_id,
        lab_order_id,
        pet_id,
        lab_test_id,
        created_at,
        notes,
        values: value_rows,
    })
}

#[tauri::command]
pub fn lab_order_delete(state: State<'_, AppState>, order_id: String) -> Result<(), String> {
    require_login(&state)?;
    let mut conn = db::get_conn(&state.pool)?;
    conn.query_row(
        "SELECT id FROM lab_orders WHERE id = ?1",
        params![order_id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| "Lab order not found".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut result_ids: Vec<String> = Vec::new();
    {
        let mut stmt = tx
            .prepare("SELECT id FROM lab_results WHERE lab_order_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![order_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            result_ids.push(row.map_err(|e| e.to_string())?);
        }
    }

    for rid in &result_ids {
        let mut med_ids: Vec<String> = Vec::new();
        {
            let mut stmt = tx
                .prepare("SELECT id FROM medical_history_entries WHERE lab_result_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![rid], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                med_ids.push(row.map_err(|e| e.to_string())?);
            }
        }
        for mid in med_ids {
            tx.execute(
                "DELETE FROM medical_history_entries WHERE id = ?1",
                params![mid],
            )
            .map_err(|e| e.to_string())?;
            db::queue_remote_delete(&tx, "medical_history_entries", &mid)?;
        }
        tx.execute(
            "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
            params![rid],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM lab_results WHERE id = ?1", params![rid])
            .map_err(|e| e.to_string())?;
        db::queue_remote_delete(&tx, "lab_results", rid)?;
    }

    tx.execute("DELETE FROM lab_orders WHERE id = ?1", params![order_id])
        .map_err(|e| e.to_string())?;
    db::queue_remote_delete(&tx, "lab_orders", &order_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    state.trigger_sync();
    Ok(())
}

#[tauri::command]
pub fn lab_result_get(state: State<'_, AppState>, id: String) -> Result<LabResultDetail, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let head: (String, String, String, String, Option<String>) = conn
        .query_row(
            "SELECT id, lab_order_id, pet_id, lab_test_id, notes FROM lab_results WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "Result not found".to_string())?;
    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM lab_results WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT v.id, v.analyte_name, v.unit, v.normal_min, v.normal_max, v.observed_value, v.remarks \
             FROM lab_result_values v \
             LEFT JOIN lab_analytes a ON v.analyte_id = a.id \
             WHERE v.lab_result_id = ?1 \
             ORDER BY a.sort_order ASC, a.name ASC, v.analyte_name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![head.0], |r| {
            Ok(LabResultValueRow {
                id: r.get(0)?,
                analyte_name: r.get(1)?,
                unit: r.get(2)?,
                normal_min: r.get(3)?,
                normal_max: r.get(4)?,
                observed_value: r.get(5)?,
                remarks: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut vals = Vec::new();
    for row in rows {
        vals.push(row.map_err(|e| e.to_string())?);
    }
    Ok(LabResultDetail {
        id: head.0,
        lab_order_id: head.1,
        pet_id: head.2,
        lab_test_id: head.3,
        created_at,
        notes: head.4,
        values: vals,
    })
}

#[derive(Serialize)]
pub struct LabResultSummaryRow {
    pub id: String,
    pub pet_id: String,
    pub pet_name: String,
    pub lab_test_id: String,
    pub test_name: String,
    pub created_at: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn lab_results_history(state: State<'_, AppState>) -> Result<Vec<LabResultSummaryRow>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare(
            "SELECT lr.id, lr.pet_id, p.name, lr.lab_test_id, lt.name, lr.created_at, lr.notes \
             FROM lab_results lr \
             INNER JOIN pets p ON p.id = lr.pet_id \
             INNER JOIN lab_tests lt ON lt.id = lr.lab_test_id \
             ORDER BY lr.created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LabResultSummaryRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                pet_name: r.get(2)?,
                lab_test_id: r.get(3)?,
                test_name: r.get(4)?,
                created_at: r.get(5)?,
                notes: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn lab_results_for_history(
    state: State<'_, AppState>,
    pet_id: String,
    lab_test_id: String,
) -> Result<Vec<LabResultDetail>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;

    let mut stmt = conn
        .prepare("SELECT id FROM lab_results WHERE pet_id = ?1 AND lab_test_id = ?2 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let ids = stmt
        .query_map(params![pet_id, lab_test_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for id_res in ids {
        let id = id_res.map_err(|e| e.to_string())?;

        let head: (String, String, String, String, Option<String>, String) = conn
            .query_row(
                "SELECT id, lab_order_id, pet_id, lab_test_id, notes, created_at FROM lab_results WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .map_err(|e| e.to_string())?;

        let mut val_stmt = conn
            .prepare(
                "SELECT v.id, v.analyte_name, v.unit, v.normal_min, v.normal_max, v.observed_value, v.remarks \
                 FROM lab_result_values v \
                 LEFT JOIN lab_analytes a ON v.analyte_id = a.id \
                 WHERE v.lab_result_id = ?1 \
                 ORDER BY a.sort_order ASC, a.name ASC, v.analyte_name ASC",
            )
            .map_err(|e| e.to_string())?;

        let val_rows = val_stmt
            .query_map(params![head.0], |r| {
                Ok(LabResultValueRow {
                    id: r.get(0)?,
                    analyte_name: r.get(1)?,
                    unit: r.get(2)?,
                    normal_min: r.get(3)?,
                    normal_max: r.get(4)?,
                    observed_value: r.get(5)?,
                    remarks: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut vals = Vec::new();
        for row in val_rows {
            vals.push(row.map_err(|e| e.to_string())?);
        }

        out.push(LabResultDetail {
            id: head.0,
            lab_order_id: head.1,
            pet_id: head.2,
            lab_test_id: head.3,
            created_at: head.5,
            notes: head.4,
            values: vals,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn lab_result_update(
    state: State<'_, AppState>,
    lab_result_id: String,
    values: Vec<LabResultValuePatch>,
    notes: Option<String>,
) -> Result<LabResultDetail, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    conn.query_row(
        "SELECT id FROM lab_results WHERE id = ?1",
        params![lab_result_id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| "Lab result not found".to_string())?;
    let now = crate::sync::approx_server_now();
    for p in &values {
        let n = conn
            .execute(
                "UPDATE lab_result_values SET observed_value = ?1 WHERE id = ?2 AND lab_result_id = ?3",
                params![p.observed_value, p.id, lab_result_id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Invalid result value row".to_string());
        }
    }
    conn.execute(
        "UPDATE lab_results SET notes = ?1, updated_at = ?2 WHERE id = ?3",
        params![notes, now, lab_result_id],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "lab_results", &lab_result_id)?;
    drop(conn);
    state.trigger_sync();
    lab_result_get(state, lab_result_id)
}

#[derive(Serialize)]
pub struct VaccinationReminder {
    pub pet_id: String,
    pub pet_name: String,
    pub vaccine_name: String,
    pub next_due_date: String,
    pub days_until: i64,
}

#[tauri::command]
pub fn dashboard_vaccination_reminders(state: State<'_, AppState>, within_days: i64) -> Result<Vec<VaccinationReminder>, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let today = chrono::Utc::now().date_naive();
    let mut stmt = conn
        .prepare(
            "SELECT v.pet_id, p.name, v.vaccine_name, v.next_due_date FROM vaccinations v JOIN pets p ON p.id = v.pet_id WHERE v.next_due_date IS NOT NULL AND v.next_due_date != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (pet_id, pet_name, vaccine_name, due_s) = row.map_err(|e| e.to_string())?;
        let due = chrono::NaiveDate::parse_from_str(&due_s, "%Y-%m-%d").or_else(|_| {
            chrono::DateTime::parse_from_rfc3339(&due_s)
                .map(|d| d.date_naive())
        });
        let due = match due {
            Ok(d) => d,
            Err(_) => continue,
        };
        let days_until = (due - today).num_days();
        if days_until >= 0 && days_until <= within_days {
            out.push(VaccinationReminder {
                pet_id,
                pet_name,
                vaccine_name,
                next_due_date: due_s,
                days_until,
            });
        }
    }
    out.sort_by_key(|v| v.days_until);
    Ok(out)
}

#[derive(Serialize)]
pub struct OpdRequestRow {
    pub id: String,
    pub pet_id: String,
    pub pet_name: String,
    pub pet_card_id: String,
    pub species: Option<String>,
    pub breed: Option<String>,
    pub weight: Option<String>,
    pub age: Option<String>,
    pub date_of_birth: Option<String>,
    pub sex: Option<String>,
    pub owner_name: Option<String>,
    pub owner_phone: Option<String>,
    pub requested_by_user_id: String,
    pub requested_by_name: String,
    pub status: String,
    pub assigned_vet_id: Option<String>,
    pub assigned_vet_name: Option<String>,
    pub created_at: String,
    pub claimed_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpdMedicineRow {
    pub name: String,
    pub dosage: Option<String>,
    pub direction_per_day: Option<String>,
}

#[derive(Deserialize)]
pub struct OpdMedicineInput {
    pub name: String,
    pub dosage: Option<String>,
    pub direction_per_day: Option<String>,
}

#[derive(Serialize)]
pub struct OpdConsultationRow {
    pub id: String,
    pub request_id: String,
    pub pet_id: String,
    pub pet_name: String,
    pub pet_card_id: String,
    pub species: Option<String>,
    pub breed: Option<String>,
    pub weight: Option<String>,
    pub age: Option<String>,
    pub date_of_birth: Option<String>,
    pub sex: Option<String>,
    pub owner_name: Option<String>,
    pub owner_phone: Option<String>,
    pub vet_id: String,
    pub vet_name: String,
    pub doctor_signature_name: String,
    pub temperature: Option<String>,
    pub physical_exam: Option<String>,
    pub history_observations: Vec<String>,
    pub dx_items: Vec<String>,
    pub ddx_items: Vec<String>,
    pub diagnosis_note: Option<String>,
    pub differential_diagnosis_note: Option<String>,
    pub symptoms: Vec<String>,
    pub recommended_lab_test_ids: Vec<String>,
    pub recommended_lab_test_names: Vec<String>,
    pub custom_lab_tests: Vec<String>,
    pub medicines: Vec<OpdMedicineRow>,
    pub clinical_treatment_remark: Option<String>,
    pub in_house_prescription: Option<String>,
    pub recommended_food: Option<String>,
    pub next_visit_at: Option<String>,
    pub created_at: String,
    pub body_weight: Option<String>,
    pub vaccinated: bool,
    pub deworming: bool,
    pub prognosis: Option<String>,
}

#[derive(Deserialize)]
pub struct OpdConsultationInput {
    pub request_id: String,
    pub temperature: Option<String>,
    pub physical_exam: Option<String>,
    pub history_observations: Option<Vec<String>>,
    pub dx_items: Option<Vec<String>>,
    pub ddx_items: Option<Vec<String>>,
    pub diagnosis_note: Option<String>,
    pub differential_diagnosis_note: Option<String>,
    pub symptoms: Option<Vec<String>>,
    pub recommended_lab_test_ids: Option<Vec<String>>,
    pub custom_lab_tests: Option<Vec<String>>,
    pub medicines: Option<Vec<OpdMedicineInput>>,
    pub clinical_treatment_remark: Option<String>,
    pub in_house_prescription: Option<String>,
    pub recommended_food: Option<String>,
    pub next_visit_at: Option<String>,
    pub doctor_signature_name: String,
    pub body_weight: Option<String>,
    #[serde(default)]
    pub vaccinated: Option<bool>,
    #[serde(default)]
    pub deworming: Option<bool>,
    pub prognosis: Option<String>,
}

#[derive(Serialize)]
pub struct OpdDashboardSummary {
    pub checked_today: i64,
    pub checked_week: i64,
    pub checked_month: i64,
    pub next_visits: Vec<OpdConsultationRow>,
}

#[derive(Serialize)]
pub struct OpdCatalogItemRow {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub name: String,
    pub active: bool,
    pub created_at: String,
}

fn parse_string_array_json(raw: Option<String>) -> Vec<String> {
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn parse_medicines_json(raw: Option<String>) -> Vec<OpdMedicineRow> {
    raw.and_then(|s| serde_json::from_str::<Vec<OpdMedicineRow>>(&s).ok())
        .unwrap_or_default()
}

fn build_opd_request_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<OpdRequestRow> {
    Ok(OpdRequestRow {
        id: r.get(0)?,
        pet_id: r.get(1)?,
        pet_name: r.get(2)?,
        pet_card_id: r.get(3)?,
        species: r.get(4)?,
        breed: r.get(5)?,
        weight: r.get(6)?,
        age: r.get(7)?,
        date_of_birth: r.get(8)?,
        sex: r.get(9)?,
        owner_name: r.get(10)?,
        owner_phone: r.get(11)?,
        requested_by_user_id: r.get(12)?,
        requested_by_name: r.get(13)?,
        status: r.get(14)?,
        assigned_vet_id: r.get(15)?,
        assigned_vet_name: r.get(16)?,
        created_at: r.get(17)?,
        claimed_at: r.get(18)?,
        completed_at: r.get(19)?,
    })
}

fn build_opd_catalog_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<OpdCatalogItemRow> {
    Ok(OpdCatalogItemRow {
        id: r.get(0)?,
        item_type: r.get(1)?,
        name: r.get(2)?,
        active: r.get::<_, i64>(3)? != 0,
        created_at: r.get(4)?,
    })
}

#[tauri::command]
pub fn opd_requests_list(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<OpdRequestRow>, String> {
    require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut sql = "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id".to_string();
    let normalized = status
        .as_ref()
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "open".to_string());
    if normalized == "open" {
        sql.push_str(" WHERE o.status IN ('pending', 'in_progress')");
    } else if normalized == "pending"
        || normalized == "in_progress"
        || normalized == "completed"
    {
        sql.push_str(" WHERE o.status = ?1");
    }
    sql.push_str(" ORDER BY o.created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if normalized == "pending"
        || normalized == "in_progress"
        || normalized == "completed"
    {
        stmt.query_map(params![normalized], build_opd_request_row)
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], build_opd_request_row)
            .map_err(|e| e.to_string())?
    };
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn opd_request_create(state: State<'_, AppState>, pet_id: String) -> Result<OpdRequestRow, String> {
    let session = require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let _: String = conn
        .query_row("SELECT id FROM pets WHERE id = ?1", params![pet_id], |r| r.get(0))
        .map_err(|_| "Pet not found".to_string())?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM opd_requests WHERE pet_id = ?1 AND status IN ('pending', 'in_progress') ORDER BY created_at DESC LIMIT 1",
            params![pet_id],
            |r| r.get(0),
        )
        .ok();
    let id = if let Some(eid) = existing {
        eid
    } else {
        let nid = Uuid::new_v4().to_string();
        let now = crate::sync::approx_server_now();
        conn.execute(
            "INSERT INTO opd_requests (id, pet_id, requested_by_user_id, requested_by_name, status, assigned_vet_id, assigned_vet_name, created_at, claimed_at, completed_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5, NULL, NULL, ?5)",
            params![nid, pet_id, session.id, session.display_name, now],
        )
        .map_err(|e| e.to_string())?;
        db::mark_dirty(&conn, "opd_requests", &nid)?;
        state.trigger_sync();
        nid
    };
    conn.query_row(
        "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
        params![id],
        |r| {
            Ok(OpdRequestRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                pet_name: r.get(2)?,
                pet_card_id: r.get(3)?,
                species: r.get(4)?,
                breed: r.get(5)?,
                weight: r.get(6)?,
                age: r.get(7)?,
                date_of_birth: r.get(8)?,
                sex: r.get(9)?,
                owner_name: r.get(10)?,
                owner_phone: r.get(11)?,
                requested_by_user_id: r.get(12)?,
                requested_by_name: r.get(13)?,
                status: r.get(14)?,
                assigned_vet_id: r.get(15)?,
                assigned_vet_name: r.get(16)?,
                created_at: r.get(17)?,
                claimed_at: r.get(18)?,
                completed_at: r.get(19)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn can_claim_opd(role: &str) -> bool {
    role == "vet" || role == "manager" || role == "superadmin"
}

/// Superadmin may close / reassign OPD cases already claimed by another user.
fn can_override_opd_assignment(role: &str) -> bool {
    role == "superadmin"
}

/// Superadmin may delete any OPD request (pending, in progress, or completed).
fn can_delete_opd_request(role: &str) -> bool {
    role == "superadmin"
}

#[tauri::command]
pub fn opd_request_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let session = require_login(&state)?;
    if !can_delete_opd_request(&session.role) {
        return Err("Only superadmin can delete OPD requests".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    // Queue consultation tombstones before CASCADE removes local rows.
    let mut cons_ids: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id FROM opd_consultations WHERE request_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            cons_ids.push(row.map_err(|e| e.to_string())?);
        }
    }
    let n = conn
        .execute("DELETE FROM opd_requests WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("OPD request not found".to_string());
    }
    for cid in &cons_ids {
        db::queue_remote_delete(&conn, "opd_consultations", cid)?;
    }
    db::queue_remote_delete(&conn, "opd_requests", &id)?;
    state.trigger_sync();
    Ok(())
}

#[tauri::command]
pub fn opd_request_claim(state: State<'_, AppState>, id: String) -> Result<OpdRequestRow, String> {
    let session = require_login(&state)?;
    if !can_claim_opd(&session.role) {
        return Err("Only clinic staff (vet, manager, superadmin) can claim OPD requests".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    // Resolve after sync remaps usernames → UUIDs so we never assign a stale/other user id.
    let assignee_id = resolve_session_user_id(&state, &conn, &session)?;
    let existing: (String, Option<String>) = conn
        .query_row(
            "SELECT status, assigned_vet_id FROM opd_requests WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "OPD request not found".to_string())?;
    if existing.0 == "completed" {
        return Err("OPD request is already completed".to_string());
    }
    if let Some(ref assigned) = existing.1 {
        if assigned != &assignee_id && assigned != &session.id {
            if !can_override_opd_assignment(&session.role) {
                return Err("This OPD request is already assigned to another user".to_string());
            }
        }
    }
    // No-op when already claimed by this user — avoids bumping updated_at and
    // overwriting a completed status on other devices via stale in_progress pushes.
    if existing.0 == "in_progress" {
        if let Some(ref assigned) = existing.1 {
            if assigned == &assignee_id || assigned == &session.id {
                return conn.query_row(
                    "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
                    params![id],
                    |r| {
                        Ok(OpdRequestRow {
                            id: r.get(0)?,
                            pet_id: r.get(1)?,
                            pet_name: r.get(2)?,
                            pet_card_id: r.get(3)?,
                            species: r.get(4)?,
                            breed: r.get(5)?,
                            weight: r.get(6)?,
                            age: r.get(7)?,
                            date_of_birth: r.get(8)?,
                            sex: r.get(9)?,
                            owner_name: r.get(10)?,
                            owner_phone: r.get(11)?,
                            requested_by_user_id: r.get(12)?,
                            requested_by_name: r.get(13)?,
                            status: r.get(14)?,
                            assigned_vet_id: r.get(15)?,
                            assigned_vet_name: r.get(16)?,
                            created_at: r.get(17)?,
                            claimed_at: r.get(18)?,
                            completed_at: r.get(19)?,
                        })
                    },
                )
                .map_err(|e| e.to_string());
            }
        }
    }
    let now = crate::sync::approx_server_now();
    conn.execute(
        "UPDATE opd_requests SET status = 'in_progress', assigned_vet_id = ?2, assigned_vet_name = ?3, claimed_at = COALESCE(claimed_at, ?4), updated_at = ?4 WHERE id = ?1",
        params![id, assignee_id, session.display_name, now],
    )
    .map_err(|e| map_sqlite_user_err(e.to_string()))?;
    db::mark_dirty(&conn, "opd_requests", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
        params![id],
        |r| {
            Ok(OpdRequestRow {
                id: r.get(0)?,
                pet_id: r.get(1)?,
                pet_name: r.get(2)?,
                pet_card_id: r.get(3)?,
                species: r.get(4)?,
                breed: r.get(5)?,
                weight: r.get(6)?,
                age: r.get(7)?,
                date_of_birth: r.get(8)?,
                sex: r.get(9)?,
                owner_name: r.get(10)?,
                owner_phone: r.get(11)?,
                requested_by_user_id: r.get(12)?,
                requested_by_name: r.get(13)?,
                status: r.get(14)?,
                assigned_vet_id: r.get(15)?,
                assigned_vet_name: r.get(16)?,
                created_at: r.get(17)?,
                claimed_at: r.get(18)?,
                completed_at: r.get(19)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn build_consultation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OpdConsultationRow> {
    let history_raw: Option<String> = row.get(18)?;
    let dx_items_raw: Option<String> = row.get(19)?;
    let ddx_items_raw: Option<String> = row.get(20)?;
    let symptoms_raw: Option<String> = row.get(23)?;
    let lab_ids_raw: Option<String> = row.get(24)?;
    let lab_names_raw: Option<String> = row.get(25)?;
    let custom_tests_raw: Option<String> = row.get(26)?;
    let meds_raw: Option<String> = row.get(27)?;
    Ok(OpdConsultationRow {
        id: row.get(0)?,
        request_id: row.get(1)?,
        pet_id: row.get(2)?,
        pet_name: row.get(3)?,
        pet_card_id: row.get(4)?,
        species: row.get(5)?,
        breed: row.get(6)?,
        weight: row.get(7)?,
        age: row.get(8)?,
        date_of_birth: row.get(9)?,
        sex: row.get(10)?,
        owner_name: row.get(11)?,
        owner_phone: row.get(12)?,
        vet_id: row.get(13)?,
        vet_name: row.get(14)?,
        doctor_signature_name: row.get(15)?,
        temperature: row.get(16)?,
        physical_exam: row.get(17)?,
        history_observations: parse_string_array_json(history_raw),
        dx_items: parse_string_array_json(dx_items_raw),
        ddx_items: parse_string_array_json(ddx_items_raw),
        diagnosis_note: row.get(21)?,
        differential_diagnosis_note: row.get(22)?,
        symptoms: parse_string_array_json(symptoms_raw),
        recommended_lab_test_ids: parse_string_array_json(lab_ids_raw),
        recommended_lab_test_names: parse_string_array_json(lab_names_raw),
        custom_lab_tests: parse_string_array_json(custom_tests_raw),
        medicines: parse_medicines_json(meds_raw),
        clinical_treatment_remark: row.get(28)?,
        in_house_prescription: row.get(29)?,
        recommended_food: row.get(30)?,
        next_visit_at: row.get(31)?,
        created_at: row.get(32)?,
        body_weight: row.get(33)?,
        vaccinated: row.get::<_, Option<i64>>(34)?.unwrap_or(0) != 0,
        deworming: row.get::<_, Option<i64>>(35)?.unwrap_or(0) != 0,
        prognosis: row.get(36)?,
    })
}

#[tauri::command]
pub fn opd_consultations_list(
    state: State<'_, AppState>,
    pet_id: Option<String>,
    mine: Option<bool>,
) -> Result<Vec<OpdConsultationRow>, String> {
    let session = require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut sql = "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight, COALESCE(c.vaccinated, 0), COALESCE(c.deworming, 0), c.prognosis FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id".to_string();
    let mut clauses: Vec<String> = Vec::new();
    if pet_id.is_some() {
        clauses.push("c.pet_id = ?1".to_string());
    }
    let use_mine = mine.unwrap_or(false) && session.role == "vet";
    if use_mine {
        clauses.push(if pet_id.is_some() {
            "c.vet_id = ?2".to_string()
        } else {
            "c.vet_id = ?1".to_string()
        });
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY c.created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match (pet_id, use_mine) {
        (Some(pid), true) => stmt.query_map(params![pid, session.id], build_consultation_row),
        (Some(pid), false) => stmt.query_map(params![pid], build_consultation_row),
        (None, true) => stmt.query_map(params![session.id], build_consultation_row),
        (None, false) => stmt.query_map([], build_consultation_row),
    }
    .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn opd_consultation_create(
    state: State<'_, AppState>,
    input: OpdConsultationInput,
) -> Result<OpdConsultationRow, String> {
    let session = require_login(&state)?;
    if !can_claim_opd(&session.role) {
        return Err("Only clinic staff (vet, manager, superadmin) can submit OPD consultation".to_string());
    }
    if input.request_id.trim().is_empty() {
        return Err("request_id is required".to_string());
    }
    if input.doctor_signature_name.trim().is_empty() {
        return Err("doctor_signature_name is required".to_string());
    }
    let mut conn = db::get_conn(&state.pool)?;
    let vet_id = resolve_session_user_id(&state, &conn, &session)?;
    let request_row: (String, String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT pet_id, status, assigned_vet_id, claimed_at FROM opd_requests WHERE id = ?1",
            params![input.request_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "OPD request not found".to_string())?;
    if request_row.1 == "completed" {
        return Err("This OPD request is already completed".to_string());
    }
    if let Some(assigned) = request_row.2.clone() {
        if assigned != vet_id && assigned != session.id {
            if !can_override_opd_assignment(&session.role) {
                return Err("This OPD request is assigned to another user".to_string());
            }
        }
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = crate::sync::approx_server_now();
    tx.execute(
        "UPDATE opd_requests SET status = 'in_progress', assigned_vet_id = ?2, assigned_vet_name = ?3, claimed_at = COALESCE(claimed_at, ?4), updated_at = ?5 WHERE id = ?1",
        params![input.request_id, vet_id, session.display_name, request_row.3.unwrap_or(now.clone()), now],
    )
    .map_err(|e| map_sqlite_user_err(e.to_string()))?;
    let recommended_ids: Vec<String> = input
        .recommended_lab_test_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut recommended_names: Vec<String> = Vec::new();
    for tid in &recommended_ids {
        let name: Option<String> = tx
            .query_row(
                "SELECT name FROM lab_tests WHERE id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .ok();
        if let Some(n) = name {
            recommended_names.push(n);
        }
    }
    let meds: Vec<OpdMedicineRow> = input
        .medicines
        .unwrap_or_default()
        .into_iter()
        .map(|m| OpdMedicineRow {
            name: m.name.trim().to_string(),
            dosage: m.dosage.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            direction_per_day: m
                .direction_per_day
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty()),
        })
        .filter(|m| !m.name.is_empty())
        .collect();
    let existing_consultation_id: Option<String> = tx
        .query_row(
            "SELECT id FROM opd_consultations WHERE request_id = ?1",
            params![input.request_id],
            |r| r.get(0),
        )
        .ok();
    let updating_existing = existing_consultation_id.is_some();
    // Stable id per request so offline dual-closes merge to one Mongo document.
    let id = existing_consultation_id
        .clone()
        .unwrap_or_else(|| format!("opd-cons-{}", input.request_id.trim()));
    let temperature = input
        .temperature
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let physical_exam = input
        .physical_exam
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let history_json = serde_json::to_string(
        &input
            .history_observations
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let dx_json = serde_json::to_string(
        &input
            .dx_items
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let ddx_json = serde_json::to_string(
        &input
            .ddx_items
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let diagnosis_note = input
        .diagnosis_note
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let differential_diagnosis_note = input
        .differential_diagnosis_note
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let symptoms_json = serde_json::to_string(
        &input
            .symptoms
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let recommended_ids_json = serde_json::to_string(&recommended_ids).unwrap_or_else(|_| "[]".to_string());
    let recommended_names_json =
        serde_json::to_string(&recommended_names).unwrap_or_else(|_| "[]".to_string());
    let custom_lab_tests_json = serde_json::to_string(
        &input
            .custom_lab_tests
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let medicines_json = serde_json::to_string(&meds).unwrap_or_else(|_| "[]".to_string());
    let clinical_treatment_remark = input
        .clinical_treatment_remark
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let in_house_prescription = input
        .in_house_prescription
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let recommended_food = input
        .recommended_food
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    let next_visit_at = input.next_visit_at.filter(|x| !x.trim().is_empty());
    let vaccinated = if input.vaccinated.unwrap_or(false) { 1 } else { 0 };
    let deworming = if input.deworming.unwrap_or(false) { 1 } else { 0 };
    let prognosis = input
        .prognosis
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty());
    if updating_existing {
        tx.execute(
            "UPDATE opd_consultations SET pet_id = ?2, vet_id = ?3, vet_name = ?4, doctor_signature_name = ?5, temperature = ?6, physical_exam = ?7, history_observations = ?8, dx_items = ?9, ddx_items = ?10, diagnosis_note = ?11, differential_diagnosis_note = ?12, symptoms = ?13, recommended_lab_test_ids = ?14, recommended_lab_test_names = ?15, custom_lab_tests = ?16, medicines_json = ?17, clinical_treatment_remark = ?18, in_house_prescription = ?19, recommended_food = ?20, next_visit_at = ?21, body_weight = ?22, vaccinated = ?23, deworming = ?24, prognosis = ?25, updated_at = ?26 WHERE id = ?1",
            params![
                id,
                request_row.0,
                vet_id,
                session.display_name,
                input.doctor_signature_name.trim(),
                temperature,
                physical_exam,
                history_json,
                dx_json,
                ddx_json,
                diagnosis_note,
                differential_diagnosis_note,
                symptoms_json,
                recommended_ids_json,
                recommended_names_json,
                custom_lab_tests_json,
                medicines_json,
                clinical_treatment_remark,
                in_house_prescription,
                recommended_food,
                next_visit_at,
                input.body_weight,
                vaccinated,
                deworming,
                prognosis,
                now,
            ],
        )
        .map_err(|e| map_sqlite_user_err(e.to_string()))?;
    } else {
        tx.execute(
            "INSERT INTO opd_consultations (id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, temperature, physical_exam, history_observations, dx_items, ddx_items, diagnosis_note, differential_diagnosis_note, symptoms, recommended_lab_test_ids, recommended_lab_test_names, custom_lab_tests, medicines_json, clinical_treatment_remark, in_house_prescription, recommended_food, next_visit_at, created_at, body_weight, vaccinated, deworming, prognosis, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)",
            params![
                id,
                input.request_id,
                request_row.0,
                vet_id,
                session.display_name,
                input.doctor_signature_name.trim(),
                temperature,
                physical_exam,
                history_json,
                dx_json,
                ddx_json,
                diagnosis_note,
                differential_diagnosis_note,
                symptoms_json,
                recommended_ids_json,
                recommended_names_json,
                custom_lab_tests_json,
                medicines_json,
                clinical_treatment_remark,
                in_house_prescription,
                recommended_food,
                next_visit_at,
                now,
                input.body_weight,
                vaccinated,
                deworming,
                prognosis,
                now,
            ],
        )
        .map_err(|e| map_sqlite_user_err(e.to_string()))?;
    }
    tx.execute(
        "UPDATE opd_requests SET status = 'completed', assigned_vet_id = ?2, assigned_vet_name = ?3, completed_at = ?4, updated_at = ?4 WHERE id = ?1",
        params![input.request_id, vet_id, session.display_name, now],
    )
    .map_err(|e| map_sqlite_user_err(e.to_string()))?;
    update_pet_weight(&tx, &request_row.0, &input.body_weight)?;
    tx.commit().map_err(|e| e.to_string())?;
    let conn = db::get_conn(&state.pool)?;
    // Triggers are suppressed while pulling=1; always queue OPD rows for upload.
    db::mark_dirty(&conn, "opd_consultations", &id)?;
    db::mark_dirty(&conn, "opd_requests", &input.request_id.trim())?;
    if input
        .body_weight
        .as_ref()
        .map(|w| !w.trim().is_empty())
        .unwrap_or(false)
    {
        db::mark_dirty(&conn, "pets", &request_row.0)?;
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight, COALESCE(c.vaccinated, 0), COALESCE(c.deworming, 0), c.prognosis FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.id = ?1",
        params![id],
        build_consultation_row,
    )
    .map_err(|e| e.to_string())
}


#[tauri::command]
pub fn opd_consultation_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let n = conn
        .execute("DELETE FROM opd_consultations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("OPD consultation not found".to_string());
    }
    db::queue_remote_delete(&conn, "opd_consultations", &id)?;
    state.trigger_sync();
    Ok(())
}

#[tauri::command]
pub fn opd_consultation_update(
    state: State<'_, AppState>,
    id: String,
    input: OpdConsultationInput,
) -> Result<OpdConsultationRow, String> {
    require_clinic_access(&state)?;
    if input.doctor_signature_name.trim().is_empty() {
        return Err("doctor_signature_name is required".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let recommended_ids: Vec<String> = input
        .recommended_lab_test_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut recommended_names: Vec<String> = Vec::new();
    for tid in &recommended_ids {
        let name: Option<String> = conn
            .query_row(
                "SELECT name FROM lab_tests WHERE id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .ok();
        if let Some(n) = name {
            recommended_names.push(n);
        }
    }
    let meds: Vec<OpdMedicineRow> = input
        .medicines
        .unwrap_or_default()
        .into_iter()
        .map(|m| OpdMedicineRow {
            name: m.name.trim().to_string(),
            dosage: m.dosage.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            direction_per_day: m
                .direction_per_day
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty()),
        })
        .filter(|m| !m.name.is_empty())
        .collect();
    let existing: (
        Option<String>,
        Option<String>,
        i64,
        i64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT physical_exam, in_house_prescription, COALESCE(vaccinated, 0), COALESCE(deworming, 0), prognosis FROM opd_consultations WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "OPD consultation not found".to_string())?;
    // Omitted JSON fields stay as stored. Empty string still clears the field.
    let physical_exam = match &input.physical_exam {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => existing.0,
    };
    let in_house_prescription = match &input.in_house_prescription {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => existing.1,
    };

    let now = crate::sync::approx_server_now();
    let vaccinated = match input.vaccinated {
        Some(v) => {
            if v {
                1
            } else {
                0
            }
        }
        None => existing.2,
    };
    let deworming = match input.deworming {
        Some(v) => {
            if v {
                1
            } else {
                0
            }
        }
        None => existing.3,
    };
    let prognosis = match &input.prognosis {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => existing.4,
    };
    let n = conn.execute(
        "UPDATE opd_consultations SET doctor_signature_name = ?2, temperature = ?3, physical_exam = ?4, history_observations = ?5, dx_items = ?6, ddx_items = ?7, diagnosis_note = ?8, differential_diagnosis_note = ?9, symptoms = ?10, recommended_lab_test_ids = ?11, recommended_lab_test_names = ?12, custom_lab_tests = ?13, medicines_json = ?14, clinical_treatment_remark = ?15, in_house_prescription = ?16, recommended_food = ?17, next_visit_at = ?18, body_weight = ?19, vaccinated = ?20, deworming = ?21, prognosis = ?22, updated_at = ?23 WHERE id = ?1",
        params![
            id,
            input.doctor_signature_name.trim(),
            input.temperature.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            physical_exam,
            serde_json::to_string(&input.history_observations.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&input.dx_items.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&input.ddx_items.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
            input.diagnosis_note.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            input.differential_diagnosis_note.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            serde_json::to_string(&input.symptoms.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&recommended_ids).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&recommended_names).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&input.custom_lab_tests.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&meds).unwrap_or_else(|_| "[]".to_string()),
            input.clinical_treatment_remark.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            in_house_prescription,
            input.recommended_food.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
            input.next_visit_at.filter(|x| !x.trim().is_empty()),
            input.body_weight,
            vaccinated,
            deworming,
            prognosis,
            now,
        ],
    ).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("OPD consultation not found".to_string());
    }
    db::mark_dirty(&conn, "opd_consultations", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight, COALESCE(c.vaccinated, 0), COALESCE(c.deworming, 0), c.prognosis FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.id = ?1",
        params![id],
        build_consultation_row,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn opd_request_reopen(state: State<'_, AppState>, id: String) -> Result<OpdRequestRow, String> {
    require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let status: String = conn
        .query_row("SELECT status FROM opd_requests WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(|_| "OPD request not found".to_string())?;
    if status != "completed" {
        return Err("Only completed cases can be reopened".to_string());
    }
    let now = crate::sync::approx_server_now();
    conn.execute(
        "UPDATE opd_requests SET status = 'pending', assigned_vet_id = NULL, assigned_vet_name = NULL, claimed_at = NULL, completed_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "opd_requests", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
        params![id],
        build_opd_request_row,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn opd_dashboard_summary(state: State<'_, AppState>) -> Result<OpdDashboardSummary, String> {
    let session = require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let now = chrono::Utc::now();
    let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339();
    let week_start_date =
        now.date_naive() - chrono::Duration::days(now.weekday().num_days_from_monday() as i64);
    let week = week_start_date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();
    let month = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();

    let query_count = |since: &str| -> Result<i64, String> {
        if session.role == "vet" {
            conn.query_row(
                "SELECT COUNT(*) FROM opd_consultations WHERE vet_id = ?1 AND created_at >= ?2",
                params![session.id, since],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM opd_consultations WHERE created_at >= ?1",
                params![since],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
        }
    };

    let mut sql = "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight, COALESCE(c.vaccinated, 0), COALESCE(c.deworming, 0), c.prognosis FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.next_visit_at IS NOT NULL AND c.next_visit_at >= ?1".to_string();
    if session.role == "vet" {
        sql.push_str(" AND c.vet_id = ?2");
    }
    sql.push_str(" ORDER BY c.next_visit_at ASC LIMIT 15");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if session.role == "vet" {
        stmt.query_map(params![today, session.id], build_consultation_row)
    } else {
        stmt.query_map(params![today], build_consultation_row)
    }
    .map_err(|e| e.to_string())?;
    let mut next_visits = Vec::new();
    for row in rows {
        next_visits.push(row.map_err(|e| e.to_string())?);
    }
    Ok(OpdDashboardSummary {
        checked_today: query_count(&today)?,
        checked_week: query_count(&week)?,
        checked_month: query_count(&month)?,
        next_visits,
    })
}

#[tauri::command]
pub fn opd_catalog_list(
    state: State<'_, AppState>,
    item_type: Option<String>,
) -> Result<Vec<OpdCatalogItemRow>, String> {
    require_clinic_access(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut sql = "SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE active = 1".to_string();
    if item_type.is_some() {
        sql.push_str(" AND type = ?1");
    }
    sql.push_str(" ORDER BY name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if let Some(t) = item_type {
        stmt.query_map(params![t], build_opd_catalog_row)
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], build_opd_catalog_row)
            .map_err(|e| e.to_string())?
    };
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn opd_catalog_create(
    state: State<'_, AppState>,
    item_type: String,
    name: String,
) -> Result<OpdCatalogItemRow, String> {
    require_superadmin(&state)?;
    let t = item_type.trim().to_string();
    if t != "history_observation"
        && t != "dx"
        && t != "ddx"
        && t != "vaccine"
        && t != "deworming"
        && t != "surgery"
        && t != "surgery_dx"
        && t != "surgery_ddx"
        && t != "radiology_dx"
        && t != "radiology_ddx"
        && t != "ultrasonography_dx"
        && t != "ultrasonography_ddx"
        && t != "medicine"
        && t != "food"
        && t != "symptom"
    {
        return Err("invalid catalog type".to_string());
    }
    let n = name.trim().to_string();
    if n.is_empty() {
        return Err("name is required".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM opd_catalog_items WHERE type = ?1 AND LOWER(name) = LOWER(?2) AND active = 1",
            params![t, n],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if dup > 0 {
        return Err("Item already exists".to_string());
    }
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    conn.execute(
        "INSERT INTO opd_catalog_items (id, type, name, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![id, t, n, now],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "opd_catalog_items", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE id = ?1",
        params![id],
        |r| {
            Ok(OpdCatalogItemRow {
                id: r.get(0)?,
                item_type: r.get(1)?,
                name: r.get(2)?,
                active: r.get::<_, i64>(3)? != 0,
                created_at: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn opd_catalog_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    require_superadmin(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let now = crate::sync::approx_server_now();
    let n = conn
        .execute(
            "UPDATE opd_catalog_items SET active = 0, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Catalog item not found".to_string());
    }
    db::mark_dirty(&conn, "opd_catalog_items", &id)?;
    state.trigger_sync();
    Ok(())
}

#[tauri::command]
pub fn opd_catalog_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<OpdCatalogItemRow, String> {
    require_superadmin(&state)?;
    let n = name.trim().to_string();
    if n.is_empty() {
        return Err("name is required".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let existing_type: String = conn
        .query_row(
            "SELECT type FROM opd_catalog_items WHERE id = ?1 AND active = 1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| "Catalog item not found".to_string())?;
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM opd_catalog_items WHERE type = ?1 AND LOWER(name) = LOWER(?2) AND active = 1 AND id != ?3",
            params![existing_type, n, id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if dup > 0 {
        return Err("An item with this name already exists".to_string());
    }
    let now = crate::sync::approx_server_now();
    conn.execute(
        "UPDATE opd_catalog_items SET name = ?1, updated_at = ?3 WHERE id = ?2",
        params![n, id, now],
    )
    .map_err(|e| e.to_string())?;
    db::mark_dirty(&conn, "opd_catalog_items", &id)?;
    state.trigger_sync();
    conn.query_row(
        "SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE id = ?1",
        params![id],
        |r| {
            Ok(OpdCatalogItemRow {
                id: r.get(0)?,
                item_type: r.get(1)?,
                name: r.get(2)?,
                active: r.get::<_, i64>(3)? != 0,
                created_at: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct UserDirectoryRow {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub created_at: String,
    pub active: bool,
}

fn require_superadmin(state: &AppState) -> Result<SessionUser, String> {
    let u = require_login(state)?;
    if u.role != "superadmin" {
        return Err("Superadmin only".to_string());
    }
    Ok(u)
}

#[tauri::command]
pub fn users_list(state: State<'_, AppState>) -> Result<Vec<UserDirectoryRow>, String> {
    require_superadmin(&state)?;
    let conn = db::get_conn(&state.pool)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, username, display_name, role, created_at, COALESCE(active, 1) FROM users ORDER BY username COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(UserDirectoryRow {
                id: r.get(0)?,
                username: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
                created_at: r.get(4)?,
                active: r.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct StaffUserCreateInput {
    pub username: String,
    pub password: String,
    pub display_name: String,
    pub role: String,
}

#[tauri::command]
pub fn users_create(
    state: State<'_, AppState>,
    input: StaffUserCreateInput,
) -> Result<UserDirectoryRow, String> {
    require_superadmin(&state)?;
    let username = input.username.trim().to_string();
    let display_name = input.display_name.trim().to_string();
    if username.is_empty() || display_name.is_empty() {
        return Err("Username and display name are required".to_string());
    }
    if input.password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }
    let role = input.role.trim().to_string();
    if role != "manager" && role != "vet" {
        return Err("Role must be manager or vet".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = ?1",
            params![username],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if dup > 0 {
        return Err("That username is already taken".to_string());
    }
    let id = Uuid::new_v4().to_string();
    let now = crate::sync::approx_server_now();
    let hash = bcrypt_hash(input.password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?6)",
        params![id, username, hash, display_name, role.clone(), now],
    )
    .map_err(|e| e.to_string())?;
    state.trigger_sync();
    Ok(UserDirectoryRow {
        id,
        username,
        display_name,
        role,
        created_at: now,
        active: true,
    })
}

#[tauri::command]
pub fn users_set_active(
    state: State<'_, AppState>,
    user_id: String,
    active: bool,
) -> Result<UserDirectoryRow, String> {
    let admin = require_superadmin(&state)?;
    if admin.id == user_id && !active {
        return Err("You cannot deactivate your own account".to_string());
    }
    let conn = db::get_conn(&state.pool)?;
    let n = conn
        .execute(
            "UPDATE users SET active = ?1, updated_at = ?3 WHERE id = ?2",
            params![if active { 1 } else { 0 }, user_id, crate::sync::approx_server_now()],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("User not found".to_string());
    }
    state.trigger_sync();
    conn.query_row(
        "SELECT id, username, display_name, role, created_at, COALESCE(active, 1) FROM users WHERE id = ?1",
        params![user_id],
        |r| {
            Ok(UserDirectoryRow {
                id: r.get(0)?,
                username: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
                created_at: r.get(4)?,
                active: r.get::<_, i64>(5)? != 0,
            })
        },
    )
    .map_err(|_| "User not found".to_string())
}

#[tauri::command]
pub fn sync_db(state: State<'_, AppState>) {
    state.trigger_sync();
}

/// Full catch-up: re-queue every local row and clear the pull cursor so this device
/// uploads anything stranded locally and re-downloads everything from MongoDB.
#[tauri::command]
pub fn sync_force_catchup(state: State<'_, AppState>) -> Result<String, String> {
    require_login(&state)?;
    let conn = db::get_conn(&state.pool)?;
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
    state.trigger_sync();
    Ok("Full sync started — uploading local data and downloading all cloud records".to_string())
}





// use crate::db::{self, DbPool};
// use bcrypt::{hash as bcrypt_hash, verify};
// use chrono::Datelike;
// use rusqlite::params;
// use serde::{Deserialize, Serialize};
// use std::sync::Mutex;
// use tauri::State;
// use uuid::Uuid;

// #[derive(Clone, Serialize)]
// pub struct SessionUser {
//     pub id: String,
//     pub username: String,
//     pub display_name: String,
//     pub role: String,
// }

// pub struct AppState {
//     pub pool: DbPool,
//     pub session: Mutex<Option<SessionUser>>,
//     pub sync_trigger: tokio::sync::mpsc::Sender<()>,
// }

// impl AppState {
//     pub fn trigger_sync(&self) {
//         let _ = self.sync_trigger.try_send(());
//     }
// }


// fn require_login(state: &AppState) -> Result<SessionUser, String> {
//     state
//         .session
//         .lock()
//         .map_err(|_| "lock error".to_string())?
//         .clone()
//         .ok_or_else(|| "Not signed in".to_string())
// }

// fn require_clinic_access(state: &AppState) -> Result<SessionUser, String> {
//     let user = require_login(state)?;
//     if user.role != "superadmin" && user.role != "manager" && user.role != "vet" {
//         return Err("Forbidden".to_string());
//     }
//     Ok(user)
// }

// fn update_pet_weight(conn: &rusqlite::Connection, pet_id: &str, weight: &Option<String>) -> Result<(), String> {
//     if let Some(w) = weight {
//         let w = w.trim();
//         if !w.is_empty() {
//             conn.execute(
//                 "UPDATE pets SET weight = ?1, updated_at = ?2 WHERE id = ?3",
//                 params![w, crate::sync::approx_server_now(), pet_id],
//             )
//             .map_err(|e| e.to_string())?;
//         }
//     }
//     Ok(())
// }

// #[derive(Deserialize)]
// pub struct LoginInput {
//     pub username: String,
//     pub password: String,
// }

// #[tauri::command]
// pub fn auth_login(state: State<'_, AppState>, input: LoginInput) -> Result<SessionUser, String> {
//     let conn = db::get_conn(&state.pool)?;
//     let row: Result<(String, String, String, String, String, i64), rusqlite::Error> = conn.query_row(
//         "SELECT id, username, password_hash, display_name, role, COALESCE(active, 1) FROM users WHERE username = ?1",
//         params![input.username.trim()],
//         |r| {
//             Ok((
//                 r.get(0)?,
//                 r.get(1)?,
//                 r.get(2)?,
//                 r.get(3)?,
//                 r.get(4)?,
//                 r.get(5)?,
//             ))
//         },
//     );
//     let (id, username, hash, display_name, role, active_i) =
//         row.map_err(|_| "Invalid username or password".to_string())?;
//     if active_i == 0 {
//         return Err("This account has been deactivated".to_string());
//     }
//     if !verify(input.password, &hash).unwrap_or(false) {
//         return Err("Invalid username or password".to_string());
//     }
//     let user = SessionUser {
//         id,
//         username,
//         display_name,
//         role,
//     };
//     *state.session.lock().map_err(|_| "lock")? = Some(user.clone());
//     Ok(user)
// }

// #[tauri::command]
// pub fn auth_logout(state: State<'_, AppState>) -> Result<(), String> {
//     *state.session.lock().map_err(|_| "lock")? = None;
//     Ok(())
// }

// #[tauri::command]
// pub fn auth_session(state: State<'_, AppState>) -> Result<Option<SessionUser>, String> {
//     Ok(state.session.lock().map_err(|_| "lock")?.clone())
// }

// #[derive(Serialize)]
// pub struct PetRow {
//     pub id: String,
//     pub card_id: String,
//     pub name: String,
//     pub species: Option<String>,
//     pub breed: Option<String>,
//     pub age: Option<String>,
//     pub date_of_birth: Option<String>,
//     pub sex: Option<String>,
//     pub weight: Option<String>,
//     pub vaccine_status: Option<String>,
//     pub deworming_status: Option<String>,
//     pub owner_name: Option<String>,
//     pub owner_phone: Option<String>,
//     pub owner_address: Option<String>,
//     pub owner_email: Option<String>,
//     pub notes: Option<String>,
//     pub created_at: String,
//     pub updated_at: String,
// }

// #[derive(Serialize)]
// pub struct PetListRow {
//     pub id: String,
//     pub card_id: String,
//     pub name: String,
//     pub species: Option<String>,
//     pub breed: Option<String>,
//     pub age: Option<String>,
//     pub date_of_birth: Option<String>,
//     pub sex: Option<String>,
//     pub weight: Option<String>,
//     pub vaccine_status: Option<String>,
//     pub deworming_status: Option<String>,
//     pub owner_name: Option<String>,
//     pub owner_phone: Option<String>,
//     pub owner_address: Option<String>,
//     pub owner_email: Option<String>,
//     pub notes: Option<String>,
//     pub created_at: String,
//     pub updated_at: String,
//     pub medical_count: i64,
//     pub grooming_count: i64,
// }

// #[derive(Deserialize)]
// pub struct PetInput {
//     pub name: String,
//     pub species: Option<String>,
//     pub breed: Option<String>,
//     pub age: Option<String>,
//     #[serde(default)]
//     pub date_of_birth: Option<String>,
//     pub sex: Option<String>,
//     pub weight: Option<String>,
//     pub vaccine_status: Option<String>,
//     pub deworming_status: Option<String>,
//     pub owner_name: Option<String>,
//     pub owner_phone: Option<String>,
//     pub owner_address: Option<String>,
//     pub owner_email: Option<String>,
//     pub notes: Option<String>,
// }

// fn next_pet_card_id(conn: &rusqlite::Connection) -> Result<String, String> {
//     for _ in 0..10 {
//         let raw = Uuid::new_v4().simple().to_string();
//         let card_id = format!("PET-{}", raw[..10].to_uppercase());
//         let exists: i64 = conn
//             .query_row(
//                 "SELECT COUNT(*) FROM pets WHERE card_id = ?1",
//                 params![card_id],
//                 |r| r.get(0),
//             )
//             .map_err(|e| e.to_string())?;
//         if exists == 0 {
//             return Ok(card_id);
//         }
//     }
//     Err("Could not generate a unique pet card id".to_string())
// }

// #[tauri::command]
// pub fn pets_list(state: State<'_, AppState>, query: Option<String>) -> Result<Vec<PetListRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut sql = "SELECT p.id, p.card_id, p.name, p.species, p.breed, p.age, p.date_of_birth, p.sex, p.weight, p.vaccine_status, p.deworming_status, p.owner_name, p.owner_phone, p.owner_address, p.owner_email, p.notes, p.created_at, p.updated_at, \
//              (SELECT COUNT(*) FROM medical_history_entries m WHERE m.pet_id = p.id), \
//              (SELECT COUNT(*) FROM grooming_events g WHERE g.pet_id = p.id) \
//              FROM pets p".to_string();
//     let q = query.unwrap_or_default().trim().to_string();
//     let mut params_vec: Vec<String> = Vec::new();
//     if !q.is_empty() {
//         sql.push_str(" WHERE p.name LIKE ?1 OR p.owner_name LIKE ?1 OR p.owner_phone LIKE ?1");
//         params_vec.push(format!("%{}%", q));
//     }
//     sql.push_str(" ORDER BY p.name COLLATE NOCASE");
//     let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
//     let mut map_row = |r: &rusqlite::Row<'_>| -> Result<PetListRow, rusqlite::Error> {
//         Ok(PetListRow {
//             id: r.get(0)?,
//             card_id: r.get(1)?,
//             name: r.get(2)?,
//             species: r.get(3)?,
//             breed: r.get(4)?,
//             age: r.get(5)?,
//             date_of_birth: r.get(6)?,
//             sex: r.get(7)?,
//             weight: r.get(8)?,
//             vaccine_status: r.get(9)?,
//             deworming_status: r.get(10)?,
//             owner_name: r.get(11)?,
//             owner_phone: r.get(12)?,
//             owner_address: r.get(13)?,
//             owner_email: r.get(14)?,
//             notes: r.get(15)?,
//             created_at: r.get(16)?,
//             updated_at: r.get(17)?,
//             medical_count: r.get(18)?,
//             grooming_count: r.get(19)?,
//         })
//     };
//     let mut out = Vec::new();
//     if params_vec.is_empty() {
//         let rows = stmt.query_map([], &mut map_row).map_err(|e| e.to_string())?;
//         for row in rows {
//             out.push(row.map_err(|e| e.to_string())?);
//         }
//     } else {
//         let rows = stmt
//             .query_map(params![params_vec[0]], &mut map_row)
//             .map_err(|e| e.to_string())?;
//         for row in rows {
//             out.push(row.map_err(|e| e.to_string())?);
//         }
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn pets_get(state: State<'_, AppState>, id: String) -> Result<PetRow, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(PetRow {
//                 id: r.get(0)?,
//                 card_id: r.get(1)?,
//                 name: r.get(2)?,
//                 species: r.get(3)?,
//                 breed: r.get(4)?,
//                 age: r.get(5)?,
//                 date_of_birth: r.get(6)?,
//                 sex: r.get(7)?,
//                 weight: r.get(8)?,
//                 vaccine_status: r.get(9)?,
//                 deworming_status: r.get(10)?,
//                 owner_name: r.get(11)?,
//                 owner_phone: r.get(12)?,
//                 owner_address: r.get(13)?,
//                 owner_email: r.get(14)?,
//                 notes: r.get(15)?,
//                 created_at: r.get(16)?,
//                 updated_at: r.get(17)?,
//             })
//         },
//     )
//     .map_err(|_| "Pet not found".to_string())
// }

// #[tauri::command]
// pub fn pets_create(state: State<'_, AppState>, input: PetInput) -> Result<PetRow, String> {
//     require_login(&state)?;
//     if input.name.trim().is_empty() {
//         return Err("Name is required".to_string());
//     }
//     if input.species.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Species is required".to_string());
//     }
//     if input.owner_name.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Owner name is required".to_string());
//     }
//     if input.owner_phone.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Owner phone is required".to_string());
//     }
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     let conn = db::get_conn(&state.pool)?;
//     let card_id = next_pet_card_id(&conn)?;
//     conn.execute(
//         "INSERT INTO pets (id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
//         params![
//             id,
//             card_id,
//             input.name.trim(),
//             input.species,
//             input.breed,
//             input.age,
//             input.date_of_birth,
//             input.sex,
//             input.weight,
//             input.vaccine_status,
//             input.deworming_status,
//             input.owner_name,
//             input.owner_phone,
//             input.owner_address,
//             input.owner_email,
//             input.notes,
//             now,
//             now,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(PetRow {
//                 id: r.get(0)?,
//                 card_id: r.get(1)?,
//                 name: r.get(2)?,
//                 species: r.get(3)?,
//                 breed: r.get(4)?,
//                 age: r.get(5)?,
//                 date_of_birth: r.get(6)?,
//                 sex: r.get(7)?,
//                 weight: r.get(8)?,
//                 vaccine_status: r.get(9)?,
//                 deworming_status: r.get(10)?,
//                 owner_name: r.get(11)?,
//                 owner_phone: r.get(12)?,
//                 owner_address: r.get(13)?,
//                 owner_email: r.get(14)?,
//                 notes: r.get(15)?,
//                 created_at: r.get(16)?,
//                 updated_at: r.get(17)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn pets_update(state: State<'_, AppState>, id: String, input: PetInput) -> Result<PetRow, String> {
//     require_login(&state)?;
//     if input.name.trim().is_empty() {
//         return Err("Name is required".to_string());
//     }
//     if input.species.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Species is required".to_string());
//     }
//     if input.owner_name.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Owner name is required".to_string());
//     }
//     if input.owner_phone.clone().unwrap_or_default().trim().is_empty() {
//         return Err("Owner phone is required".to_string());
//     }
//     let now = crate::sync::approx_server_now();
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn.execute(
//         "UPDATE pets SET name = ?2, species = ?3, breed = ?4, age = ?5, date_of_birth = ?6, sex = ?7, weight = ?8, vaccine_status = ?9, deworming_status = ?10, owner_name = ?11, owner_phone = ?12, owner_address = ?13, owner_email = ?14, notes = ?15, updated_at = ?16 WHERE id = ?1",
//         params![
//             id,
//             input.name.trim(),
//             input.species,
//             input.breed,
//             input.age,
//             input.date_of_birth,
//             input.sex,
//             input.weight,
//             input.vaccine_status,
//             input.deworming_status,
//             input.owner_name,
//             input.owner_phone,
//             input.owner_address,
//             input.owner_email,
//             input.notes,
//             now,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Pet not found".to_string());
//     }
//     conn.query_row(
//         "SELECT id, card_id, name, species, breed, age, date_of_birth, sex, weight, vaccine_status, deworming_status, owner_name, owner_phone, owner_address, owner_email, notes, created_at, updated_at FROM pets WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(PetRow {
//                 id: r.get(0)?,
//                 card_id: r.get(1)?,
//                 name: r.get(2)?,
//                 species: r.get(3)?,
//                 breed: r.get(4)?,
//                 age: r.get(5)?,
//                 date_of_birth: r.get(6)?,
//                 sex: r.get(7)?,
//                 weight: r.get(8)?,
//                 vaccine_status: r.get(9)?,
//                 deworming_status: r.get(10)?,
//                 owner_name: r.get(11)?,
//                 owner_phone: r.get(12)?,
//                 owner_address: r.get(13)?,
//                 owner_email: r.get(14)?,
//                 notes: r.get(15)?,
//                 created_at: r.get(16)?,
//                 updated_at: r.get(17)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn pets_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute("DELETE FROM pets WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct MedicalRow {
//     pub id: String,
//     pub pet_id: String,
//     pub entry_type: String,
//     pub title: Option<String>,
//     pub body: Option<String>,
//     pub dx_items: Vec<String>,
//     pub ddx_items: Vec<String>,
//     pub dx_note: Option<String>,
//     pub ddx_note: Option<String>,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub external_file_path: Option<String>,
//     pub external_file_paths: Vec<String>,
//     pub lab_result_id: Option<String>,
//     pub created_at: String,
//     pub body_weight: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct MedicalInput {
//     pub entry_type: String,
//     pub title: Option<String>,
//     pub body: Option<String>,
//     #[serde(default)]
//     pub dx_items: Option<Vec<String>>,
//     #[serde(default)]
//     pub ddx_items: Option<Vec<String>>,
//     pub dx_note: Option<String>,
//     pub ddx_note: Option<String>,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub external_file_path: Option<String>,
//     #[serde(default)]
//     pub external_file_paths: Option<Vec<String>>,
//     pub body_weight: Option<String>,
// }

// fn medical_items_json(items: &Option<Vec<String>>) -> String {
//     let v: Vec<String> = items
//         .as_ref()
//         .map(|list| {
//             list.iter()
//                 .map(|s| s.trim().to_string())
//                 .filter(|s| !s.is_empty())
//                 .collect()
//         })
//         .unwrap_or_default();
//     serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string())
// }

// fn map_medical_sql_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MedicalRow> {
//     let dx_raw: Option<String> = r.get(5)?;
//     let ddx_raw: Option<String> = r.get(6)?;
//     let paths_raw: Option<String> = r.get(15)?;
//     Ok(MedicalRow {
//         id: r.get(0)?,
//         pet_id: r.get(1)?,
//         entry_type: r.get(2)?,
//         title: r.get(3)?,
//         body: r.get(4)?,
//         dx_items: parse_string_array_json(dx_raw),
//         ddx_items: parse_string_array_json(ddx_raw),
//         dx_note: r.get(7)?,
//         ddx_note: r.get(8)?,
//         administered_date: r.get(9)?,
//         next_due_date: r.get(10)?,
//         reminder_days_before: r.get(11)?,
//         external_file_path: r.get(12)?,
//         lab_result_id: r.get(13)?,
//         created_at: r.get(14)?,
//         external_file_paths: parse_string_array_json(paths_raw),
//         body_weight: r.get(16)?,
//     })
// }

// #[tauri::command]
// pub fn medical_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<MedicalRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE pet_id = ?1 ORDER BY created_at DESC")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![pet_id], |r| map_medical_sql_row(r))
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn medical_add(state: State<'_, AppState>, pet_id: String, input: MedicalInput) -> Result<MedicalRow, String> {
//     require_login(&state)?;
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     let dx_j = medical_items_json(&input.dx_items);
//     let ddx_j = medical_items_json(&input.ddx_items);
//     let paths_j = medical_items_json(&input.external_file_paths);
//     let mut conn = db::get_conn(&state.pool)?;
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     tx.execute(
//         "INSERT INTO medical_history_entries (id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14, ?15, ?16)",
//         params![
//             id,
//             pet_id,
//             input.entry_type,
//             input.title,
//             input.body,
//             dx_j,
//             ddx_j,
//             input.dx_note,
//             input.ddx_note,
//             input.administered_date,
//             input.next_due_date,
//             input.reminder_days_before,
//             input.external_file_path,
//             now,
//             paths_j,
//             input.body_weight,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE id = ?1",
//         params![id],
//         |r| map_medical_sql_row(r),
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn medical_update(
//     state: State<'_, AppState>,
//     pet_id: String,
//     entry_id: String,
//     input: MedicalInput,
// ) -> Result<MedicalRow, String> {
//     require_login(&state)?;
//     let mut conn = db::get_conn(&state.pool)?;
//     let (lab_rid, _etype): (Option<String>, String) = conn
//         .query_row(
//             "SELECT lab_result_id, entry_type FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
//             params![entry_id, pet_id],
//             |r| Ok((r.get(0)?, r.get(1)?)),
//         )
//         .map_err(|_| "Medical entry not found".to_string())?;
//     let entry_type = if lab_rid.is_some() {
//         "lab_report".to_string()
//     } else {
//         input.entry_type
//     };
//     let dx_j = medical_items_json(&input.dx_items);
//     let ddx_j = medical_items_json(&input.ddx_items);
//     let paths_j = medical_items_json(&input.external_file_paths);
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     tx.execute(
//         "UPDATE medical_history_entries SET entry_type = ?1, title = ?2, body = ?3, dx_items = ?4, ddx_items = ?5, dx_note = ?6, ddx_note = ?7, administered_date = ?8, next_due_date = ?9, reminder_days_before = ?10, external_file_path = ?11, external_file_paths = ?12, body_weight = ?13 WHERE id = ?14 AND pet_id = ?15",
//         params![
//             entry_type,
//             input.title,
//             input.body,
//             dx_j,
//             ddx_j,
//             input.dx_note,
//             input.ddx_note,
//             input.administered_date,
//             input.next_due_date,
//             input.reminder_days_before,
//             input.external_file_path,
//             paths_j,
//             input.body_weight,
//             entry_id,
//             pet_id,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, administered_date, next_due_date, reminder_days_before, external_file_path, lab_result_id, created_at, external_file_paths, body_weight FROM medical_history_entries WHERE id = ?1",
//         params![entry_id],
//         |r| map_medical_sql_row(r),
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn medical_delete(state: State<'_, AppState>, pet_id: String, entry_id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let mut conn = db::get_conn(&state.pool)?;
//     let lab_rid: Option<String> = conn
//         .query_row(
//             "SELECT lab_result_id FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
//             params![entry_id, pet_id],
//             |r| r.get(0),
//         )
//         .map_err(|_| "Medical entry not found".to_string())?;
//     let tx = conn
//         .transaction()
//         .map_err(|e| e.to_string())?;
//     if let Some(ref lrid) = lab_rid {
//         let lo_id: String = tx
//             .query_row(
//                 "SELECT lab_order_id FROM lab_results WHERE id = ?1",
//                 params![lrid],
//                 |r| r.get(0),
//             )
//             .map_err(|e| e.to_string())?;
//         tx.execute(
//             "DELETE FROM lab_result_values WHERE lab_result_id = ?1",
//             params![lrid],
//         )
//         .map_err(|e| e.to_string())?;
//         tx.execute("DELETE FROM lab_results WHERE id = ?1", params![lrid])
//             .map_err(|e| e.to_string())?;
//         tx.execute(
//             "UPDATE lab_orders SET status = 'pending' WHERE id = ?1",
//             params![lo_id],
//         )
//         .map_err(|e| e.to_string())?;
//     }
//     let n = tx
//         .execute(
//             "DELETE FROM medical_history_entries WHERE id = ?1 AND pet_id = ?2",
//             params![entry_id, pet_id],
//         )
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Medical entry not found".to_string());
//     }
//     tx.commit().map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct VaccinationRow {
//     pub id: String,
//     pub pet_id: String,
//     pub vaccine_name: String,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub notes: Option<String>,
//     pub created_at: String,
//     pub body_weight: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct VaccinationInput {
//     pub vaccine_name: String,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub notes: Option<String>,
//     pub body_weight: Option<String>,
// }

// #[tauri::command]
// pub fn vaccinations_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<VaccinationRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE pet_id = ?1 ORDER BY next_due_date ASC NULLS LAST")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![pet_id], |r| {
//             Ok(VaccinationRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 vaccine_name: r.get(2)?,
//                 administered_date: r.get(3)?,
//                 next_due_date: r.get(4)?,
//                 reminder_days_before: r.get(5)?,
//                 notes: r.get(6)?,
//                 created_at: r.get(7)?,
//                 body_weight: r.get(8)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn vaccinations_upsert(
//     state: State<'_, AppState>,
//     id: Option<String>,
//     pet_id: String,
//     input: VaccinationInput,
// ) -> Result<VaccinationRow, String> {
//     require_login(&state)?;
//     let mut conn = db::get_conn(&state.pool)?;
//     let now = crate::sync::approx_server_now();
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     if let Some(ref eid) = id {
//         tx.execute(
//             "UPDATE vaccinations SET vaccine_name = ?2, administered_date = ?3, next_due_date = ?4, reminder_days_before = ?5, notes = ?6, body_weight = ?8 WHERE id = ?1 AND pet_id = ?7",
//             params![
//                 eid,
//                 input.vaccine_name,
//                 input.administered_date,
//                 input.next_due_date,
//                 input.reminder_days_before,
//                 input.notes,
//                 pet_id,
//                 input.body_weight,
//             ],
//         )
//         .map_err(|e| e.to_string())?;
//         update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//         tx.commit().map_err(|e| e.to_string())?;
//         let conn = db::get_conn(&state.pool)?;
//         return conn
//             .query_row(
//                 "SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE id = ?1",
//                 params![eid],
//                 |r| {
//                     Ok(VaccinationRow {
//                         id: r.get(0)?,
//                         pet_id: r.get(1)?,
//                         vaccine_name: r.get(2)?,
//                         administered_date: r.get(3)?,
//                         next_due_date: r.get(4)?,
//                         reminder_days_before: r.get(5)?,
//                         notes: r.get(6)?,
//                         created_at: r.get(7)?,
//                         body_weight: r.get(8)?,
//                     })
//                 },
//             )
//             .map_err(|e| e.to_string());
//     }
//     let nid = Uuid::new_v4().to_string();
//     tx.execute(
//         "INSERT INTO vaccinations (id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
//         params![
//             nid,
//             pet_id,
//             input.vaccine_name,
//             input.administered_date,
//             input.next_due_date,
//             input.reminder_days_before,
//             input.notes,
//             now,
//             input.body_weight,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, pet_id, vaccine_name, administered_date, next_due_date, reminder_days_before, notes, created_at, body_weight FROM vaccinations WHERE id = ?1",
//         params![nid],
//         |r| {
//             Ok(VaccinationRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 vaccine_name: r.get(2)?,
//                 administered_date: r.get(3)?,
//                 next_due_date: r.get(4)?,
//                 reminder_days_before: r.get(5)?,
//                 notes: r.get(6)?,
//                 created_at: r.get(7)?,
//                 body_weight: r.get(8)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn vaccinations_delete(
//     state: State<'_, AppState>,
//     pet_id: String,
//     vaccination_id: String,
// ) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn
//         .execute(
//             "DELETE FROM vaccinations WHERE id = ?1 AND pet_id = ?2",
//             params![vaccination_id, pet_id],
//         )
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Vaccination entry not found".to_string());
//     }
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct HospitalizationRow {
//     pub id: String,
//     pub pet_id: String,
//     pub cage_number: String,
//     pub check_in_date: String,
//     pub check_out_date: Option<String>,
//     pub created_at: String,
// }

// #[derive(Deserialize)]
// pub struct HospitalizationInput {
//     pub pet_id: String,
//     pub cage_number: String,
//     pub check_in_date: String,
//     pub check_out_date: Option<String>,
// }

// #[tauri::command]
// pub fn hospitalizations_list(state: State<'_, AppState>) -> Result<Vec<HospitalizationRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at FROM hospitalizations ORDER BY check_in_date DESC")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok(HospitalizationRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 cage_number: r.get(2)?,
//                 check_in_date: r.get(3)?,
//                 check_out_date: r.get(4)?,
//                 created_at: r.get(5)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn hospitalizations_upsert(
//     state: State<'_, AppState>,
//     input: HospitalizationInput,
//     id: Option<String>,
// ) -> Result<HospitalizationRow, String> {
//     require_login(&state)?;
//     if input.pet_id.trim().is_empty() || input.cage_number.trim().is_empty() || input.check_in_date.trim().is_empty() {
//         return Err("pet_id, cage_number and check_in_date are required".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     if let Some(eid) = id {
//         let n = conn
//             .execute(
//                 "UPDATE hospitalizations SET pet_id = ?2, cage_number = ?3, check_in_date = ?4, check_out_date = ?5 WHERE id = ?1",
//                 params![eid, input.pet_id, input.cage_number.trim(), input.check_in_date, input.check_out_date],
//             )
//             .map_err(|e| e.to_string())?;
//         if n == 0 {
//             return Err("Hospitalization not found".to_string());
//         }
//         return conn
//             .query_row(
//                 "SELECT id, pet_id, cage_number, check_in_date, check_out_date, created_at FROM hospitalizations WHERE id = ?1",
//                 params![eid],
//                 |r| {
//                     Ok(HospitalizationRow {
//                         id: r.get(0)?,
//                         pet_id: r.get(1)?,
//                         cage_number: r.get(2)?,
//                         check_in_date: r.get(3)?,
//                         check_out_date: r.get(4)?,
//                         created_at: r.get(5)?,
//                     })
//                 },
//             )
//             .map_err(|e| e.to_string());
//     }
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "INSERT INTO hospitalizations (id, pet_id, cage_number, check_in_date, check_out_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
//         params![id, input.pet_id, input.cage_number.trim(), input.check_in_date, input.check_out_date, now],
//     )
//     .map_err(|e| e.to_string())?;
//     Ok(HospitalizationRow {
//         id,
//         pet_id: input.pet_id,
//         cage_number: input.cage_number.trim().to_string(),
//         check_in_date: input.check_in_date,
//         check_out_date: input.check_out_date,
//         created_at: now,
//     })
// }

// #[tauri::command]
// pub fn hospitalizations_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn
//         .execute("DELETE FROM hospitalizations WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Hospitalization not found".to_string());
//     }
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct ClinicRow {
//     pub id: String,
//     pub name: String,
//     pub email: String,
//     pub address: String,
//     pub phone: String,
//     pub timing: String,
//     pub created_at: String,
//     pub updated_at: String,
//     pub logo: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct ClinicInput {
//     pub name: String,
//     pub email: String,
//     pub address: String,
//     pub phone: String,
//     pub timing: String,
//     pub logo: Option<String>,
// }

// const GLOBAL_CLINIC_ID: &str = "global";

// #[tauri::command]
// pub fn clinic_get(state: State<'_, AppState>) -> Result<ClinicRow, String> {
//     let conn = db::get_conn(&state.pool)?;
//     let existing = conn
//         .query_row(
//             "SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1",
//             params![GLOBAL_CLINIC_ID],
//             |r| {
//                 Ok(ClinicRow {
//                     id: r.get(0)?,
//                     name: r.get(1)?,
//                     email: r.get(2)?,
//                     address: r.get(3)?,
//                     phone: r.get(4)?,
//                     timing: r.get(5)?,
//                     created_at: r.get(6)?,
//                     updated_at: r.get(7)?,
//                     logo: r.get(8)?,
//                 })
//             },
//         )
//         .ok();
//     if let Some(row) = existing {
//         return Ok(row);
//     }
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "INSERT INTO clinics (id, name, email, address, phone, timing, created_at, updated_at, logo) VALUES (?1, '', '', '', '', '', ?2, ?3, NULL)",
//         params![GLOBAL_CLINIC_ID, now, now],
//     )
//     .map_err(|e| e.to_string())?;
//     Ok(ClinicRow {
//         id: GLOBAL_CLINIC_ID.to_string(),
//         name: "".to_string(),
//         email: "".to_string(),
//         address: "".to_string(),
//         phone: "".to_string(),
//         timing: "".to_string(),
//         created_at: now.clone(),
//         updated_at: now,
//         logo: None,
//     })
// }

// #[tauri::command]
// pub fn clinic_update(state: State<'_, AppState>, input: ClinicInput) -> Result<ClinicRow, String> {
//     require_superadmin(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "INSERT INTO clinics (id, name, email, address, phone, timing, created_at, updated_at, logo)
//          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
//          ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, address = excluded.address, phone = excluded.phone, timing = excluded.timing, updated_at = excluded.updated_at, logo = excluded.logo",
//         params![
//             GLOBAL_CLINIC_ID,
//             input.name.trim(),
//             input.email.trim(),
//             input.address.trim(),
//             input.phone.trim(),
//             input.timing.trim(),
//             now,
//             input.logo,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, name, email, address, phone, timing, created_at, updated_at, logo FROM clinics WHERE id = ?1",
//         params![GLOBAL_CLINIC_ID],
//         |r| {
//             Ok(ClinicRow {
//                 id: r.get(0)?,
//                 name: r.get(1)?,
//                 email: r.get(2)?,
//                 address: r.get(3)?,
//                 phone: r.get(4)?,
//                 timing: r.get(5)?,
//                 created_at: r.get(6)?,
//                 updated_at: r.get(7)?,
//                 logo: r.get(8)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[derive(Serialize)]
// pub struct GroomingRow {
//     pub id: String,
//     pub pet_id: String,
//     pub service_type: String,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub performed_date: String,
//     pub notes: Option<String>,
//     pub created_at: String,
//     pub body_weight: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct GroomingInput {
//     pub service_type: String,
//     pub administered_date: Option<String>,
//     pub next_due_date: Option<String>,
//     pub reminder_days_before: Option<i64>,
//     pub performed_date: String,
//     pub notes: Option<String>,
//     pub body_weight: Option<String>,
// }

// #[tauri::command]
// pub fn grooming_list(state: State<'_, AppState>, pet_id: String) -> Result<Vec<GroomingRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE pet_id = ?1 ORDER BY performed_date DESC")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![pet_id], |r| {
//             Ok(GroomingRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 service_type: r.get(2)?,
//                 administered_date: r.get(3)?,
//                 next_due_date: r.get(4)?,
//                 reminder_days_before: r.get(5)?,
//                 performed_date: r.get(6)?,
//                 notes: r.get(7)?,
//                 created_at: r.get(8)?,
//                 body_weight: r.get(9)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn grooming_add(state: State<'_, AppState>, pet_id: String, input: GroomingInput) -> Result<GroomingRow, String> {
//     require_login(&state)?;
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     let mut conn = db::get_conn(&state.pool)?;
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     tx.execute(
//         "INSERT INTO grooming_events (id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
//         params![id, pet_id, input.service_type, input.administered_date, input.next_due_date, input.reminder_days_before, input.performed_date, input.notes, now, input.body_weight],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(GroomingRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 service_type: r.get(2)?,
//                 administered_date: r.get(3)?,
//                 next_due_date: r.get(4)?,
//                 reminder_days_before: r.get(5)?,
//                 performed_date: r.get(6)?,
//                 notes: r.get(7)?,
//                 created_at: r.get(8)?,
//                 body_weight: r.get(9)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn grooming_update(
//     state: State<'_, AppState>,
//     pet_id: String,
//     grooming_id: String,
//     input: GroomingInput,
// ) -> Result<GroomingRow, String> {
//     require_login(&state)?;
//     let mut conn = db::get_conn(&state.pool)?;
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     tx.execute(
//         "UPDATE grooming_events SET service_type = ?1, administered_date = ?2, next_due_date = ?3, reminder_days_before = ?4, performed_date = ?5, notes = ?6, body_weight = ?9 WHERE id = ?7 AND pet_id = ?8",
//         params![
//             input.service_type,
//             input.administered_date,
//             input.next_due_date,
//             input.reminder_days_before,
//             input.performed_date,
//             input.notes,
//             grooming_id,
//             pet_id,
//             input.body_weight,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &pet_id, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id, pet_id, service_type, administered_date, next_due_date, reminder_days_before, performed_date, notes, created_at, body_weight FROM grooming_events WHERE id = ?1",
//         params![grooming_id],
//         |r| {
//             Ok(GroomingRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 service_type: r.get(2)?,
//                 administered_date: r.get(3)?,
//                 next_due_date: r.get(4)?,
//                 reminder_days_before: r.get(5)?,
//                 performed_date: r.get(6)?,
//                 notes: r.get(7)?,
//                 created_at: r.get(8)?,
//                 body_weight: r.get(9)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn grooming_delete(state: State<'_, AppState>, pet_id: String, grooming_id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn.execute(
//         "DELETE FROM grooming_events WHERE id = ?1 AND pet_id = ?2",
//         params![grooming_id, pet_id],
//     )
//     .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Grooming entry not found".to_string());
//     }
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct LabTestRow {
//     pub id: String,
//     pub name: String,
//     pub code: Option<String>,
//     pub default_report_hours: Option<i64>,
//     pub active: i64,
//     pub created_at: String,
// }

// #[derive(Deserialize)]
// pub struct LabTestInput {
//     pub name: String,
//     pub code: Option<String>,
//     pub default_report_hours: Option<i64>,
// }

// #[tauri::command]
// pub fn lab_tests_list(state: State<'_, AppState>) -> Result<Vec<LabTestRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE active = 1 ORDER BY name COLLATE NOCASE")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok(LabTestRow {
//                 id: r.get(0)?,
//                 name: r.get(1)?,
//                 code: r.get(2)?,
//                 default_report_hours: r.get(3)?,
//                 active: r.get(4)?,
//                 created_at: r.get(5)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn lab_tests_list_all(state: State<'_, AppState>) -> Result<Vec<LabTestRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests ORDER BY name COLLATE NOCASE")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok(LabTestRow {
//                 id: r.get(0)?,
//                 name: r.get(1)?,
//                 code: r.get(2)?,
//                 default_report_hours: r.get(3)?,
//                 active: r.get(4)?,
//                 created_at: r.get(5)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn lab_test_create(state: State<'_, AppState>, input: LabTestInput) -> Result<LabTestRow, String> {
//     require_login(&state)?;
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute(
//         "INSERT INTO lab_tests (id, name, code, default_report_hours, active, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
//         params![id, input.name, input.code, input.default_report_hours, now],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(LabTestRow {
//                 id: r.get(0)?,
//                 name: r.get(1)?,
//                 code: r.get(2)?,
//                 default_report_hours: r.get(3)?,
//                 active: r.get(4)?,
//                 created_at: r.get(5)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn lab_test_update(state: State<'_, AppState>, id: String, input: LabTestInput) -> Result<LabTestRow, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute(
//         "UPDATE lab_tests SET name = ?2, code = ?3, default_report_hours = ?4 WHERE id = ?1",
//         params![id, input.name, input.code, input.default_report_hours],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, name, code, default_report_hours, active, created_at FROM lab_tests WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(LabTestRow {
//                 id: r.get(0)?,
//                 name: r.get(1)?,
//                 code: r.get(2)?,
//                 default_report_hours: r.get(3)?,
//                 active: r.get(4)?,
//                 created_at: r.get(5)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn lab_test_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute("UPDATE lab_tests SET active = 0 WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct AnalyteRow {
//     pub id: String,
//     pub lab_test_id: String,
//     pub name: String,
//     pub unit: Option<String>,
//     pub normal_min: Option<f64>,
//     pub normal_max: Option<f64>,
//     pub sort_order: i64,
//     pub remarks: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct AnalyteInput {
//     pub name: String,
//     pub unit: Option<String>,
//     pub normal_min: Option<f64>,
//     pub normal_max: Option<f64>,
//     pub sort_order: Option<i64>,
//     pub remarks: Option<String>,
// }

// #[tauri::command]
// pub fn lab_analytes_list(state: State<'_, AppState>, lab_test_id: String) -> Result<Vec<AnalyteRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE lab_test_id = ?1 ORDER BY sort_order, name")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![lab_test_id], |r| {
//             Ok(AnalyteRow {
//                 id: r.get(0)?,
//                 lab_test_id: r.get(1)?,
//                 name: r.get(2)?,
//                 unit: r.get(3)?,
//                 normal_min: r.get(4)?,
//                 normal_max: r.get(5)?,
//                 sort_order: r.get(6)?,
//                 remarks: r.get(7)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn lab_analyte_upsert(
//     state: State<'_, AppState>,
//     lab_test_id: String,
//     id: Option<String>,
//     input: AnalyteInput,
// ) -> Result<AnalyteRow, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let sort = input.sort_order.unwrap_or(0);
//     if let Some(ref eid) = id {
//         conn.execute(
//             "UPDATE lab_analytes SET name = ?2, unit = ?3, normal_min = ?4, normal_max = ?5, sort_order = ?6, remarks = ?8 WHERE id = ?1 AND lab_test_id = ?7",
//             params![
//                 eid,
//                 input.name,
//                 input.unit,
//                 input.normal_min,
//                 input.normal_max,
//                 sort,
//                 lab_test_id,
//                 input.remarks,
//             ],
//         )
//         .map_err(|e| e.to_string())?;
//         return conn
//             .query_row(
//                 "SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE id = ?1",
//                 params![eid],
//                 |r| {
//                     Ok(AnalyteRow {
//                         id: r.get(0)?,
//                         lab_test_id: r.get(1)?,
//                         name: r.get(2)?,
//                         unit: r.get(3)?,
//                         normal_min: r.get(4)?,
//                         normal_max: r.get(5)?,
//                         sort_order: r.get(6)?,
//                         remarks: r.get(7)?,
//                     })
//                 },
//             )
//             .map_err(|e| e.to_string());
//     }
//     let nid = Uuid::new_v4().to_string();
//     conn.execute(
//         "INSERT INTO lab_analytes (id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
//         params![
//             nid,
//             lab_test_id,
//             input.name,
//             input.unit,
//             input.normal_min,
//             input.normal_max,
//             sort,
//             input.remarks,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, lab_test_id, name, unit, normal_min, normal_max, sort_order, remarks FROM lab_analytes WHERE id = ?1",
//         params![nid],
//         |r| {
//             Ok(AnalyteRow {
//                 id: r.get(0)?,
//                 lab_test_id: r.get(1)?,
//                 name: r.get(2)?,
//                 unit: r.get(3)?,
//                 normal_min: r.get(4)?,
//                 normal_max: r.get(5)?,
//                 sort_order: r.get(6)?,
//                 remarks: r.get(7)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn lab_analyte_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute("DELETE FROM lab_analytes WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct LabOrderRow {
//     pub id: String,
//     pub pet_id: String,
//     pub lab_test_id: String,
//     pub receipt_number: Option<String>,
//     pub tentative_report_at: Option<String>,
//     pub status: String,
//     pub created_at: String,
//     pub lab_result_id: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct LabOrderInput {
//     pub pet_id: String,
//     pub lab_test_id: String,
//     pub tentative_report_at: Option<String>,
// }

// #[tauri::command]
// pub fn lab_order_create(state: State<'_, AppState>, input: LabOrderInput) -> Result<LabOrderRow, String> {
//     require_login(&state)?;
//     let id = Uuid::new_v4().to_string();
//     let receipt = format!("RCP-{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("0000"));
//     let now = crate::sync::approx_server_now();
//     let conn = db::get_conn(&state.pool)?;
//     conn.execute(
//         "INSERT INTO lab_orders (id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
//         params![
//             id,
//             input.pet_id,
//             input.lab_test_id,
//             receipt,
//             input.tentative_report_at,
//             now,
//         ],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, pet_id, lab_test_id, receipt_number, tentative_report_at, status, created_at FROM lab_orders WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(LabOrderRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 lab_test_id: r.get(2)?,
//                 receipt_number: r.get(3)?,
//                 tentative_report_at: r.get(4)?,
//                 status: r.get(5)?,
//                 created_at: r.get(6)?,
//                 lab_result_id: None,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn lab_orders_for_pet(state: State<'_, AppState>, pet_id: String) -> Result<Vec<LabOrderRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare("SELECT o.id, o.pet_id, o.lab_test_id, o.receipt_number, o.tentative_report_at, o.status, o.created_at, r.id FROM lab_orders o LEFT JOIN lab_results r ON r.lab_order_id = o.id WHERE o.pet_id = ?1 ORDER BY o.created_at DESC")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![pet_id], |r| {
//             Ok(LabOrderRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 lab_test_id: r.get(2)?,
//                 receipt_number: r.get(3)?,
//                 tentative_report_at: r.get(4)?,
//                 status: r.get(5)?,
//                 created_at: r.get(6)?,
//                 lab_result_id: r.get(7)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[derive(Deserialize)]
// pub struct LabResultValueInput {
//     pub analyte_id: String,
//     pub observed_value: String,
// }

// #[derive(Deserialize)]
// #[serde(rename_all = "camelCase")]
// pub struct LabResultValuePatch {
//     pub id: String,
//     pub observed_value: String,
// }

// #[derive(Serialize)]
// pub struct LabResultValueRow {
//     pub id: String,
//     pub analyte_name: String,
//     pub unit: Option<String>,
//     pub normal_min: Option<f64>,
//     pub normal_max: Option<f64>,
//     pub observed_value: String,
//     pub remarks: Option<String>,
// }

// #[derive(Serialize)]
// pub struct LabResultDetail {
//     pub id: String,
//     pub lab_order_id: String,
//     pub pet_id: String,
//     pub lab_test_id: String,
//     pub created_at: String,
//     pub notes: Option<String>,
//     pub values: Vec<LabResultValueRow>,
// }

// #[tauri::command]
// pub fn lab_result_save(
//     state: State<'_, AppState>,
//     lab_order_id: String,
//     values: Vec<LabResultValueInput>,
//     notes: Option<String>,
// ) -> Result<LabResultDetail, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let (pet_id, lab_test_id): (String, String) = conn
//         .query_row(
//             "SELECT pet_id, lab_test_id FROM lab_orders WHERE id = ?1",
//             params![lab_order_id],
//             |r| Ok((r.get(0)?, r.get(1)?)),
//         )
//         .map_err(|_| "Lab order not found".to_string())?;

//     let result_id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "INSERT INTO lab_results (id, lab_order_id, pet_id, lab_test_id, created_at, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
//         params![result_id, lab_order_id, pet_id, lab_test_id, now, notes],
//     )
//     .map_err(|e| e.to_string())?;

//     let mut value_rows: Vec<LabResultValueRow> = Vec::new();
//     for v in values {
//         let analyte: (String, Option<String>, Option<f64>, Option<f64>, Option<String>) = conn
//             .query_row(
//                 "SELECT name, unit, normal_min, normal_max, remarks FROM lab_analytes WHERE id = ?1 AND lab_test_id = ?2",
//                 params![v.analyte_id, lab_test_id],
//                 |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
//             )
//             .map_err(|_| "Unknown analyte for this test".to_string())?;
//         let vid = Uuid::new_v4().to_string();
//         conn.execute(
//             "INSERT INTO lab_result_values (id, lab_result_id, analyte_id, analyte_name, unit, normal_min, normal_max, observed_value, remarks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
//             params![
//                 vid,
//                 result_id,
//                 v.analyte_id,
//                 analyte.0,
//                 analyte.1,
//                 analyte.2,
//                 analyte.3,
//                 v.observed_value,
//                 analyte.4,
//             ],
//         )
//         .map_err(|e| e.to_string())?;
//         value_rows.push(LabResultValueRow {
//             id: vid,
//             analyte_name: analyte.0,
//             unit: analyte.1,
//             normal_min: analyte.2,
//             normal_max: analyte.3,
//             observed_value: v.observed_value,
//             remarks: analyte.4,
//         });
//     }

//     let med_id = Uuid::new_v4().to_string();
//     let title = format!("Laboratory report ({})", now);
//     conn.execute(
//         "INSERT INTO medical_history_entries (id, pet_id, entry_type, title, body, dx_items, ddx_items, dx_note, ddx_note, external_file_path, lab_result_id, created_at) VALUES (?1, ?2, 'lab_report', ?3, NULL, '[]', '[]', NULL, NULL, NULL, ?4, ?5)",
//         params![med_id, pet_id, title, result_id, now],
//     )
//     .map_err(|e| e.to_string())?;

//     conn.execute(
//         "UPDATE lab_orders SET status = 'completed' WHERE id = ?1",
//         params![lab_order_id],
//     )
//     .map_err(|e| e.to_string())?;

//     Ok(LabResultDetail {
//         id: result_id,
//         lab_order_id,
//         pet_id,
//         lab_test_id,
//         created_at: now,
//         notes,
//         values: value_rows,
//     })
// }

// #[tauri::command]
// pub fn lab_result_get(state: State<'_, AppState>, id: String) -> Result<LabResultDetail, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let head: (String, String, String, String, Option<String>) = conn
//         .query_row(
//             "SELECT id, lab_order_id, pet_id, lab_test_id, notes FROM lab_results WHERE id = ?1",
//             params![id],
//             |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
//         )
//         .map_err(|_| "Result not found".to_string())?;
//     let created_at: String = conn
//         .query_row(
//             "SELECT created_at FROM lab_results WHERE id = ?1",
//             params![id],
//             |r| r.get(0),
//         )
//         .map_err(|e| e.to_string())?;
//     let mut stmt = conn
//         .prepare("SELECT id, analyte_name, unit, normal_min, normal_max, observed_value, remarks FROM lab_result_values WHERE lab_result_id = ?1 ORDER BY analyte_name")
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map(params![head.0], |r| {
//             Ok(LabResultValueRow {
//                 id: r.get(0)?,
//                 analyte_name: r.get(1)?,
//                 unit: r.get(2)?,
//                 normal_min: r.get(3)?,
//                 normal_max: r.get(4)?,
//                 observed_value: r.get(5)?,
//                 remarks: r.get(6)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut vals = Vec::new();
//     for row in rows {
//         vals.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(LabResultDetail {
//         id: head.0,
//         lab_order_id: head.1,
//         pet_id: head.2,
//         lab_test_id: head.3,
//         created_at,
//         notes: head.4,
//         values: vals,
//     })
// }

// #[derive(Serialize)]
// pub struct LabResultSummaryRow {
//     pub id: String,
//     pub pet_id: String,
//     pub pet_name: String,
//     pub lab_test_id: String,
//     pub test_name: String,
//     pub created_at: String,
//     pub notes: Option<String>,
// }

// #[tauri::command]
// pub fn lab_results_history(state: State<'_, AppState>) -> Result<Vec<LabResultSummaryRow>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare(
//             "SELECT lr.id, lr.pet_id, p.name, lr.lab_test_id, lt.name, lr.created_at, lr.notes \
//              FROM lab_results lr \
//              INNER JOIN pets p ON p.id = lr.pet_id \
//              INNER JOIN lab_tests lt ON lt.id = lr.lab_test_id \
//              ORDER BY lr.created_at DESC",
//         )
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok(LabResultSummaryRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 pet_name: r.get(2)?,
//                 lab_test_id: r.get(3)?,
//                 test_name: r.get(4)?,
//                 created_at: r.get(5)?,
//                 notes: r.get(6)?,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn lab_results_for_history(
//     state: State<'_, AppState>,
//     pet_id: String,
//     lab_test_id: String,
// ) -> Result<Vec<LabResultDetail>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;

//     let mut stmt = conn
//         .prepare("SELECT id FROM lab_results WHERE pet_id = ?1 AND lab_test_id = ?2 ORDER BY created_at ASC")
//         .map_err(|e| e.to_string())?;

//     let ids = stmt
//         .query_map(params![pet_id, lab_test_id], |r| r.get::<_, String>(0))
//         .map_err(|e| e.to_string())?;

//     let mut out = Vec::new();
//     for id_res in ids {
//         let id = id_res.map_err(|e| e.to_string())?;

//         let head: (String, String, String, String, Option<String>, String) = conn
//             .query_row(
//                 "SELECT id, lab_order_id, pet_id, lab_test_id, notes, created_at FROM lab_results WHERE id = ?1",
//                 params![id],
//                 |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
//             )
//             .map_err(|e| e.to_string())?;

//         let mut val_stmt = conn
//             .prepare("SELECT id, analyte_name, unit, normal_min, normal_max, observed_value, remarks FROM lab_result_values WHERE lab_result_id = ?1 ORDER BY analyte_name")
//             .map_err(|e| e.to_string())?;

//         let val_rows = val_stmt
//             .query_map(params![head.0], |r| {
//                 Ok(LabResultValueRow {
//                     id: r.get(0)?,
//                     analyte_name: r.get(1)?,
//                     unit: r.get(2)?,
//                     normal_min: r.get(3)?,
//                     normal_max: r.get(4)?,
//                     observed_value: r.get(5)?,
//                     remarks: r.get(6)?,
//                 })
//             })
//             .map_err(|e| e.to_string())?;

//         let mut vals = Vec::new();
//         for row in val_rows {
//             vals.push(row.map_err(|e| e.to_string())?);
//         }

//         out.push(LabResultDetail {
//             id: head.0,
//             lab_order_id: head.1,
//             pet_id: head.2,
//             lab_test_id: head.3,
//             created_at: head.5,
//             notes: head.4,
//             values: vals,
//         });
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn lab_result_update(
//     state: State<'_, AppState>,
//     lab_result_id: String,
//     values: Vec<LabResultValuePatch>,
//     notes: Option<String>,
// ) -> Result<LabResultDetail, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT id FROM lab_results WHERE id = ?1",
//         params![lab_result_id],
//         |r| r.get::<_, String>(0),
//     )
//     .map_err(|_| "Lab result not found".to_string())?;
//     for p in &values {
//         let n = conn
//             .execute(
//                 "UPDATE lab_result_values SET observed_value = ?1 WHERE id = ?2 AND lab_result_id = ?3",
//                 params![p.observed_value, p.id, lab_result_id],
//             )
//             .map_err(|e| e.to_string())?;
//         if n == 0 {
//             return Err("Invalid result value row".to_string());
//         }
//     }
//     conn.execute(
//         "UPDATE lab_results SET notes = ?1 WHERE id = ?2",
//         params![notes, lab_result_id],
//     )
//     .map_err(|e| e.to_string())?;
//     drop(conn);
//     lab_result_get(state, lab_result_id)
// }

// #[derive(Serialize)]
// pub struct VaccinationReminder {
//     pub pet_id: String,
//     pub pet_name: String,
//     pub vaccine_name: String,
//     pub next_due_date: String,
//     pub days_until: i64,
// }

// #[tauri::command]
// pub fn dashboard_vaccination_reminders(state: State<'_, AppState>, within_days: i64) -> Result<Vec<VaccinationReminder>, String> {
//     require_login(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let today = chrono::Utc::now().date_naive();
//     let mut stmt = conn
//         .prepare(
//             "SELECT v.pet_id, p.name, v.vaccine_name, v.next_due_date FROM vaccinations v JOIN pets p ON p.id = v.pet_id WHERE v.next_due_date IS NOT NULL AND v.next_due_date != ''",
//         )
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok((
//                 r.get::<_, String>(0)?,
//                 r.get::<_, String>(1)?,
//                 r.get::<_, String>(2)?,
//                 r.get::<_, String>(3)?,
//             ))
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         let (pet_id, pet_name, vaccine_name, due_s) = row.map_err(|e| e.to_string())?;
//         let due = chrono::NaiveDate::parse_from_str(&due_s, "%Y-%m-%d").or_else(|_| {
//             chrono::DateTime::parse_from_rfc3339(&due_s)
//                 .map(|d| d.date_naive())
//         });
//         let due = match due {
//             Ok(d) => d,
//             Err(_) => continue,
//         };
//         let days_until = (due - today).num_days();
//         if days_until >= 0 && days_until <= within_days {
//             out.push(VaccinationReminder {
//                 pet_id,
//                 pet_name,
//                 vaccine_name,
//                 next_due_date: due_s,
//                 days_until,
//             });
//         }
//     }
//     out.sort_by_key(|v| v.days_until);
//     Ok(out)
// }

// #[derive(Serialize)]
// pub struct OpdRequestRow {
//     pub id: String,
//     pub pet_id: String,
//     pub pet_name: String,
//     pub pet_card_id: String,
//     pub species: Option<String>,
//     pub breed: Option<String>,
//     pub weight: Option<String>,
//     pub age: Option<String>,
//     pub date_of_birth: Option<String>,
//     pub sex: Option<String>,
//     pub owner_name: Option<String>,
//     pub owner_phone: Option<String>,
//     pub requested_by_user_id: String,
//     pub requested_by_name: String,
//     pub status: String,
//     pub assigned_vet_id: Option<String>,
//     pub assigned_vet_name: Option<String>,
//     pub created_at: String,
//     pub claimed_at: Option<String>,
//     pub completed_at: Option<String>,
// }

// #[derive(Serialize, Deserialize, Clone)]
// pub struct OpdMedicineRow {
//     pub name: String,
//     pub dosage: Option<String>,
//     pub direction_per_day: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct OpdMedicineInput {
//     pub name: String,
//     pub dosage: Option<String>,
//     pub direction_per_day: Option<String>,
// }

// #[derive(Serialize)]
// pub struct OpdConsultationRow {
//     pub id: String,
//     pub request_id: String,
//     pub pet_id: String,
//     pub pet_name: String,
//     pub pet_card_id: String,
//     pub species: Option<String>,
//     pub breed: Option<String>,
//     pub weight: Option<String>,
//     pub age: Option<String>,
//     pub date_of_birth: Option<String>,
//     pub sex: Option<String>,
//     pub owner_name: Option<String>,
//     pub owner_phone: Option<String>,
//     pub vet_id: String,
//     pub vet_name: String,
//     pub doctor_signature_name: String,
//     pub temperature: Option<String>,
//     pub physical_exam: Option<String>,
//     pub history_observations: Vec<String>,
//     pub dx_items: Vec<String>,
//     pub ddx_items: Vec<String>,
//     pub diagnosis_note: Option<String>,
//     pub differential_diagnosis_note: Option<String>,
//     pub symptoms: Vec<String>,
//     pub recommended_lab_test_ids: Vec<String>,
//     pub recommended_lab_test_names: Vec<String>,
//     pub custom_lab_tests: Vec<String>,
//     pub medicines: Vec<OpdMedicineRow>,
//     pub clinical_treatment_remark: Option<String>,
//     pub in_house_prescription: Option<String>,
//     pub recommended_food: Option<String>,
//     pub next_visit_at: Option<String>,
//     pub created_at: String,
//     pub body_weight: Option<String>,
// }

// #[derive(Deserialize)]
// pub struct OpdConsultationInput {
//     pub request_id: String,
//     pub temperature: Option<String>,
//     pub physical_exam: Option<String>,
//     pub history_observations: Option<Vec<String>>,
//     pub dx_items: Option<Vec<String>>,
//     pub ddx_items: Option<Vec<String>>,
//     pub diagnosis_note: Option<String>,
//     pub differential_diagnosis_note: Option<String>,
//     pub symptoms: Option<Vec<String>>,
//     pub recommended_lab_test_ids: Option<Vec<String>>,
//     pub custom_lab_tests: Option<Vec<String>>,
//     pub medicines: Option<Vec<OpdMedicineInput>>,
//     pub clinical_treatment_remark: Option<String>,
//     pub in_house_prescription: Option<String>,
//     pub recommended_food: Option<String>,
//     pub next_visit_at: Option<String>,
//     pub doctor_signature_name: String,
//     pub body_weight: Option<String>,
// }

// #[derive(Serialize)]
// pub struct OpdDashboardSummary {
//     pub checked_today: i64,
//     pub checked_week: i64,
//     pub checked_month: i64,
//     pub next_visits: Vec<OpdConsultationRow>,
// }

// #[derive(Serialize)]
// pub struct OpdCatalogItemRow {
//     pub id: String,
//     #[serde(rename = "type")]
//     pub item_type: String,
//     pub name: String,
//     pub active: bool,
//     pub created_at: String,
// }

// fn parse_string_array_json(raw: Option<String>) -> Vec<String> {
//     raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
//         .unwrap_or_default()
// }

// fn parse_medicines_json(raw: Option<String>) -> Vec<OpdMedicineRow> {
//     raw.and_then(|s| serde_json::from_str::<Vec<OpdMedicineRow>>(&s).ok())
//         .unwrap_or_default()
// }

// fn build_opd_request_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<OpdRequestRow> {
//     Ok(OpdRequestRow {
//         id: r.get(0)?,
//         pet_id: r.get(1)?,
//         pet_name: r.get(2)?,
//         pet_card_id: r.get(3)?,
//         species: r.get(4)?,
//         breed: r.get(5)?,
//         weight: r.get(6)?,
//         age: r.get(7)?,
//         date_of_birth: r.get(8)?,
//         sex: r.get(9)?,
//         owner_name: r.get(10)?,
//         owner_phone: r.get(11)?,
//         requested_by_user_id: r.get(12)?,
//         requested_by_name: r.get(13)?,
//         status: r.get(14)?,
//         assigned_vet_id: r.get(15)?,
//         assigned_vet_name: r.get(16)?,
//         created_at: r.get(17)?,
//         claimed_at: r.get(18)?,
//         completed_at: r.get(19)?,
//     })
// }

// fn build_opd_catalog_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<OpdCatalogItemRow> {
//     Ok(OpdCatalogItemRow {
//         id: r.get(0)?,
//         item_type: r.get(1)?,
//         name: r.get(2)?,
//         active: r.get::<_, i64>(3)? != 0,
//         created_at: r.get(4)?,
//     })
// }

// #[tauri::command]
// pub fn opd_requests_list(
//     state: State<'_, AppState>,
//     status: Option<String>,
// ) -> Result<Vec<OpdRequestRow>, String> {
//     require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut sql = "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id".to_string();
//     let normalized = status
//         .as_ref()
//         .map(|s| s.trim().to_string())
//         .unwrap_or_else(|| "open".to_string());
//     if normalized == "open" {
//         sql.push_str(" WHERE o.status IN ('pending', 'in_progress')");
//     } else if normalized == "pending"
//         || normalized == "in_progress"
//         || normalized == "completed"
//     {
//         sql.push_str(" WHERE o.status = ?1");
//     }
//     sql.push_str(" ORDER BY o.created_at DESC");
//     let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
//     let rows = if normalized == "pending"
//         || normalized == "in_progress"
//         || normalized == "completed"
//     {
//         stmt.query_map(params![normalized], build_opd_request_row)
//             .map_err(|e| e.to_string())?
//     } else {
//         stmt.query_map([], build_opd_request_row)
//             .map_err(|e| e.to_string())?
//     };
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn opd_request_create(state: State<'_, AppState>, pet_id: String) -> Result<OpdRequestRow, String> {
//     let session = require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let _: String = conn
//         .query_row("SELECT id FROM pets WHERE id = ?1", params![pet_id], |r| r.get(0))
//         .map_err(|_| "Pet not found".to_string())?;
//     let existing: Option<String> = conn
//         .query_row(
//             "SELECT id FROM opd_requests WHERE pet_id = ?1 AND status IN ('pending', 'in_progress') ORDER BY created_at DESC LIMIT 1",
//             params![pet_id],
//             |r| r.get(0),
//         )
//         .ok();
//     let id = if let Some(eid) = existing {
//         eid
//     } else {
//         let nid = Uuid::new_v4().to_string();
//         let now = crate::sync::approx_server_now();
//         conn.execute(
//             "INSERT INTO opd_requests (id, pet_id, requested_by_user_id, requested_by_name, status, assigned_vet_id, assigned_vet_name, created_at, claimed_at, completed_at) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5, NULL, NULL)",
//             params![nid, pet_id, session.id, session.display_name, now],
//         )
//         .map_err(|e| e.to_string())?;
//         nid
//     };
//     conn.query_row(
//         "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
//         params![id],
//         |r| {
//             Ok(OpdRequestRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 pet_name: r.get(2)?,
//                 pet_card_id: r.get(3)?,
//                 species: r.get(4)?,
//                 breed: r.get(5)?,
//                 weight: r.get(6)?,
//                 age: r.get(7)?,
//                 date_of_birth: r.get(8)?,
//                 sex: r.get(9)?,
//                 owner_name: r.get(10)?,
//                 owner_phone: r.get(11)?,
//                 requested_by_user_id: r.get(12)?,
//                 requested_by_name: r.get(13)?,
//                 status: r.get(14)?,
//                 assigned_vet_id: r.get(15)?,
//                 assigned_vet_name: r.get(16)?,
//                 created_at: r.get(17)?,
//                 claimed_at: r.get(18)?,
//                 completed_at: r.get(19)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn opd_request_claim(state: State<'_, AppState>, id: String) -> Result<OpdRequestRow, String> {
//     let session = require_login(&state)?;
//     if session.role != "vet" {
//         return Err("Only vets can claim OPD requests".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     let existing: (String, Option<String>) = conn
//         .query_row(
//             "SELECT status, assigned_vet_id FROM opd_requests WHERE id = ?1",
//             params![id],
//             |r| Ok((r.get(0)?, r.get(1)?)),
//         )
//         .map_err(|_| "OPD request not found".to_string())?;
//     if existing.0 == "completed" {
//         return Err("OPD request is already completed".to_string());
//     }
//     if let Some(ref assigned) = existing.1 {
//         if assigned != &session.id {
//             return Err("This OPD request is already assigned to another vet".to_string());
//         }
//     }
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "UPDATE opd_requests SET status = 'in_progress', assigned_vet_id = ?2, assigned_vet_name = ?3, claimed_at = COALESCE(claimed_at, ?4) WHERE id = ?1",
//         params![id, session.id, session.display_name, now],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
//         params![id],
//         |r| {
//             Ok(OpdRequestRow {
//                 id: r.get(0)?,
//                 pet_id: r.get(1)?,
//                 pet_name: r.get(2)?,
//                 pet_card_id: r.get(3)?,
//                 species: r.get(4)?,
//                 breed: r.get(5)?,
//                 weight: r.get(6)?,
//                 age: r.get(7)?,
//                 date_of_birth: r.get(8)?,
//                 sex: r.get(9)?,
//                 owner_name: r.get(10)?,
//                 owner_phone: r.get(11)?,
//                 requested_by_user_id: r.get(12)?,
//                 requested_by_name: r.get(13)?,
//                 status: r.get(14)?,
//                 assigned_vet_id: r.get(15)?,
//                 assigned_vet_name: r.get(16)?,
//                 created_at: r.get(17)?,
//                 claimed_at: r.get(18)?,
//                 completed_at: r.get(19)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// fn build_consultation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OpdConsultationRow> {
//     let history_raw: Option<String> = row.get(18)?;
//     let dx_items_raw: Option<String> = row.get(19)?;
//     let ddx_items_raw: Option<String> = row.get(20)?;
//     let symptoms_raw: Option<String> = row.get(23)?;
//     let lab_ids_raw: Option<String> = row.get(24)?;
//     let lab_names_raw: Option<String> = row.get(25)?;
//     let custom_tests_raw: Option<String> = row.get(26)?;
//     let meds_raw: Option<String> = row.get(27)?;
//     Ok(OpdConsultationRow {
//         id: row.get(0)?,
//         request_id: row.get(1)?,
//         pet_id: row.get(2)?,
//         pet_name: row.get(3)?,
//         pet_card_id: row.get(4)?,
//         species: row.get(5)?,
//         breed: row.get(6)?,
//         weight: row.get(7)?,
//         age: row.get(8)?,
//         date_of_birth: row.get(9)?,
//         sex: row.get(10)?,
//         owner_name: row.get(11)?,
//         owner_phone: row.get(12)?,
//         vet_id: row.get(13)?,
//         vet_name: row.get(14)?,
//         doctor_signature_name: row.get(15)?,
//         temperature: row.get(16)?,
//         physical_exam: row.get(17)?,
//         history_observations: parse_string_array_json(history_raw),
//         dx_items: parse_string_array_json(dx_items_raw),
//         ddx_items: parse_string_array_json(ddx_items_raw),
//         diagnosis_note: row.get(21)?,
//         differential_diagnosis_note: row.get(22)?,
//         symptoms: parse_string_array_json(symptoms_raw),
//         recommended_lab_test_ids: parse_string_array_json(lab_ids_raw),
//         recommended_lab_test_names: parse_string_array_json(lab_names_raw),
//         custom_lab_tests: parse_string_array_json(custom_tests_raw),
//         medicines: parse_medicines_json(meds_raw),
//         clinical_treatment_remark: row.get(28)?,
//         in_house_prescription: row.get(29)?,
//         recommended_food: row.get(30)?,
//         next_visit_at: row.get(31)?,
//         created_at: row.get(32)?,
//         body_weight: row.get(33)?,
//     })
// }

// #[tauri::command]
// pub fn opd_consultations_list(
//     state: State<'_, AppState>,
//     pet_id: Option<String>,
//     mine: Option<bool>,
// ) -> Result<Vec<OpdConsultationRow>, String> {
//     let session = require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut sql = "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id".to_string();
//     let mut clauses: Vec<String> = Vec::new();
//     if pet_id.is_some() {
//         clauses.push("c.pet_id = ?1".to_string());
//     }
//     let use_mine = mine.unwrap_or(false) && session.role == "vet";
//     if use_mine {
//         clauses.push(if pet_id.is_some() {
//             "c.vet_id = ?2".to_string()
//         } else {
//             "c.vet_id = ?1".to_string()
//         });
//     }
//     if !clauses.is_empty() {
//         sql.push_str(" WHERE ");
//         sql.push_str(&clauses.join(" AND "));
//     }
//     sql.push_str(" ORDER BY c.created_at DESC");
//     let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
//     let rows = match (pet_id, use_mine) {
//         (Some(pid), true) => stmt.query_map(params![pid, session.id], build_consultation_row),
//         (Some(pid), false) => stmt.query_map(params![pid], build_consultation_row),
//         (None, true) => stmt.query_map(params![session.id], build_consultation_row),
//         (None, false) => stmt.query_map([], build_consultation_row),
//     }
//     .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn opd_consultation_create(
//     state: State<'_, AppState>,
//     input: OpdConsultationInput,
// ) -> Result<OpdConsultationRow, String> {
//     let session = require_login(&state)?;
//     if session.role != "vet" {
//         return Err("Only vets can submit OPD consultation".to_string());
//     }
//     if input.request_id.trim().is_empty() {
//         return Err("request_id is required".to_string());
//     }
//     if input.doctor_signature_name.trim().is_empty() {
//         return Err("doctor_signature_name is required".to_string());
//     }
//     let mut conn = db::get_conn(&state.pool)?;
//     let request_row: (String, String, Option<String>, Option<String>) = conn
//         .query_row(
//             "SELECT pet_id, status, assigned_vet_id, claimed_at FROM opd_requests WHERE id = ?1",
//             params![input.request_id],
//             |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
//         )
//         .map_err(|_| "OPD request not found".to_string())?;
//     if request_row.1 == "completed" {
//         return Err("This OPD request is already completed".to_string());
//     }
//     if let Some(assigned) = request_row.2.clone() {
//         if assigned != session.id {
//             return Err("This OPD request is assigned to another vet".to_string());
//         }
//     }
//     let tx = conn.transaction().map_err(|e| e.to_string())?;
//     let now = crate::sync::approx_server_now();
//     tx.execute(
//         "UPDATE opd_requests SET status = 'in_progress', assigned_vet_id = ?2, assigned_vet_name = ?3, claimed_at = COALESCE(claimed_at, ?4) WHERE id = ?1",
//         params![input.request_id, session.id, session.display_name, request_row.3.unwrap_or(now.clone())],
//     )
//     .map_err(|e| e.to_string())?;
//     let recommended_ids: Vec<String> = input
//         .recommended_lab_test_ids
//         .unwrap_or_default()
//         .into_iter()
//         .map(|s| s.trim().to_string())
//         .filter(|s| !s.is_empty())
//         .collect();
//     let mut recommended_names: Vec<String> = Vec::new();
//     for tid in &recommended_ids {
//         let name: Option<String> = tx
//             .query_row(
//                 "SELECT name FROM lab_tests WHERE id = ?1",
//                 params![tid],
//                 |r| r.get(0),
//             )
//             .ok();
//         if let Some(n) = name {
//             recommended_names.push(n);
//         }
//     }
//     let meds: Vec<OpdMedicineRow> = input
//         .medicines
//         .unwrap_or_default()
//         .into_iter()
//         .map(|m| OpdMedicineRow {
//             name: m.name.trim().to_string(),
//             dosage: m.dosage.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             direction_per_day: m
//                 .direction_per_day
//                 .map(|x| x.trim().to_string())
//                 .filter(|x| !x.is_empty()),
//         })
//         .filter(|m| !m.name.is_empty())
//         .collect();
//     let existing_consultation_id: Option<String> = tx
//         .query_row(
//             "SELECT id FROM opd_consultations WHERE request_id = ?1",
//             params![input.request_id],
//             |r| r.get(0),
//         )
//         .ok();
//     let updating_existing = existing_consultation_id.is_some();
//     let id = existing_consultation_id
//         .clone()
//         .unwrap_or_else(|| Uuid::new_v4().to_string());
//     let temperature = input
//         .temperature
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let physical_exam = input
//         .physical_exam
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let history_json = serde_json::to_string(
//         &input
//             .history_observations
//             .unwrap_or_default()
//             .into_iter()
//             .map(|x| x.trim().to_string())
//             .filter(|x| !x.is_empty())
//             .collect::<Vec<_>>(),
//     )
//     .unwrap_or_else(|_| "[]".to_string());
//     let dx_json = serde_json::to_string(
//         &input
//             .dx_items
//             .unwrap_or_default()
//             .into_iter()
//             .map(|x| x.trim().to_string())
//             .filter(|x| !x.is_empty())
//             .collect::<Vec<_>>(),
//     )
//     .unwrap_or_else(|_| "[]".to_string());
//     let ddx_json = serde_json::to_string(
//         &input
//             .ddx_items
//             .unwrap_or_default()
//             .into_iter()
//             .map(|x| x.trim().to_string())
//             .filter(|x| !x.is_empty())
//             .collect::<Vec<_>>(),
//     )
//     .unwrap_or_else(|_| "[]".to_string());
//     let diagnosis_note = input
//         .diagnosis_note
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let differential_diagnosis_note = input
//         .differential_diagnosis_note
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let symptoms_json = serde_json::to_string(
//         &input
//             .symptoms
//             .unwrap_or_default()
//             .into_iter()
//             .map(|x| x.trim().to_string())
//             .filter(|x| !x.is_empty())
//             .collect::<Vec<_>>(),
//     )
//     .unwrap_or_else(|_| "[]".to_string());
//     let recommended_ids_json = serde_json::to_string(&recommended_ids).unwrap_or_else(|_| "[]".to_string());
//     let recommended_names_json =
//         serde_json::to_string(&recommended_names).unwrap_or_else(|_| "[]".to_string());
//     let custom_lab_tests_json = serde_json::to_string(
//         &input
//             .custom_lab_tests
//             .unwrap_or_default()
//             .into_iter()
//             .map(|x| x.trim().to_string())
//             .filter(|x| !x.is_empty())
//             .collect::<Vec<_>>(),
//     )
//     .unwrap_or_else(|_| "[]".to_string());
//     let medicines_json = serde_json::to_string(&meds).unwrap_or_else(|_| "[]".to_string());
//     let clinical_treatment_remark = input
//         .clinical_treatment_remark
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let in_house_prescription = input
//         .in_house_prescription
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let recommended_food = input
//         .recommended_food
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let next_visit_at = input.next_visit_at.filter(|x| !x.trim().is_empty());
//     if updating_existing {
//         tx.execute(
//             "UPDATE opd_consultations SET pet_id = ?2, vet_id = ?3, vet_name = ?4, doctor_signature_name = ?5, temperature = ?6, physical_exam = ?7, history_observations = ?8, dx_items = ?9, ddx_items = ?10, diagnosis_note = ?11, differential_diagnosis_note = ?12, symptoms = ?13, recommended_lab_test_ids = ?14, recommended_lab_test_names = ?15, custom_lab_tests = ?16, medicines_json = ?17, clinical_treatment_remark = ?18, in_house_prescription = ?19, recommended_food = ?20, next_visit_at = ?21, body_weight = ?22 WHERE id = ?1",
//             params![
//                 id,
//                 request_row.0,
//                 session.id,
//                 session.display_name,
//                 input.doctor_signature_name.trim(),
//                 temperature,
//                 physical_exam,
//                 history_json,
//                 dx_json,
//                 ddx_json,
//                 diagnosis_note,
//                 differential_diagnosis_note,
//                 symptoms_json,
//                 recommended_ids_json,
//                 recommended_names_json,
//                 custom_lab_tests_json,
//                 medicines_json,
//                 clinical_treatment_remark,
//                 in_house_prescription,
//                 recommended_food,
//                 next_visit_at,
//                 input.body_weight,
//             ],
//         )
//         .map_err(|e| e.to_string())?;
//     } else {
//         tx.execute(
//             "INSERT INTO opd_consultations (id, request_id, pet_id, vet_id, vet_name, doctor_signature_name, temperature, physical_exam, history_observations, dx_items, ddx_items, diagnosis_note, differential_diagnosis_note, symptoms, recommended_lab_test_ids, recommended_lab_test_names, custom_lab_tests, medicines_json, clinical_treatment_remark, in_house_prescription, recommended_food, next_visit_at, created_at, body_weight) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
//             params![
//                 id,
//                 input.request_id,
//                 request_row.0,
//                 session.id,
//                 session.display_name,
//                 input.doctor_signature_name.trim(),
//                 temperature,
//                 physical_exam,
//                 history_json,
//                 dx_json,
//                 ddx_json,
//                 diagnosis_note,
//                 differential_diagnosis_note,
//                 symptoms_json,
//                 recommended_ids_json,
//                 recommended_names_json,
//                 custom_lab_tests_json,
//                 medicines_json,
//                 clinical_treatment_remark,
//                 in_house_prescription,
//                 recommended_food,
//                 next_visit_at,
//                 now,
//                 input.body_weight,
//             ],
//         )
//         .map_err(|e| e.to_string())?;
//     }
//     tx.execute(
//         "UPDATE opd_requests SET status = 'completed', assigned_vet_id = ?2, assigned_vet_name = ?3, completed_at = ?4 WHERE id = ?1",
//         params![input.request_id, session.id, session.display_name, now],
//     )
//     .map_err(|e| e.to_string())?;
//     update_pet_weight(&tx, &request_row.0, &input.body_weight)?;
//     tx.commit().map_err(|e| e.to_string())?;
//     let conn = db::get_conn(&state.pool)?;
//     conn.query_row(
//         "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.id = ?1",
//         params![id],
//         build_consultation_row,
//     )
//     .map_err(|e| e.to_string())
// }


// #[tauri::command]
// pub fn opd_consultation_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn
//         .execute("DELETE FROM opd_consultations WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("OPD consultation not found".to_string());
//     }
//     Ok(())
// }

// #[tauri::command]
// pub fn opd_consultation_update(
//     state: State<'_, AppState>,
//     id: String,
//     input: OpdConsultationInput,
// ) -> Result<OpdConsultationRow, String> {
//     require_clinic_access(&state)?;
//     if input.doctor_signature_name.trim().is_empty() {
//         return Err("doctor_signature_name is required".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     let recommended_ids: Vec<String> = input
//         .recommended_lab_test_ids
//         .unwrap_or_default()
//         .into_iter()
//         .map(|s| s.trim().to_string())
//         .filter(|s| !s.is_empty())
//         .collect();
//     let mut recommended_names: Vec<String> = Vec::new();
//     for tid in &recommended_ids {
//         let name: Option<String> = conn
//             .query_row(
//                 "SELECT name FROM lab_tests WHERE id = ?1",
//                 params![tid],
//                 |r| r.get(0),
//             )
//             .ok();
//         if let Some(n) = name {
//             recommended_names.push(n);
//         }
//     }
//     let meds: Vec<OpdMedicineRow> = input
//         .medicines
//         .unwrap_or_default()
//         .into_iter()
//         .map(|m| OpdMedicineRow {
//             name: m.name.trim().to_string(),
//             dosage: m.dosage.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             direction_per_day: m
//                 .direction_per_day
//                 .map(|x| x.trim().to_string())
//                 .filter(|x| !x.is_empty()),
//         })
//         .filter(|m| !m.name.is_empty())
//         .collect();
//     let physical_exam = input
//         .physical_exam
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());
//     let in_house_prescription = input
//         .in_house_prescription
//         .map(|x| x.trim().to_string())
//         .filter(|x| !x.is_empty());

//     let n = conn.execute(
//         "UPDATE opd_consultations SET doctor_signature_name = ?2, temperature = ?3, physical_exam = ?4, history_observations = ?5, dx_items = ?6, ddx_items = ?7, diagnosis_note = ?8, differential_diagnosis_note = ?9, symptoms = ?10, recommended_lab_test_ids = ?11, recommended_lab_test_names = ?12, custom_lab_tests = ?13, medicines_json = ?14, clinical_treatment_remark = ?15, in_house_prescription = ?16, recommended_food = ?17, next_visit_at = ?18 WHERE id = ?1",
//         params![
//             id,
//             input.doctor_signature_name.trim(),
//             input.temperature.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             physical_exam,
//             serde_json::to_string(&input.history_observations.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&input.dx_items.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&input.ddx_items.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
//             input.diagnosis_note.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             input.differential_diagnosis_note.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             serde_json::to_string(&input.symptoms.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&recommended_ids).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&recommended_names).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&input.custom_lab_tests.unwrap_or_default().into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".to_string()),
//             serde_json::to_string(&meds).unwrap_or_else(|_| "[]".to_string()),
//             input.clinical_treatment_remark.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             in_house_prescription,
//             input.recommended_food.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()),
//             input.next_visit_at.filter(|x| !x.trim().is_empty()),
//         ],
//     ).map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("OPD consultation not found".to_string());
//     }
//     conn.query_row(
//         "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.id = ?1",
//         params![id],
//         build_consultation_row,
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn opd_request_reopen(state: State<'_, AppState>, id: String) -> Result<OpdRequestRow, String> {
//     require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let status: String = conn
//         .query_row("SELECT status FROM opd_requests WHERE id = ?1", params![id], |r| r.get(0))
//         .map_err(|_| "OPD request not found".to_string())?;
//     if status != "completed" {
//         return Err("Only completed cases can be reopened".to_string());
//     }
//     conn.execute(
//         "UPDATE opd_requests SET status = 'pending', completed_at = NULL WHERE id = ?1",
//         params![id],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT o.id, o.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, o.requested_by_user_id, o.requested_by_name, o.status, o.assigned_vet_id, o.assigned_vet_name, o.created_at, o.claimed_at, o.completed_at FROM opd_requests o LEFT JOIN pets p ON p.id = o.pet_id WHERE o.id = ?1",
//         params![id],
//         build_opd_request_row,
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn opd_dashboard_summary(state: State<'_, AppState>) -> Result<OpdDashboardSummary, String> {
//     let session = require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let now = chrono::Utc::now();
//     let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc().to_rfc3339();
//     let week_start_date =
//         now.date_naive() - chrono::Duration::days(now.weekday().num_days_from_monday() as i64);
//     let week = week_start_date
//         .and_hms_opt(0, 0, 0)
//         .unwrap()
//         .and_utc()
//         .to_rfc3339();
//     let month = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
//         .unwrap()
//         .and_hms_opt(0, 0, 0)
//         .unwrap()
//         .and_utc()
//         .to_rfc3339();

//     let query_count = |since: &str| -> Result<i64, String> {
//         if session.role == "vet" {
//             conn.query_row(
//                 "SELECT COUNT(*) FROM opd_consultations WHERE vet_id = ?1 AND created_at >= ?2",
//                 params![session.id, since],
//                 |r| r.get(0),
//             )
//             .map_err(|e| e.to_string())
//         } else {
//             conn.query_row(
//                 "SELECT COUNT(*) FROM opd_consultations WHERE created_at >= ?1",
//                 params![since],
//                 |r| r.get(0),
//             )
//             .map_err(|e| e.to_string())
//         }
//     };

//     let mut sql = "SELECT c.id, c.request_id, c.pet_id, COALESCE(p.name, 'Unknown pet'), COALESCE(p.card_id, '—'), p.species, p.breed, p.weight, p.age, p.date_of_birth, p.sex, p.owner_name, p.owner_phone, c.vet_id, c.vet_name, c.doctor_signature_name, c.temperature, c.physical_exam, c.history_observations, c.dx_items, c.ddx_items, c.diagnosis_note, c.differential_diagnosis_note, c.symptoms, c.recommended_lab_test_ids, c.recommended_lab_test_names, c.custom_lab_tests, c.medicines_json, c.clinical_treatment_remark, c.in_house_prescription, c.recommended_food, c.next_visit_at, c.created_at, c.body_weight FROM opd_consultations c LEFT JOIN pets p ON p.id = c.pet_id WHERE c.next_visit_at IS NOT NULL AND c.next_visit_at >= ?1".to_string();
//     if session.role == "vet" {
//         sql.push_str(" AND c.vet_id = ?2");
//     }
//     sql.push_str(" ORDER BY c.next_visit_at ASC LIMIT 15");
//     let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
//     let rows = if session.role == "vet" {
//         stmt.query_map(params![today, session.id], build_consultation_row)
//     } else {
//         stmt.query_map(params![today], build_consultation_row)
//     }
//     .map_err(|e| e.to_string())?;
//     let mut next_visits = Vec::new();
//     for row in rows {
//         next_visits.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(OpdDashboardSummary {
//         checked_today: query_count(&today)?,
//         checked_week: query_count(&week)?,
//         checked_month: query_count(&month)?,
//         next_visits,
//     })
// }

// #[tauri::command]
// pub fn opd_catalog_list(
//     state: State<'_, AppState>,
//     item_type: Option<String>,
// ) -> Result<Vec<OpdCatalogItemRow>, String> {
//     require_clinic_access(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut sql = "SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE active = 1".to_string();
//     if item_type.is_some() {
//         sql.push_str(" AND type = ?1");
//     }
//     sql.push_str(" ORDER BY name COLLATE NOCASE");
//     let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
//     let rows = if let Some(t) = item_type {
//         stmt.query_map(params![t], build_opd_catalog_row)
//             .map_err(|e| e.to_string())?
//     } else {
//         stmt.query_map([], build_opd_catalog_row)
//             .map_err(|e| e.to_string())?
//     };
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[tauri::command]
// pub fn opd_catalog_create(
//     state: State<'_, AppState>,
//     item_type: String,
//     name: String,
// ) -> Result<OpdCatalogItemRow, String> {
//     require_superadmin(&state)?;
//     let t = item_type.trim().to_string();
//     if t != "history_observation"
//         && t != "dx"
//         && t != "ddx"
//         && t != "vaccine"
//         && t != "deworming"
//         && t != "surgery"
//         && t != "surgery_dx"
//         && t != "surgery_ddx"
//         && t != "radiology_dx"
//         && t != "radiology_ddx"
//         && t != "ultrasonography_dx"
//         && t != "ultrasonography_ddx"
//         && t != "medicine"
//         && t != "food"
//         && t != "symptom"
//     {
//         return Err("invalid catalog type".to_string());
//     }
//     let n = name.trim().to_string();
//     if n.is_empty() {
//         return Err("name is required".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     let dup: i64 = conn
//         .query_row(
//             "SELECT COUNT(*) FROM opd_catalog_items WHERE type = ?1 AND LOWER(name) = LOWER(?2) AND active = 1",
//             params![t, n],
//             |r| r.get(0),
//         )
//         .unwrap_or(0);
//     if dup > 0 {
//         return Err("Item already exists".to_string());
//     }
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     conn.execute(
//         "INSERT INTO opd_catalog_items (id, type, name, active, created_at) VALUES (?1, ?2, ?3, 1, ?4)",
//         params![id, t, n, now],
//     )
//     .map_err(|e| e.to_string())?;
//     conn.query_row(
//         "SELECT id, type, name, active, created_at FROM opd_catalog_items WHERE id = ?1",
//         params![id],
//         |r| {
//             Ok(OpdCatalogItemRow {
//                 id: r.get(0)?,
//                 item_type: r.get(1)?,
//                 name: r.get(2)?,
//                 active: r.get::<_, i64>(3)? != 0,
//                 created_at: r.get(4)?,
//             })
//         },
//     )
//     .map_err(|e| e.to_string())
// }

// #[tauri::command]
// pub fn opd_catalog_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
//     require_superadmin(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn
//         .execute("UPDATE opd_catalog_items SET active = 0 WHERE id = ?1", params![id])
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("Catalog item not found".to_string());
//     }
//     Ok(())
// }

// #[derive(Serialize)]
// pub struct UserDirectoryRow {
//     pub id: String,
//     pub username: String,
//     pub display_name: String,
//     pub role: String,
//     pub created_at: String,
//     pub active: bool,
// }

// fn require_superadmin(state: &AppState) -> Result<SessionUser, String> {
//     let u = require_login(state)?;
//     if u.role != "superadmin" {
//         return Err("Superadmin only".to_string());
//     }
//     Ok(u)
// }

// #[tauri::command]
// pub fn users_list(state: State<'_, AppState>) -> Result<Vec<UserDirectoryRow>, String> {
//     require_superadmin(&state)?;
//     let conn = db::get_conn(&state.pool)?;
//     let mut stmt = conn
//         .prepare(
//             "SELECT id, username, display_name, role, created_at, COALESCE(active, 1) FROM users ORDER BY username COLLATE NOCASE",
//         )
//         .map_err(|e| e.to_string())?;
//     let rows = stmt
//         .query_map([], |r| {
//             Ok(UserDirectoryRow {
//                 id: r.get(0)?,
//                 username: r.get(1)?,
//                 display_name: r.get(2)?,
//                 role: r.get(3)?,
//                 created_at: r.get(4)?,
//                 active: r.get::<_, i64>(5)? != 0,
//             })
//         })
//         .map_err(|e| e.to_string())?;
//     let mut out = Vec::new();
//     for row in rows {
//         out.push(row.map_err(|e| e.to_string())?);
//     }
//     Ok(out)
// }

// #[derive(Deserialize)]
// pub struct StaffUserCreateInput {
//     pub username: String,
//     pub password: String,
//     pub display_name: String,
//     pub role: String,
// }

// #[tauri::command]
// pub fn users_create(
//     state: State<'_, AppState>,
//     input: StaffUserCreateInput,
// ) -> Result<UserDirectoryRow, String> {
//     require_superadmin(&state)?;
//     let username = input.username.trim().to_string();
//     let display_name = input.display_name.trim().to_string();
//     if username.is_empty() || display_name.is_empty() {
//         return Err("Username and display name are required".to_string());
//     }
//     if input.password.len() < 8 {
//         return Err("Password must be at least 8 characters".to_string());
//     }
//     let role = input.role.trim().to_string();
//     if role != "manager" && role != "vet" {
//         return Err("Role must be manager or vet".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     let dup: i64 = conn
//         .query_row(
//             "SELECT COUNT(*) FROM users WHERE username = ?1",
//             params![username],
//             |r| r.get(0),
//         )
//         .unwrap_or(0);
//     if dup > 0 {
//         return Err("That username is already taken".to_string());
//     }
//     let id = Uuid::new_v4().to_string();
//     let now = crate::sync::approx_server_now();
//     let hash = bcrypt_hash(input.password, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
//     conn.execute(
//         "INSERT INTO users (id, username, password_hash, display_name, role, created_at, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
//         params![id, username, hash, display_name, role.clone(), now],
//     )
//     .map_err(|e| e.to_string())?;
//     Ok(UserDirectoryRow {
//         id,
//         username,
//         display_name,
//         role,
//         created_at: now,
//         active: true,
//     })
// }

// #[tauri::command]
// pub fn users_set_active(
//     state: State<'_, AppState>,
//     user_id: String,
//     active: bool,
// ) -> Result<UserDirectoryRow, String> {
//     let admin = require_superadmin(&state)?;
//     if admin.id == user_id && !active {
//         return Err("You cannot deactivate your own account".to_string());
//     }
//     let conn = db::get_conn(&state.pool)?;
//     let n = conn
//         .execute(
//             "UPDATE users SET active = ?1 WHERE id = ?2",
//             params![if active { 1 } else { 0 }, user_id],
//         )
//         .map_err(|e| e.to_string())?;
//     if n == 0 {
//         return Err("User not found".to_string());
//     }
//     conn.query_row(
//         "SELECT id, username, display_name, role, created_at, COALESCE(active, 1) FROM users WHERE id = ?1",
//         params![user_id],
//         |r| {
//             Ok(UserDirectoryRow {
//                 id: r.get(0)?,
//                 username: r.get(1)?,
//                 display_name: r.get(2)?,
//                 role: r.get(3)?,
//                 created_at: r.get(4)?,
//                 active: r.get::<_, i64>(5)? != 0,
//             })
//         },
//     )
//     .map_err(|_| "User not found".to_string())
// }

// #[tauri::command]
// pub fn sync_db(state: State<'_, AppState>) {
//     state.trigger_sync();
// }


