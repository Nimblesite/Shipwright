//! Scaffold entry point. Prints the shipwright `--version` contract
//! and otherwise runs the real CLI logic (stubbed here).

use shipwright_cli::{dispatch, BuildInfo, CliError, VersionSpec};
use shipwright_manifest::{ExecutableKind, Language};
use std::io;

fn main() -> Result<(), CliError> {
    let build = BuildInfo {
        git_sha: option_env!("SHIPWRIGHT_GIT_SHA"),
        git_dirty: option_env!("SHIPWRIGHT_GIT_DIRTY").map(|s| s == "true"),
        build_time: option_env!("SHIPWRIGHT_BUILD_TIME"),
        target: option_env!("SHIPWRIGHT_TARGET"),
        toolchain: option_env!("SHIPWRIGHT_TOOLCHAIN"),
    };
    let spec = VersionSpec {
        name: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        kind: ExecutableKind::Cli,
        language: Language::Rust,
        product: Some("{{PRODUCT_ID}}"),
        capabilities: &[],
        build,
    };

    let args: Vec<String> = std::env::args().collect();
    let mut stdout = io::stdout().lock();
    if dispatch(&args, &mut stdout, &spec)? {
        return Ok(());
    }

    // Real program entry point below.
    run()
}

fn run() -> Result<(), CliError> {
    println!("hello from {}", env!("CARGO_PKG_NAME"));
    Ok(())
}
