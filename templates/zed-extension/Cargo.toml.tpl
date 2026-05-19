[package]
name = "{{PRODUCT_ID}}-zed"
version = "{{VERSION}}"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
shipwright-zed = "0.1.0"
zed_extension_api = "0.5"
