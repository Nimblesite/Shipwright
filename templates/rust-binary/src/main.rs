//! Scaffold entry point. Prints the deploy-toolkit `--version` contract
//! and otherwise runs the real CLI logic (stubbed here).

use deploy_toolkit_cli::{dispatch, BuildInfo, CliError, VersionSpec};
use deploy_toolkit_manifest::{ExecutableKind, Language};
use std::io;

fn main() -> Result<(), CliError> {
    let build = BuildInfo {
        git_sha: option_env!("DEPLOY_TOOLKIT_GIT_SHA"),
        git_dirty: option_env!("DEPLOY_TOOLKIT_GIT_DIRTY").map(|s| s == "true"),
        build_time: option_env!("DEPLOY_TOOLKIT_BUILD_TIME"),
        target: option_env!("DEPLOY_TOOLKIT_TARGET"),
        toolchain: option_env!("DEPLOY_TOOLKIT_TOOLCHAIN"),
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

    if dispatch(std::env::args(), io::stdout().lock(), &spec)? {
        return Ok(());
    }

    // Real program entry point below.
    run()
}

fn run() -> Result<(), CliError> {
    println!("hello from {}", env!("CARGO_PKG_NAME"));
    Ok(())
}
