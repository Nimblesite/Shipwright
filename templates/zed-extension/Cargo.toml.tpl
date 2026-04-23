[package]
name = "{{PRODUCT_ID}}-zed"
version = "{{VERSION}}"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
deploy-toolkit-zed = "0.1.0"
zed_extension_api = "0.5"
