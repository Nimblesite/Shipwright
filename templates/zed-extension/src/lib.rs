use shipwright_zed::language_server_command;
use zed_extension_api::{self as zed, Result};

struct Extension;

impl zed::Extension for Extension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        language_server_command(
            include_str!("../shipwright.json"),
            "{{LSP_COMPONENT_ID}}",
            language_server_id,
            worktree,
        )
    }
}

zed::register_extension!(Extension);
