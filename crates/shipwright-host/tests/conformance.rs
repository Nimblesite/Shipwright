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

use serde_json::Value;
use shipwright_host::{
    resolve, DeferredCheck, DotnetToolConfig, EnvConfig, ErrorCode, PkgmgrConfig, Platform,
    ProbedVersion, PromptAction, Resolution, ResolveInput, Source, Status, WarningCode,
};
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

        let result = resolve_with(
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
            Box::new(|p| probe_map.get(p).cloned()),
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

type Probe<'a> = Box<dyn FnMut(&str) -> Option<ProbedVersion> + 'a>;

fn resolve_with(input: &ResolveInput<'_>, mut probe: Probe<'_>) -> Resolution {
    resolve(input, &mut *probe)
}

fn base_input<'a>(
    sources: &'a [Source],
    env: &'a HashMap<String, String>,
    path_entries: &'a [String],
) -> ResolveInput<'a> {
    ResolveInput {
        binary_name: "forge-lsp",
        expected_name: None,
        expected_version: "1.2.3",
        sources,
        platform: Platform::LinuxX64,
        user_setting_path: None,
        env,
        env_config: EnvConfig::default(),
        path_entries,
        bundled_dir: None,
        cargo_bin: None,
        pkgmgr: None,
        dotnet_tool: None,
    }
}

fn probed(name: &str, version: &str) -> ProbedVersion {
    ProbedVersion {
        name: name.to_string(),
        version: version.to_string(),
    }
}

fn assert_error(result: &Resolution, code: ErrorCode) {
    assert_eq!(result.status, Status::Error);
    assert_eq!(result.error_code, Some(code));
}

#[test]
fn unresolved_sources_are_ignored_before_final_error() {
    // SWR-IDE-RESOLUTION: unsupported resolver sources must not fabricate candidates.
    let sources = [
        Source::NpmGlobal,
        Source::GithubRelease,
        Source::LspInitialize,
    ];
    let env = HashMap::new();
    let path_entries = Vec::new();

    let result = resolve_with(
        &base_input(&sources, &env, &path_entries),
        Box::new(|_| panic!("unresolved sources should not probe")),
    );

    assert_error(&result, ErrorCode::NoSourceResolved);
}

#[test]
fn user_setting_name_mismatch_and_missing_probe_are_errors() {
    // SWR-IDE-ERROR: explicit paths fail precisely and do not fall back.
    let sources = [Source::UserSetting];
    let env = HashMap::new();
    let path_entries = Vec::new();
    let mut input = base_input(&sources, &env, &path_entries);
    input.user_setting_path = Some("/opt/forge/forge-lsp");

    let wrong_name = resolve_with(&input, Box::new(|_| Some(probed("other-lsp", "1.2.3"))));
    assert_error(&wrong_name, ErrorCode::BinaryNameMismatch);

    let missing = resolve_with(&input, Box::new(|_| None));
    assert_error(&missing, ErrorCode::UserSettingVersionMismatch);
    let details = missing
        .error_details
        .as_ref()
        .expect("missing path details");
    assert_eq!(details.expected, "1.2.3");
    assert_eq!(details.found, "");
    assert_eq!(details.at, "/opt/forge/forge-lsp");
}

#[test]
fn env_path_precedes_dir_and_name_mismatch_errors() {
    // SWR-GATE-STARTUP: env path overrides env dir and validates binary identity.
    let sources = [Source::Env];
    let mut env = HashMap::new();
    let _ = env.insert(
        "FORGE_BINARY_PATH".to_string(),
        "/custom/path/forge-lsp".to_string(),
    );
    let _ = env.insert("FORGE_BINARY_DIR".to_string(), "/custom/dir".to_string());
    let path_entries = Vec::new();
    let mut input = base_input(&sources, &env, &path_entries);
    input.env_config = EnvConfig {
        path_var: Some("FORGE_BINARY_PATH".to_string()),
        dir_var: Some("FORGE_BINARY_DIR".to_string()),
    };

    let result = resolve_with(
        &input,
        Box::new(|path| {
            assert_eq!(path, "/custom/path/forge-lsp");
            Some(probed("wrong-lsp", "1.2.3"))
        }),
    );

    assert_error(&result, ErrorCode::BinaryNameMismatch);
}

#[test]
fn env_dir_joins_windows_exe_suffix() {
    // SWR-IDE-RESOLUTION: directory overrides form the platform-specific binary path.
    let sources = [Source::Env];
    let mut env = HashMap::new();
    let _ = env.insert(
        "FORGE_BINARY_DIR".to_string(),
        "C:\\tools\\forge\\".to_string(),
    );
    let path_entries = Vec::new();
    let mut input = base_input(&sources, &env, &path_entries);
    input.platform = Platform::Win32Arm64;
    input.env_config = EnvConfig {
        path_var: None,
        dir_var: Some("FORGE_BINARY_DIR".to_string()),
    };

    let result = resolve_with(
        &input,
        Box::new(|path| {
            assert_eq!(path, "C:\\tools\\forge\\forge-lsp.exe");
            Some(probed("forge-lsp", "1.2.3"))
        }),
    );

    assert_eq!(
        result,
        Resolution::ok(
            Source::Env,
            "C:\\tools\\forge\\forge-lsp.exe".to_string(),
            "1.2.3".to_string()
        )
    );
}

#[test]
fn path_version_mismatch_falls_through_to_no_source() {
    // SWR-IDE-RESOLUTION: PATH candidates are accepted only on exact version.
    let sources = [Source::Path];
    let env = HashMap::new();
    let path_entries = vec!["/usr/local/bin".to_string()];

    let result = resolve_with(
        &base_input(&sources, &env, &path_entries),
        Box::new(|path| {
            assert_eq!(path, "/usr/local/bin/forge-lsp");
            Some(probed("forge-lsp", "9.9.9"))
        }),
    );

    assert_error(&result, ErrorCode::NoSourceResolved);
}

#[test]
fn missing_path_probe_and_missing_env_vars_fall_through() {
    // SWR-GATE-STARTUP: absent probes and unset env vars continue resolution.
    let path_sources = [Source::Path];
    let env = HashMap::new();
    let path_entries = vec!["/missing/bin".to_string()];

    let path_result = resolve_with(
        &base_input(&path_sources, &env, &path_entries),
        Box::new(|path| {
            assert_eq!(path, "/missing/bin/forge-lsp");
            None
        }),
    );
    assert_error(&path_result, ErrorCode::NoSourceResolved);

    let env_sources = [Source::Env];
    let mut input = base_input(&env_sources, &env, &[]);
    input.env_config = EnvConfig {
        path_var: Some("FORGE_BINARY_PATH".to_string()),
        dir_var: Some("FORGE_BINARY_DIR".to_string()),
    };

    let env_result = resolve_with(
        &input,
        Box::new(|_| panic!("unset env vars should not probe")),
    );
    assert_error(&env_result, ErrorCode::NoSourceResolved);
}

#[test]
fn probe_misses_and_absent_optional_configs_fall_through() {
    // SWR-GATE-STARTUP: optional resolver policy and missing probes never invent a binary.
    let env_sources = [Source::Env];
    let mut env = HashMap::new();
    let _ = env.insert(
        "FORGE_BINARY_PATH".to_string(),
        "/missing/env/forge-lsp".to_string(),
    );
    let mut env_input = base_input(&env_sources, &env, &[]);
    env_input.env_config = EnvConfig {
        path_var: Some("FORGE_BINARY_PATH".to_string()),
        dir_var: None,
    };
    let env_miss = resolve_with(
        &env_input,
        Box::new(|path| {
            assert_eq!(path, "/missing/env/forge-lsp");
            None
        }),
    );
    assert_error(&env_miss, ErrorCode::NoSourceResolved);

    let bundled_sources = [Source::Bundled];
    let empty_env = HashMap::new();
    let mut bundled_input = base_input(&bundled_sources, &empty_env, &[]);
    bundled_input.bundled_dir = Some("/ext/bin/linux-x64");
    let bundled_miss = resolve_with(
        &bundled_input,
        Box::new(|path| {
            assert_eq!(path, "/ext/bin/linux-x64/forge-lsp");
            None
        }),
    );
    assert_error(&bundled_miss, ErrorCode::NoSourceResolved);

    let dotnet_sources = [Source::DotnetTool];
    let dotnet_result = resolve_with(
        &base_input(&dotnet_sources, &empty_env, &[]),
        Box::new(|_| panic!("absent dotnet config should not probe")),
    );
    assert_error(&dotnet_result, ErrorCode::NoSourceResolved);

    let pkgmgr_sources = [Source::Pkgmgr];
    let brew_only = PkgmgrConfig {
        brew: Some("example/tap/forge-lsp".to_string()),
        ..PkgmgrConfig::default()
    };
    let mut pkgmgr_input = base_input(&pkgmgr_sources, &empty_env, &[]);
    pkgmgr_input.pkgmgr = Some(&brew_only);
    let result = resolve_with(
        &pkgmgr_input,
        Box::new(|_| panic!("pkgmgr prompt should not probe")),
    );
    let Some(PromptAction::PkgmgrInstall { commands }) = result.action else {
        panic!("expected pkgmgr prompt action: {result:#?}");
    };

    assert_eq!(commands.len(), 4);
    assert_eq!(
        commands.get("darwin-arm64").map(String::as_str),
        Some("brew install example/tap/forge-lsp")
    );
    assert!(!commands.contains_key("win32-x64"));
}

#[test]
fn bundled_name_mismatch_is_error() {
    // SWR-IDE-ERROR: bundled candidates still enforce binary identity.
    let sources = [Source::Bundled];
    let env = HashMap::new();
    let path_entries = Vec::new();
    let mut input = base_input(&sources, &env, &path_entries);
    input.bundled_dir = Some("/ext/bin/linux-x64");

    let result = resolve_with(
        &input,
        Box::new(|path| {
            assert_eq!(path, "/ext/bin/linux-x64/forge-lsp");
            Some(probed("forge-helper", "1.2.3"))
        }),
    );

    assert_error(&result, ErrorCode::BinaryNameMismatch);
}

#[test]
fn pkgmgr_prompt_variants_include_only_configured_managers() {
    // SWR-GATE-STARTUP: package managers produce commands but are never run.
    let sources = [Source::Pkgmgr];
    let env = HashMap::new();
    let path_entries = Vec::new();
    let scoop_only = PkgmgrConfig {
        scoop: Some("forge/forge-lsp".to_string()),
        ..PkgmgrConfig::default()
    };
    let mut input = base_input(&sources, &env, &path_entries);
    input.pkgmgr = Some(&scoop_only);

    let result = resolve_with(
        &input,
        Box::new(|_| panic!("pkgmgr prompt should not probe")),
    );
    let Some(PromptAction::PkgmgrInstall { commands }) = result.action else {
        panic!("expected pkgmgr prompt action: {result:#?}");
    };

    assert_eq!(result.status, Status::Prompt);
    assert_eq!(commands.len(), 2);
    assert_eq!(
        commands.get("win32-x64").map(String::as_str),
        Some("scoop install forge/forge-lsp")
    );
    assert_eq!(
        commands.get("win32-arm64").map(String::as_str),
        Some("scoop install forge/forge-lsp")
    );
    assert!(!commands.contains_key("darwin-arm64"));
}

#[test]
fn dotnet_tool_default_command_success_and_install_prompt() {
    // SWR-IDE-DOTNET-RUNTIME: dotnet tool prompts distinguish update from install.
    let sources = [Source::DotnetTool];
    let env = HashMap::new();
    let path_entries = Vec::new();
    let default_tool = DotnetToolConfig {
        package: "Forge.Sidecar.CSharp".to_string(),
        command: None,
    };
    let mut input = base_input(&sources, &env, &path_entries);
    input.dotnet_tool = Some(&default_tool);

    let ok = resolve_with(
        &input,
        Box::new(|command| {
            assert_eq!(command, "Forge.Sidecar.CSharp");
            Some(probed("Forge.Sidecar.CSharp", "1.2.3"))
        }),
    );
    assert_eq!(
        ok,
        Resolution::ok(
            Source::DotnetTool,
            "Forge.Sidecar.CSharp".to_string(),
            "1.2.3".to_string()
        )
    );

    let install = resolve_with(&input, Box::new(|_| None));
    assert_eq!(install.status, Status::Prompt);
    assert_eq!(
        install.action,
        Some(PromptAction::DotnetToolUpdate {
            command: "dotnet tool install -g Forge.Sidecar.CSharp --version 1.2.3".to_string()
        })
    );
}

#[test]
fn resolution_constructors_populate_distinct_payloads() {
    // SWR-IDE-ERROR: constructor payloads are stable across resolver ports.
    let ok = Resolution::ok(
        Source::Env,
        "/bin/forge-lsp".to_string(),
        "1.2.3".to_string(),
    );
    assert_eq!(ok.status, Status::Ok);
    assert_eq!(ok.source, Some(Source::Env));
    assert_eq!(ok.path.as_deref(), Some("/bin/forge-lsp"));

    let warn = Resolution::ok_warn(
        Source::Bundled,
        "/bundle/forge-lsp".to_string(),
        "1.2.2".to_string(),
        WarningCode::BundledVersionDrift,
    );
    assert_eq!(warn.status, Status::OkWithWarning);
    assert_eq!(warn.warning_code, Some(WarningCode::BundledVersionDrift));

    let prompt = Resolution::prompt(PromptAction::DotnetToolUpdate {
        command: "dotnet tool update -g Forge --version 1.2.3".to_string(),
    });
    assert_eq!(prompt.status, Status::Prompt);
    assert!(prompt.action.is_some());

    let deferred = Resolution::deferred(
        Source::CargoBin,
        "/home/user/.cargo/bin/forge-lsp".to_string(),
        DeferredCheck::LspInitialize,
    );
    assert_eq!(deferred.status, Status::Deferred);
    assert_eq!(deferred.deferred_check, Some(DeferredCheck::LspInitialize));
}
