[package]
name = "{{BINARY_NAME}}"
version = "{{VERSION}}"
edition = "2021"
license = "MIT"
description = "{{BINARY_NAME}} — Rust binary using Shipwright."

[[bin]]
name = "{{BINARY_NAME}}"
path = "src/main.rs"

[dependencies]
shipwright = "0.1"
shipwright-manifest = "0.1"

[build-dependencies]
# build.rs itself uses only std.
