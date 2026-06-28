//! E2E tests for the `shipwright-release-scope` binary.
//!
//! Black-box only: every case spawns the compiled CLI and asserts on its
//! stdout / stderr / exit status. Implements the behaviours specified in
//! `docs/specs/release-change-detection.md` [SWR-REL-CHANGES-*].

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::missing_docs_in_private_items,
    unused_results
)]

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use tempfile::TempDir;

const RULES: &str = r#"{
  "binary": ["crates/**", "Cargo.toml", "src/**"],
  "vsix": ["extensions/**", "vscode-extension/**"],
  "jetbrains": ["clients/jetbrains/**", "clients/kotlin/**"],
  "website": ["website/**", "docs/specs/**"],
  "ignore": ["**/*.md", "README*"]
}"#;

fn bin() -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_shipwright-release-scope"));
    // Never inherit a CI runner's Actions env: those branches are tested explicitly.
    c.env_remove("GITHUB_OUTPUT")
        .env_remove("GITHUB_STEP_SUMMARY");
    c
}

fn write(dir: &Path, name: &str, body: &str) -> String {
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    path.to_string_lossy().into_owned()
}

/// Fresh temp dir holding a `rules.json`; returns the dir guard and its path.
fn rules_dir(rules: &str) -> (TempDir, String) {
    let dir = TempDir::new().unwrap();
    let cfg = write(dir.path(), "rules.json", rules);
    (dir, cfg)
}

/// Run with a written ruleset + changed-list file, returning the process output.
fn run_case(rules: &str, changed_lines: &[&str]) -> (TempDir, Output) {
    let (dir, cfg) = rules_dir(rules);
    let changed = write(dir.path(), "changed.txt", &changed_lines.join("\n"));
    let out = bin()
        .args(["--config", &cfg, "--changed", &changed])
        .output()
        .unwrap();
    (dir, out)
}

/// Spawn the CLI with explicit `--config`/`--changed` values and a null stdin.
fn run_args(cfg: &str, changed: &str) -> Output {
    bin()
        .args(["--config", cfg, "--changed", changed])
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn assert_ok(out: &Output) {
    assert!(out.status.success(), "stderr: {}", stderr(out));
}

/// Assert the process failed and its stderr contains `needle`.
fn assert_fails_with(out: &Output, needle: &str) {
    assert!(!out.status.success());
    assert!(stderr(out).contains(needle), "{}", stderr(out));
}

fn assert_field(s: &str, field: &str, value: bool) {
    let needle = format!("\"{field}\": {value}");
    assert!(s.contains(&needle), "expected {needle}\nin: {s}");
}

// ── decision matrix ────────────────────────────────────────────────────────

#[test]
fn binary_change_cascades_to_everything() {
    // A nested path under crates/** must match (exercises `**` spanning dirs).
    let (_d, out) = run_case(RULES, &["crates/shipwright/src/main.rs", "README.md"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", true);
    assert_field(&s, "build_matrix", true);
    assert_field(&s, "vsix", true);
    assert_field(&s, "jetbrains", true);
    assert_field(&s, "website", true);
    assert!(s.contains("SWR-REL-CHANGES-CASCADE"), "{s}");
}

#[test]
fn literal_binary_path_cascades() {
    let (_d, out) = run_case(RULES, &["Cargo.toml"]);
    assert_ok(&out);
    assert_field(&stdout(&out), "full", true);
}

#[test]
fn unmatched_path_forces_failsafe_full_release() {
    let (_d, out) = run_case(RULES, &["infra/terraform/main.tf"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", true);
    assert_field(&s, "build_matrix", true);
    assert!(s.contains("SWR-REL-CHANGES-FAILSAFE"), "{s}");
}

#[test]
fn vsix_only_still_builds_the_matrix_but_not_website() {
    // The VSIX bundles binaries at the new tag version, so the matrix must run;
    // the website and the standalone binary channels do not.
    let (_d, out) = run_case(RULES, &["vscode-extension/src/extension.ts"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", true);
    assert_field(&s, "vsix", true);
    assert_field(&s, "jetbrains", false);
    assert_field(&s, "website", false);
    assert!(s.contains("partial release: vsix changed"), "{s}");
}

#[test]
fn jetbrains_only_still_builds_the_matrix() {
    let (_d, out) = run_case(RULES, &["clients/jetbrains/src/Main.kt"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", true);
    assert_field(&s, "jetbrains", true);
    assert_field(&s, "vsix", false);
    assert_field(&s, "website", false);
    assert!(s.contains("partial release: jetbrains changed"), "{s}");
}

#[test]
fn website_only_skips_the_matrix() {
    let (_d, out) = run_case(RULES, &["website/index.njk"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", false);
    assert_field(&s, "website", true);
    assert_field(&s, "vsix", false);
    assert_field(&s, "jetbrains", false);
    assert!(s.contains("partial release: website changed"), "{s}");
}

#[test]
fn vsix_and_website_change() {
    let (_d, out) = run_case(RULES, &["extensions/a.ts", "website/x.css"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "vsix", true);
    assert_field(&s, "website", true);
    assert_field(&s, "build_matrix", true);
    assert_field(&s, "full", false);
    assert!(s.contains("partial release: vsix + website changed"), "{s}");
}

#[test]
fn ignored_only_publishes_nothing() {
    let (_d, out) = run_case(RULES, &["README.md", "docs/notes.md"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", false);
    assert_field(&s, "website", false);
    assert!(s.contains("no release-relevant changes"), "{s}");
}

#[test]
fn empty_changeset_publishes_nothing() {
    let (_d, out) = run_case(RULES, &[]);
    assert_ok(&out);
    let s = stdout(&out);
    assert!(s.contains("\"changed_count\": 0"), "{s}");
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", false);
}

#[test]
fn priority_website_beats_ignore_for_spec_markdown() {
    // docs/specs/*.md matches both `website` and the broad `**/*.md` ignore;
    // website wins because it has the higher priority [SWR-REL-CHANGES-PRIORITY].
    let (_d, out) = run_case(RULES, &["docs/specs/binary-version-contract.md"]);
    assert_ok(&out);
    let s = stdout(&out);
    assert_field(&s, "website", true);
    assert_field(&s, "full", false);
    assert_field(&s, "build_matrix", false);
}

// ── stdin path ──────────────────────────────────────────────────────────────

#[test]
fn reads_changed_list_from_stdin() {
    let (_dir, cfg) = rules_dir(RULES);
    let mut child = bin()
        .args(["--config", &cfg, "--changed", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"website/index.njk\n")
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_ok(&out);
    assert_field(&stdout(&out), "website", true);
}

#[test]
fn invalid_utf8_stdin_is_an_io_error() {
    let (_dir, cfg) = rules_dir(RULES);
    let mut child = bin()
        .args(["--config", &cfg, "--changed", "-"])
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&[0xff, 0xfe])
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_fails_with(&out, "io at <stdin>");
}

// ── GitHub Actions integration ──────────────────────────────────────────────

#[test]
fn writes_github_output_and_step_summary() {
    let (dir, cfg) = rules_dir(RULES);
    let changed = write(dir.path(), "changed.txt", "vscode-extension/a.ts");
    let gh_out = dir.path().join("gh_output");
    let gh_sum = dir.path().join("gh_summary.md");
    let out = bin()
        .args(["--config", &cfg, "--changed", &changed])
        .env("GITHUB_OUTPUT", &gh_out)
        .env("GITHUB_STEP_SUMMARY", &gh_sum)
        .output()
        .unwrap();
    assert_ok(&out);
    let outputs = fs::read_to_string(&gh_out).unwrap();
    assert!(outputs.contains("full=false"), "{outputs}");
    assert!(outputs.contains("build_matrix=true"), "{outputs}");
    assert!(outputs.contains("vsix=true"), "{outputs}");
    assert!(outputs.contains("jetbrains=false"), "{outputs}");
    assert!(outputs.contains("website=false"), "{outputs}");
    let summary = fs::read_to_string(&gh_sum).unwrap();
    assert!(summary.contains("### Release scope"), "{summary}");
    assert!(summary.contains("build_matrix: `true`"), "{summary}");
}

#[test]
fn unwritable_github_output_is_an_io_error() {
    // Point GITHUB_OUTPUT at a directory so the append open() fails.
    let (dir, cfg) = rules_dir(RULES);
    let changed = write(dir.path(), "changed.txt", "website/x.css");
    let out = bin()
        .args(["--config", &cfg, "--changed", &changed])
        .env("GITHUB_OUTPUT", dir.path()) // a directory, not a file
        .output()
        .unwrap();
    assert_fails_with(&out, "io at");
}

// ── argument & config errors ─────────────────────────────────────────────────

#[test]
fn help_flag_prints_usage() {
    for flag in ["--help", "-h"] {
        let out = bin().arg(flag).output().unwrap();
        assert_ok(&out);
        assert!(stdout(&out).contains("USAGE:"), "flag {flag}");
    }
}

#[test]
fn unknown_argument_is_rejected() {
    assert_fails_with(
        &bin().args(["--nope"]).output().unwrap(),
        "unknown argument `--nope`",
    );
}

#[test]
fn flag_without_value_is_rejected() {
    assert_fails_with(
        &bin().args(["--config"]).output().unwrap(),
        "--config requires a value",
    );
}

#[test]
fn missing_config_is_rejected() {
    assert_fails_with(
        &bin().args(["--changed", "-"]).output().unwrap(),
        "--config is required",
    );
}

#[test]
fn missing_changed_is_rejected() {
    assert_fails_with(
        &bin().args(["--config", "rules.json"]).output().unwrap(),
        "--changed is required",
    );
}

#[test]
fn missing_config_file_is_an_io_error() {
    let dir = TempDir::new().unwrap();
    let cfg = dir.path().join("does-not-exist.json");
    assert_fails_with(&run_args(&cfg.to_string_lossy(), "-"), "io at");
}

#[test]
fn missing_changed_file_is_an_io_error() {
    let (_d, cfg) = rules_dir(RULES);
    assert_fails_with(
        &run_args(&cfg, "/no/such/changed.txt"),
        "io at /no/such/changed.txt",
    );
}

#[test]
fn invalid_json_config_is_rejected() {
    let (_d, cfg) = rules_dir("{ not valid json ");
    assert_fails_with(&run_args(&cfg, "-"), "config json");
}

#[test]
fn invalid_glob_in_config_is_rejected() {
    let (_d, cfg) = rules_dir(r#"{ "binary": ["a[b"] }"#);
    let out = run_args(&cfg, "-");
    assert!(!out.status.success());
    let e = stderr(&out);
    assert!(e.contains("invalid glob"), "{e}");
    assert!(e.contains("category `binary`"), "{e}");
}
