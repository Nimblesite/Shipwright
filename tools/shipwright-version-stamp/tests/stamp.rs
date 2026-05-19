//! E2E tests for the `shipwright-version-stamp` binary.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::missing_docs_in_private_items
)]

use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::TempDir;

fn write(dir: &Path, rel: &str, body: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, body).unwrap();
}

fn read(dir: &Path, rel: &str) -> String {
    fs::read_to_string(dir.join(rel)).unwrap()
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(args)
        .output()
        .unwrap()
}

fn run_in(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .current_dir(root)
        .args(args)
        .output()
        .unwrap()
}

fn assert_success(out: &Output) {
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn assert_failure_contains(out: &Output, expected: &str) {
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains(expected),
        "stderr did not contain {expected:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn seed_full_fixture(root: &Path) {
    write(
        root,
        "Cargo.toml",
        "[workspace.package]\nversion = \"0.0.1\"\n\n[dependencies]\nversion = \"9.9.9\"\n\n[package]\nname = \"fixture\"\nversion = \"0.0.1\"\nedition = \"2021\"",
    );
    write(
        root,
        "package.json",
        "{\n  \"name\": \"root\",\n  \"version\": \"0.0.1\"\n}\n",
    );
    write(
        root,
        "clients/ts/no-version/package.json",
        "{\n  \"name\": \"noversion\"\n}\n",
    );
    write(
        root,
        "clients/ts/list/package.json",
        "[\"not\", \"an\", \"object\"]\n",
    );
    write(root, "clients/dotnet/Existing.csproj", "<Project>\n  <PropertyGroup>\n    <Version>0.0.1</Version>\n  </PropertyGroup>\n</Project>\n");
    write(
        root,
        "clients/dotnet/Insert.csproj",
        "<Project>\n  <PropertyGroup>\n  </PropertyGroup>\n</Project>\n",
    );
    write(
        root,
        "clients/dotnet/NoPropertyGroup.csproj",
        "<Project></Project>\n",
    );
    write(
        root,
        "clients/dotnet/MissingEnd.csproj",
        "<Project>\n  <PropertyGroup><Version>0.0.1</PropertyGroup>\n</Project>\n",
    );
    write(
        root,
        "clients/dart/pkg/pubspec.yaml",
        "name: pkg\nversion: 0.0.1\ndescription: fixture",
    );
    write(
        root,
        "clients/dart/nested/pubspec.yaml",
        "name: nested\nflutter:\n  version: 0.0.1\n",
    );
    seed_ignored_fixture(root);
}

fn seed_ignored_fixture(root: &Path) {
    for dir in ["target", "node_modules", ".git", "dist", "build"] {
        write(
            root,
            &format!("{dir}/package.json"),
            "{\"version\":\"0.0.1\"}\n",
        );
        write(
            root,
            &format!("{dir}/Ignored.csproj"),
            "<Project><PropertyGroup><Version>0.0.1</Version></PropertyGroup></Project>\n",
        );
        write(root, &format!("{dir}/pubspec.yaml"), "version: 0.0.1\n");
    }
}

#[test]
fn prints_help_and_rejects_bad_arguments() {
    let help = run(&["--help"]);
    assert_success(&help);
    let stdout = String::from_utf8_lossy(&help.stdout);
    assert!(stdout.contains("USAGE:"));
    assert!(stdout.contains("--dry-run"));

    for (args, expected) in [
        (Vec::<&str>::new(), "--tag is required"),
        (vec!["--bogus"], "unknown argument"),
        (vec!["--tag"], "--tag requires a value"),
        (vec!["--root"], "--root requires a value"),
    ] {
        assert_failure_contains(&run(&args), expected);
    }
}

#[test]
fn rejects_invalid_semver_shapes() {
    let tmp = TempDir::new().unwrap();
    for tag in ["not-a-semver", "1.x.3", "1.2.beta"] {
        let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
            .args(["--tag", tag, "--root"])
            .arg(tmp.path())
            .output()
            .unwrap();
        assert_failure_contains(&out, "invalid tag");
    }
    assert!(!tmp.path().join("build-info.json").exists());
}

#[test]
fn dry_run_reports_changes_without_writing() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    seed_full_fixture(root);

    let before = read(root, "Cargo.toml");
    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "v2.0.0-alpha+7", "--dry-run", "--root"])
        .arg(root)
        .output()
        .unwrap();
    assert_success(&out);

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("stamped version=2.0.0-alpha+7 (dry-run=true)"));
    assert!(stdout.contains("Cargo.toml        : 1"));
    assert!(stdout.contains("package.json      : 1"));
    assert!(stdout.contains("*.csproj          : 3"));
    assert!(stdout.contains("pubspec.yaml      : 1"));
    assert_eq!(read(root, "Cargo.toml"), before);
    assert!(!root.join("build-info.json").exists());
}

#[test]
fn stamps_manifest_formats_and_ignored_dirs() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    seed_full_fixture(root);

    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "v1.2.3", "--root"])
        .arg(root)
        .output()
        .unwrap();
    assert_success(&out);

    let cargo_toml = read(root, "Cargo.toml");
    assert_eq!(cargo_toml.matches("version = \"1.2.3\"").count(), 2);
    assert!(cargo_toml.contains("version = \"9.9.9\""));
    assert!(read(root, "package.json").contains("\"version\": \"1.2.3\""));
    assert!(read(root, "clients/dotnet/Existing.csproj").contains("<Version>1.2.3</Version>"));
    assert!(read(root, "clients/dotnet/Insert.csproj").contains("<Version>1.2.3</Version>"));
    assert!(!read(root, "clients/dotnet/NoPropertyGroup.csproj").contains("<Version>"));
    assert!(read(root, "clients/dart/pkg/pubspec.yaml").contains("version: 1.2.3"));
    assert!(read(root, "clients/dart/nested/pubspec.yaml").contains("  version: 0.0.1"));

    for dir in ["target", "node_modules", ".git", "dist", "build"] {
        assert!(read(root, &format!("{dir}/package.json")).contains("0.0.1"));
        assert!(read(root, &format!("{dir}/Ignored.csproj")).contains("0.0.1"));
        assert!(read(root, &format!("{dir}/pubspec.yaml")).contains("0.0.1"));
    }

    let info: serde_json::Value = serde_json::from_str(&read(root, "build-info.json")).unwrap();
    assert_eq!(info["manifestVersion"], 1);
    assert_eq!(info["version"], "1.2.3");
    assert!(info["buildTime"].as_str().unwrap().ends_with('Z'));

    let second = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "1.2.3", "--root"])
        .arg(root)
        .output()
        .unwrap();
    assert_success(&second);
    let stdout = String::from_utf8_lossy(&second.stdout);
    assert!(stdout.contains("Cargo.toml        : 0"));
    assert!(stdout.contains("package.json      : 0"));
    assert!(stdout.contains("*.csproj          : 0"));
    assert!(stdout.contains("pubspec.yaml      : 0"));
}

#[test]
fn default_root_with_absent_manifests_only_writes_build_info() {
    let tmp = TempDir::new().unwrap();
    let out = run_in(tmp.path(), &["--tag", "4.5.6"]);
    assert_success(&out);

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("Cargo.toml        : 0"));
    assert!(stdout.contains("package.json      : 0"));
    assert!(stdout.contains("*.csproj          : 0"));
    assert!(stdout.contains("pubspec.yaml      : 0"));
    assert!(tmp.path().join("build-info.json").exists());
}

#[test]
fn reports_json_errors_from_package_json() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "package.json", "{ invalid json");

    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "1.2.3", "--root"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert_failure_contains(&out, "json:");
    assert!(!tmp.path().join("build-info.json").exists());
}

#[test]
fn reports_write_error_when_root_is_a_file() {
    let tmp = TempDir::new().unwrap();
    write(tmp.path(), "not-a-dir", "");
    let root_file = tmp.path().join("not-a-dir");

    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "1.2.3", "--root"])
        .arg(root_file)
        .output()
        .unwrap();
    assert_failure_contains(&out, "build-info.json");
}

#[test]
fn reports_canonicalize_error_for_missing_root() {
    let tmp = TempDir::new().unwrap();
    let missing = tmp.path().join("missing-root");

    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "1.2.3", "--root"])
        .arg(missing)
        .output()
        .unwrap();
    assert_failure_contains(&out, "missing-root");
}

#[cfg(unix)]
#[test]
fn reports_read_error_from_broken_manifest_symlink() {
    use std::os::unix::fs::symlink;

    let tmp = TempDir::new().unwrap();
    symlink(
        tmp.path().join("missing.json"),
        tmp.path().join("package.json"),
    )
    .unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_shipwright-version-stamp"))
        .args(["--tag", "1.2.3", "--root"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert_failure_contains(&out, "package.json");
}
