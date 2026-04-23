//! Runs every vector from `schemas/test-vectors.json` through `resolve`.
//! Non-conforming ports (TS, Kotlin, C#, Dart) must produce matching results.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
// Test binary: asserts harness is allowed to panic on malformed fixtures.

use deploy_toolkit_host::{
    resolve, DotnetToolConfig, EnvConfig, PkgmgrConfig, Platform, ProbedVersion, Resolution,
    ResolveInput, Source,
};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn load_vectors() -> Vec<Value> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = root
        .join("..")
        .join("..")
        .join("schemas")
        .join("test-vectors.json");
    let bytes = fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let doc: Value = serde_json::from_slice(&bytes).expect("parse test-vectors.json");
    doc["vectors"].as_array().expect("vectors[]").clone()
}

fn parse_platform(s: Option<&str>) -> Platform {
    match s.unwrap_or("darwin-arm64") {
        "darwin-arm64" => Platform::DarwinArm64,
        "darwin-x64" => Platform::DarwinX64,
        "linux-x64" => Platform::LinuxX64,
        "linux-arm64" => Platform::LinuxArm64,
        "win32-x64" => Platform::Win32X64,
        "win32-arm64" => Platform::Win32Arm64,
        _ => Platform::All,
    }
}

fn parse_sources(v: &Value) -> Vec<Source> {
    v.as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|s| serde_json::from_value(s.clone()).ok())
        .collect()
}

fn string_map(v: &Value) -> HashMap<String, String> {
    v.as_object()
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, val)| val.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn probed_map(v: &Value) -> HashMap<String, ProbedVersion> {
    let mut out = HashMap::new();
    if let Some(obj) = v.as_object() {
        for (path, p) in obj {
            let _ = out.insert(
                path.clone(),
                ProbedVersion {
                    name: p["name"].as_str().unwrap_or_default().to_string(),
                    version: p["version"].as_str().unwrap_or_default().to_string(),
                },
            );
        }
    }
    out
}

fn derive_binary_name(
    expected_name: Option<&str>,
    probe_map: &HashMap<String, ProbedVersion>,
) -> String {
    if let Some(n) = expected_name {
        return n.to_string();
    }
    probe_map
        .values()
        .next()
        .map_or_else(|| "deslop-lsp".to_string(), |p| p.name.clone())
}

#[test]
fn resolver_passes_every_vector() {
    let mut failures = Vec::new();

    for vec_val in load_vectors() {
        let id = vec_val["id"].as_str().unwrap_or("?").to_string();
        let input = &vec_val["input"];
        let expected = &vec_val["expect"];

        let platform = parse_platform(input.get("platform").and_then(Value::as_str));
        let expected_version = input["expectedVersion"].as_str().unwrap_or("");
        let expected_name = input.get("expectedName").and_then(Value::as_str);
        let sources = parse_sources(&input["sources"]);
        let user_setting_path = input.get("userSettingPath").and_then(Value::as_str);
        let env = string_map(input.get("env").unwrap_or(&Value::Null));
        let env_config: EnvConfig = serde_json::from_value(
            input
                .get("envConfig")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        )
        .unwrap_or_default();
        let path_entries: Vec<String> = input
            .get("path")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let bundled_dir = input.get("bundledDir").and_then(Value::as_str);
        let cargo_bin = input.get("cargoBin").and_then(Value::as_str);
        let probe_map = probed_map(input.get("probe").unwrap_or(&Value::Null));
        let pkgmgr: Option<PkgmgrConfig> = input
            .get("pkgmgr")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let dotnet_tool: Option<DotnetToolConfig> = input
            .get("dotnetTool")
            .and_then(|v| serde_json::from_value(v.clone()).ok());

        let binary_name = derive_binary_name(expected_name, &probe_map);

        let result = resolve(
            &ResolveInput {
                binary_name: &binary_name,
                expected_name,
                expected_version,
                sources: &sources,
                platform,
                user_setting_path,
                env: &env,
                env_config,
                path_entries: &path_entries,
                bundled_dir,
                cargo_bin,
                pkgmgr: pkgmgr.as_ref(),
                dotnet_tool: dotnet_tool.as_ref(),
            },
            |p| probe_map.get(p).cloned(),
        );

        if let Err(msg) = compare(&result, expected) {
            failures.push(format!("vector `{id}`: {msg}\nresult = {result:#?}"));
        }
    }

    assert!(
        failures.is_empty(),
        "resolver conformance failures:\n{}",
        failures.join("\n\n")
    );
}

fn compare(result: &Resolution, expected: &Value) -> Result<(), String> {
    let want_status = expected["status"].as_str().unwrap_or("");
    let got_status = serde_json::to_value(result.status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    if got_status != want_status {
        return Err(format!("status want={want_status} got={got_status}"));
    }

    if let Some(want_source) = expected.get("source").and_then(Value::as_str) {
        let got = result
            .source
            .and_then(|s| serde_json::to_value(s).ok())
            .and_then(|v| v.as_str().map(str::to_string));
        if got.as_deref() != Some(want_source) {
            return Err(format!("source want={want_source} got={got:?}"));
        }
    }

    if let Some(want_path) = expected.get("path").and_then(Value::as_str) {
        if result.path.as_deref() != Some(want_path) {
            return Err(format!("path want={want_path} got={:?}", result.path));
        }
    }

    if let Some(want_version) = expected.get("version").and_then(Value::as_str) {
        if result.version.as_deref() != Some(want_version) {
            return Err(format!(
                "version want={want_version} got={:?}",
                result.version
            ));
        }
    }

    if let Some(want_err) = expected.get("errorCode").and_then(Value::as_str) {
        let got = result
            .error_code
            .clone()
            .and_then(|e| serde_json::to_value(e).ok())
            .and_then(|v| v.as_str().map(str::to_string));
        if got.as_deref() != Some(want_err) {
            return Err(format!("errorCode want={want_err} got={got:?}"));
        }
    }

    if let Some(want_warn) = expected.get("warningCode").and_then(Value::as_str) {
        let got = result
            .warning_code
            .clone()
            .and_then(|w| serde_json::to_value(w).ok())
            .and_then(|v| v.as_str().map(str::to_string));
        if got.as_deref() != Some(want_warn) {
            return Err(format!("warningCode want={want_warn} got={got:?}"));
        }
    }

    if let Some(want_deferred) = expected.get("deferredCheck").and_then(Value::as_str) {
        let got = result
            .deferred_check
            .clone()
            .and_then(|d| serde_json::to_value(d).ok())
            .and_then(|v| v.as_str().map(str::to_string));
        if got.as_deref() != Some(want_deferred) {
            return Err(format!("deferredCheck want={want_deferred} got={got:?}"));
        }
    }

    if let Some(want_action) = expected.get("action") {
        let got = result
            .action
            .as_ref()
            .and_then(|a| serde_json::to_value(a).ok());
        if got.as_ref() != Some(want_action) {
            return Err(format!("action want={want_action} got={got:?}"));
        }
    }

    Ok(())
}
