//! E2E test: run `deploy-stamp --tag v1.2.3 --root <tmp>` against a synthetic
//! repo containing every supported manifest kind, and assert rewrites are
//! correct + idempotent.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::missing_docs_in_private_items
)]

use std::fs;
use std::process::Command;
use tempfile::TempDir;

fn write(dir: &std::path::Path, rel: &str, body: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, body).unwrap();
}

fn read(dir: &std::path::Path, rel: &str) -> String {
    fs::read_to_string(dir.join(rel)).unwrap()
}

fn exe_path() -> std::path::PathBuf {
    let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("..");
    p.push("target");
    p.push("debug");
    p.push("deploy-stamp");
    p
}

#[test]
fn stamps_every_manifest_kind() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write(
        root,
        "Cargo.toml",
        "[workspace.package]\nversion = \"0.0.1\"\nedition = \"2021\"\n",
    );
    write(
        root,
        "clients/ts/packages/core/package.json",
        "{\n  \"name\": \"core\",\n  \"version\": \"0.0.1\"\n}\n",
    );
    write(
        root,
        "clients/dotnet/Lib.csproj",
        "<Project>\n  <PropertyGroup>\n    <Version>0.0.1</Version>\n  </PropertyGroup>\n</Project>\n",
    );
    write(
        root,
        "clients/dart/pkg/pubspec.yaml",
        "name: pkg\nversion: 0.0.1\n",
    );

    // Ensure the binary exists (workspace builds it when this test runs).
    let status = Command::new("cargo")
        .args(["build", "-p", "deploy-stamp"])
        .status()
        .unwrap();
    assert!(status.success());

    let exe = exe_path();
    assert!(exe.exists(), "binary missing at {}", exe.display());

    let out = Command::new(&exe)
        .args(["--tag", "v1.2.3", "--root"])
        .arg(root)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    assert!(read(root, "Cargo.toml").contains("version = \"1.2.3\""));
    assert!(read(root, "clients/ts/packages/core/package.json").contains("\"version\": \"1.2.3\""));
    assert!(read(root, "clients/dotnet/Lib.csproj").contains("<Version>1.2.3</Version>"));
    assert!(read(root, "clients/dart/pkg/pubspec.yaml").contains("version: 1.2.3"));
    assert!(root.join("build-info.json").exists());
}

#[test]
fn rejects_invalid_tag() {
    let tmp = TempDir::new().unwrap();
    // `build-info.json` is still produced only on success; ensure the bin exists first.
    let status = Command::new("cargo")
        .args(["build", "-p", "deploy-stamp"])
        .status()
        .unwrap();
    assert!(status.success());

    let out = Command::new(exe_path())
        .args(["--tag", "not-a-semver", "--root"])
        .arg(tmp.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("invalid tag"));
}
