//! `shipwright-version-stamp` — stamp a release tag into every language's version field.
//!
//! Usage:
//! ```text
//! shipwright-version-stamp --tag v1.2.3 --root /path/to/repo
//! shipwright-version-stamp --tag 1.2.3  --root .              # bare semver also accepted
//! shipwright-version-stamp --tag v1.2.3 --dry-run             # prints what would change
//! ```
//!
//! Files rewritten (idempotent, skipped if absent):
//! - every `Cargo.toml` — `[workspace.package]`/`[package] version` plus the
//!   `version` requirement of each workspace-internal path dependency
//! - every `package.json` under `clients/` and repo root — top-level `version`
//! - every `*.csproj` — `<Version>` element (creates one if missing)
//! - `pubspec.yaml` — top-level `version:` key
//! - emits `<root>/build-info.json` with tag + RFC3339 UTC timestamp

#![forbid(unsafe_code)]
// Narrow pedantic allowances for a small CLI tool: tight arithmetic on
// known-positive counts, indexed slicing on already-checked byte ranges,
// `format!` appended to `String`s, and idiomatic short loop var names.
#![allow(
    clippy::arithmetic_side_effects,
    clippy::indexing_slicing,
    clippy::format_push_string,
    clippy::many_single_char_names,
    clippy::map_unwrap_or,
    clippy::unnecessary_wraps
)]

use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

/// Top-level error type for the CLI.
#[derive(Debug, thiserror::Error)]
enum StampError {
    /// Bad or missing command-line argument.
    #[error("argument: {0}")]
    Args(String),
    /// Tag did not parse as semver (with or without leading `v`).
    #[error("invalid tag `{0}`; expected semver like v1.2.3 or 1.2.3")]
    InvalidTag(String),
    /// File system error.
    #[error("io at {path}: {source}")]
    Io {
        /// Path where the error occurred.
        path: PathBuf,
        /// Underlying error.
        source: io::Error,
    },
    /// JSON serialization failure.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(io::stderr(), "shipwright-version-stamp: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Entry point after argv parsing.
fn run() -> Result<(), StampError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opts = parse_args(&args)?;
    let version = normalize_tag(&opts.tag)?;
    let root = opts.root.canonicalize().map_err(|source| StampError::Io {
        path: opts.root.clone(),
        source,
    })?;

    let summary = Summary::default();
    let summary = stamp_cargo(&root, &version, opts.dry_run, summary)?;
    let summary = stamp_all_package_json(&root, &version, opts.dry_run, summary)?;
    let summary = stamp_all_csproj(&root, &version, opts.dry_run, summary)?;
    let summary = stamp_pubspec(&root, &version, opts.dry_run, summary)?;
    let summary = emit_build_info(&root, &version, opts.dry_run, summary)?;

    println!("stamped version={version} (dry-run={})", opts.dry_run);
    println!("  Cargo.toml        : {}", summary.cargo);
    println!("  package.json      : {}", summary.npm);
    println!("  *.csproj          : {}", summary.csproj);
    println!("  pubspec.yaml      : {}", summary.pubspec);
    println!("  build-info.json   : {}", summary.build_info);
    Ok(())
}

/// Parsed CLI options.
#[derive(Debug)]
struct Opts {
    /// `--tag` argument.
    tag: String,
    /// `--root` argument (defaults to current directory).
    root: PathBuf,
    /// `--dry-run` — do not write files.
    dry_run: bool,
}

/// Parse argv into [`Opts`].
fn parse_args(args: &[String]) -> Result<Opts, StampError> {
    let mut tag: Option<String> = None;
    let mut root: Option<PathBuf> = None;
    let mut dry_run = false;

    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--tag" => {
                let v = args
                    .get(i + 1)
                    .ok_or_else(|| StampError::Args("--tag requires a value".into()))?;
                tag = Some(v.clone());
                i += 2;
            }
            "--root" => {
                let v = args
                    .get(i + 1)
                    .ok_or_else(|| StampError::Args("--root requires a value".into()))?;
                root = Some(PathBuf::from(v));
                i += 2;
            }
            "--dry-run" => {
                dry_run = true;
                i += 1;
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => return Err(StampError::Args(format!("unknown argument `{other}`"))),
        }
    }

    Ok(Opts {
        tag: tag.ok_or_else(|| StampError::Args("--tag is required".into()))?,
        root: root.unwrap_or_else(|| PathBuf::from(".")),
        dry_run,
    })
}

/// Print help to stdout.
fn print_help() {
    println!(
        "shipwright-version-stamp — stamp a release tag into every language's version field\n\n\
         USAGE:\n    shipwright-version-stamp --tag <TAG> [--root <DIR>] [--dry-run]\n\n\
         OPTIONS:\n    --tag <TAG>     semver or v<semver>, e.g. v1.2.3\n    \
         --root <DIR>    repo root (default: .)\n    \
         --dry-run       print actions without writing\n"
    );
}

/// Strip leading `v` from a tag and validate semver shape.
fn normalize_tag(tag: &str) -> Result<String, StampError> {
    let candidate = tag.strip_prefix('v').unwrap_or(tag);
    if is_semver(candidate) {
        Ok(candidate.to_string())
    } else {
        Err(StampError::InvalidTag(tag.to_string()))
    }
}

/// Minimal semver check: `N.N.N` with optional `-prerelease` and `+build`.
fn is_semver(s: &str) -> bool {
    let mut parts = s.splitn(3, '.');
    let (Some(maj), Some(min), Some(rest)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if !is_dec_digits(maj) || !is_dec_digits(min) {
        return false;
    }
    let patch = rest.split(['-', '+']).next().unwrap_or(rest);
    is_dec_digits(patch)
}

/// `true` when `s` is non-empty and every byte is ASCII `0..=9`.
fn is_dec_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Per-category rewrite counts.
#[derive(Default, Debug, Clone, Copy)]
struct Summary {
    /// Cargo files touched.
    cargo: usize,
    /// `package.json` files touched.
    npm: usize,
    /// `*.csproj` files touched.
    csproj: usize,
    /// Pubspec files touched.
    pubspec: usize,
    /// Build-info files written.
    build_info: usize,
}

/// Rewrite every `Cargo.toml` under `root`: the workspace/package version and
/// the version requirement of each workspace-internal path dependency. Walking
/// every manifest (not just the root) is required because the path-dep version
/// requirements live in the member crates. SWR-VERSION-BUILD-STAMPING
fn stamp_cargo(
    root: &Path,
    version: &str,
    dry_run: bool,
    mut s: Summary,
) -> Result<Summary, StampError> {
    for path in walk_for("Cargo.toml", root)? {
        let original = read_to_string(&path)?;
        let replaced =
            replace_cargo_dep_versions(&replace_cargo_version_lines(&original, version), version);
        if replaced != original {
            if !dry_run {
                write_string(&path, &replaced)?;
            }
            s.cargo = s.cargo.saturating_add(1);
        }
    }
    Ok(s)
}

/// Rewrite the `version = "..."` requirement of every workspace-internal path
/// dependency — any line carrying both `path =` and `version =`. Without this,
/// stamping bumps each crate's own version to the release tag while its sibling
/// path-deps still require `0.0.0-dev`, so `cargo` cannot resolve the workspace
/// at build/publish time. Narrow line-based rewrite, mirroring
/// [`replace_cargo_version_lines`]. SWR-VERSION-BUILD-STAMPING
fn replace_cargo_dep_versions(src: &str, version: &str) -> String {
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        out.push_str(&rewrite_dep_version_line(line, version));
        out.push('\n');
    }
    if !src.ends_with('\n') && out.ends_with('\n') {
        let _ = out.pop();
    }
    out
}

/// Replace the quoted value after `version =` on a path-dependency line; every
/// other line (including external deps and `version.workspace` markers) is
/// returned unchanged.
fn rewrite_dep_version_line(line: &str, version: &str) -> String {
    if !line.contains("path =") {
        return line.to_string();
    }
    let Some(key) = line.find("version =") else {
        return line.to_string();
    };
    let Some(open_rel) = line[key..].find('"') else {
        return line.to_string();
    };
    let open = key + open_rel;
    let Some(close_rel) = line[open + 1..].find('"') else {
        return line.to_string();
    };
    let close = open + 1 + close_rel;
    let mut s = String::with_capacity(line.len() + version.len());
    s.push_str(&line[..=open]);
    s.push_str(version);
    s.push_str(&line[close..]);
    s
}

/// Rewrite every `version = "..."` line found under `[workspace.package]` or
/// `[package]` tables. Deliberately narrow — does not parse TOML fully.
fn replace_cargo_version_lines(src: &str, version: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut in_target_table = false;
    for line in src.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') {
            in_target_table =
                trimmed.starts_with("[workspace.package]") || trimmed.starts_with("[package]");
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let should_replace = in_target_table
            && trimmed
                .strip_prefix("version")
                .map(|rest| rest.trim_start().starts_with('='))
                .unwrap_or(false);
        if should_replace {
            let indent = &line[..line.len() - trimmed.len()];
            out.push_str(indent);
            out.push_str(&format!("version = \"{version}\""));
            out.push('\n');
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    // Preserve trailing-newline shape of the original.
    if !src.ends_with('\n') && out.ends_with('\n') {
        let _ = out.pop();
    }
    out
}

/// Walk and rewrite every `package.json`.
fn stamp_all_package_json(
    root: &Path,
    version: &str,
    dry_run: bool,
    mut s: Summary,
) -> Result<Summary, StampError> {
    for p in walk_for("package.json", root)? {
        let original = read_to_string(&p)?;
        let Some(replaced) = replace_package_json_version(&original, version)? else {
            continue;
        };
        if replaced != original {
            if !dry_run {
                write_string(&p, &replaced)?;
            }
            s.npm = s.npm.saturating_add(1);
        }
    }
    Ok(s)
}

/// Update a single `package.json`. Returns `Ok(None)` if no top-level
/// `version` field is present (don't invent one).
fn replace_package_json_version(src: &str, version: &str) -> Result<Option<String>, StampError> {
    let mut value: serde_json::Value = serde_json::from_str(src)?;
    let Some(obj) = value.as_object_mut() else {
        return Ok(None);
    };
    if !obj.contains_key("version") {
        return Ok(None);
    }
    let _ = obj.insert(
        "version".to_string(),
        serde_json::Value::String(version.to_string()),
    );
    let mut out = serde_json::to_string_pretty(&value)?;
    if src.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(Some(out))
}

/// Walk and rewrite every `*.csproj`.
fn stamp_all_csproj(
    root: &Path,
    version: &str,
    dry_run: bool,
    mut s: Summary,
) -> Result<Summary, StampError> {
    for p in walk_for_ext("csproj", root)? {
        let original = read_to_string(&p)?;
        let replaced = replace_csproj_version(&original, version);
        if replaced != original {
            if !dry_run {
                write_string(&p, &replaced)?;
            }
            s.csproj = s.csproj.saturating_add(1);
        }
    }
    Ok(s)
}

/// Replace the first `<Version>` element; insert one into the first
/// `<PropertyGroup>` if none exists.
fn replace_csproj_version(src: &str, version: &str) -> String {
    if let Some(start) = src.find("<Version>") {
        if let Some(end_rel) = src[start..].find("</Version>") {
            let end = start + end_rel;
            let mut out = String::with_capacity(src.len());
            out.push_str(&src[..start]);
            out.push_str("<Version>");
            out.push_str(version);
            out.push_str(&src[end..]);
            return out;
        }
    }
    if let Some(pg) = src.find("<PropertyGroup>") {
        let insert_at = pg.saturating_add("<PropertyGroup>".len());
        let mut out = String::with_capacity(src.len() + 64);
        out.push_str(&src[..insert_at]);
        out.push_str(&format!("\n    <Version>{version}</Version>"));
        out.push_str(&src[insert_at..]);
        return out;
    }
    src.to_string()
}

/// Rewrite `pubspec.yaml` top-level `version:`.
fn stamp_pubspec(
    root: &Path,
    version: &str,
    dry_run: bool,
    mut s: Summary,
) -> Result<Summary, StampError> {
    for p in walk_for("pubspec.yaml", root)? {
        let original = read_to_string(&p)?;
        let replaced = replace_pubspec_version(&original, version);
        if replaced != original {
            if !dry_run {
                write_string(&p, &replaced)?;
            }
            s.pubspec = s.pubspec.saturating_add(1);
        }
    }
    Ok(s)
}

/// Swap the first line starting with `version:` (no indent → top-level).
fn replace_pubspec_version(src: &str, version: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut replaced = false;
    for line in src.lines() {
        if !replaced {
            if let Some(rest) = line.strip_prefix("version:") {
                let _ = rest; // discarded — we rewrite the whole line
                out.push_str(&format!("version: {version}\n"));
                replaced = true;
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    if !src.ends_with('\n') && out.ends_with('\n') {
        let _ = out.pop();
    }
    out
}

/// Write `build-info.json` at repo root.
fn emit_build_info(
    root: &Path,
    version: &str,
    dry_run: bool,
    mut s: Summary,
) -> Result<Summary, StampError> {
    let path = root.join("build-info.json");
    let info = BuildInfoJson {
        manifest_version: 1,
        version: version.to_string(),
        build_time: rfc3339_now(),
    };
    if !dry_run {
        let body = serde_json::to_string_pretty(&info)?;
        write_string(&path, &format!("{body}\n"))?;
    }
    s.build_info = s.build_info.saturating_add(1);
    Ok(s)
}

/// `build-info.json` payload written next to the manifest.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct BuildInfoJson {
    /// Schema marker.
    manifest_version: u32,
    /// Stamped semver.
    version: String,
    /// RFC3339 UTC timestamp.
    build_time: String,
}

/// Skip files under `target/`, `node_modules/`, `.git/`, `dist/`, `build/`.
fn is_ignored(p: &Path) -> bool {
    p.components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some("target" | "node_modules" | ".git" | "dist" | "build")
        )
    })
}

/// Depth-first walk, returning files whose file name equals `name`.
fn walk_for(name: &str, root: &Path) -> Result<Vec<PathBuf>, StampError> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if is_ignored(&path) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|f| f.to_str()) == Some(name) {
                found.push(path);
            }
        }
    }
    Ok(found)
}

/// Depth-first walk, returning files whose extension equals `ext` (no dot).
fn walk_for_ext(ext: &str, root: &Path) -> Result<Vec<PathBuf>, StampError> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if is_ignored(&path) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some(ext) {
                found.push(path);
            }
        }
    }
    Ok(found)
}

/// Read a file and wrap any I/O error with its path.
fn read_to_string(path: &Path) -> Result<String, StampError> {
    fs::read_to_string(path).map_err(|source| StampError::Io {
        path: path.to_path_buf(),
        source,
    })
}

/// Write a file and wrap any I/O error with its path.
fn write_string(path: &Path, body: &str) -> Result<(), StampError> {
    fs::write(path, body).map_err(|source| StampError::Io {
        path: path.to_path_buf(),
        source,
    })
}

/// Produce an RFC3339 UTC timestamp for "now" without external deps.
fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    rfc3339_from_secs(secs)
}

/// Format a unix-epoch seconds value as RFC3339 UTC.
fn rfc3339_from_secs(secs: u64) -> String {
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    #[allow(clippy::cast_possible_wrap, clippy::cast_possible_truncation)]
    let (y, mo, d) = epoch_days_to_ymd(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's `civil_from_days` algorithm (public domain).
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::arithmetic_side_effects
)]
fn epoch_days_to_ymd(days: u64) -> (i32, u32, u32) {
    let days = i64::try_from(days)
        .unwrap_or(i64::MAX)
        .saturating_add(719_468);
    let era = days / 146_097;
    let doe = (days - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + i64::from(m <= 2);
    (y as i32, m as u32, d as u32)
}
