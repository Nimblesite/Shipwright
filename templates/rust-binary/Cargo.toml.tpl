[package]
name = "{{BINARY_NAME}}"
version = "{{VERSION}}"
edition = "2021"
license = "MIT OR Apache-2.0"
description = "{{BINARY_NAME}} — Rust binary using deploy-toolkit."

[[bin]]
name = "{{BINARY_NAME}}"
path = "src/main.rs"

[dependencies]
deploy-toolkit-cli = "0.1"
deploy-toolkit-manifest = "0.1"

[build-dependencies]
# build.rs itself uses only std.
