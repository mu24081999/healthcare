use std::fs;

fn ensure_petcare_db(uri: &str) -> String {
    let uri = uri.trim();

    // Force the single shared database name: petcare (never test / default).
    if uri.contains("/test?") {
        return uri.replacen("/test?", "/petcare?", 1);
    }
    if uri.contains("/test/") {
        return uri.replacen("/test/", "/petcare/", 1);
    }
    if uri.ends_with("/test") {
        return format!("{}petcare", &uri[..uri.len() - "test".len()]);
    }

    if uri.contains("/petcare?") || uri.contains("/petcare/") || uri.ends_with("/petcare") {
        return uri.to_string();
    }

    // Common Atlas form: ...mongodb.net/?options  or  ...27017/?options
    if let Some(idx) = uri.find("/?") {
        let mut out = String::with_capacity(uri.len() + "petcare".len());
        out.push_str(&uri[..idx]);
        out.push_str("/petcare?");
        out.push_str(&uri[idx + 2..]);
        return out;
    }

    if let Some(idx) = uri.find('?') {
        let mut out = String::with_capacity(uri.len() + "/petcare".len());
        out.push_str(&uri[..idx]);
        out.push_str("/petcare?");
        out.push_str(&uri[idx + 1..]);
        return out;
    }

    if uri.ends_with('/') {
        format!("{uri}petcare")
    } else {
        format!("{uri}/petcare")
    }
}

fn main() {
    println!("cargo:rerun-if-changed=.env");
    // Try to read MONGODB_URI from a .env file at BUILD time (your machine),
    // or from an actual environment variable if already set (e.g. in CI).
    let uri = std::env::var("MONGODB_URI").ok().or_else(|| {
        fs::read_to_string(".env")
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|l| l.starts_with("MONGODB_URI="))
                    .map(|l| l["MONGODB_URI=".len()..].trim().to_string())
            })
    });

    if let Some(uri) = uri {
        let uri = ensure_petcare_db(&uri);
        println!("cargo:rustc-env=MONGODB_URI={}", uri);
    } else {
        // Fail the build loudly instead of silently shipping a broken app
        panic!("MONGODB_URI not set — put it in a .env file next to Cargo.toml or set it as an env var before building");
    }

    tauri_build::build();
}
