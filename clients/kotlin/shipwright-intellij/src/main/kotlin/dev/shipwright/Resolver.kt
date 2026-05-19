/// JVM port of the Shipwright resolver.
///
/// Pure: no I/O, caller supplies a [Probe]. Public surface mirrors the
/// Rust / TypeScript / Dart ports so the shared conformance vectors
/// (`schemas/test-vectors.json`) apply unchanged.

package dev.shipwright

// ── Enum wire-forms ─────────────────────────────────────────────────────────

enum class Source(val wire: String) {
    UserSetting("user-setting"),
    Env("env"),
    Path("path"),
    Bundled("bundled"),
    Pkgmgr("pkgmgr"),
    DotnetTool("dotnet-tool"),
    NpmGlobal("npm-global"),
    CargoBin("cargo-bin"),
    GithubRelease("github-release"),
    LspInitialize("lsp-initialize");

    companion object {
        fun fromWire(s: String): Source? = values().firstOrNull { it.wire == s }
    }
}

enum class Platform(val wire: String, val exeSuffix: String) {
    DarwinArm64("darwin-arm64", ""),
    DarwinX64("darwin-x64", ""),
    LinuxX64("linux-x64", ""),
    LinuxArm64("linux-arm64", ""),
    Win32X64("win32-x64", ".exe"),
    Win32Arm64("win32-arm64", ".exe"),
    All("all", "");

    companion object {
        fun fromWire(s: String?): Platform =
            values().firstOrNull { it.wire == s } ?: DarwinArm64
    }
}

enum class Status(val wire: String) {
    Ok("ok"),
    OkWithWarning("ok-with-warning"),
    Deferred("deferred"),
    Prompt("prompt"),
    Error("error");
}

enum class WarningCode(val wire: String) {
    EnvVersionMismatch("env-version-mismatch"),
    BundledVersionDrift("bundled-version-drift");
}

enum class ErrorCode(val wire: String) {
    UserSettingVersionMismatch("user-setting-version-mismatch"),
    NoSourceResolved("no-source-resolved"),
    BinaryNameMismatch("binary-name-mismatch");
}

enum class DeferredCheckKind(val wire: String) {
    LspInitialize("lsp-initialize");
}

// ── Data types ──────────────────────────────────────────────────────────────

data class ProbedVersion(val name: String, val version: String)

/// Caller-supplied probe: `path -> (name, version)` or null when missing.
typealias Probe = (String) -> ProbedVersion?

data class EnvConfig(val pathVar: String? = null, val dirVar: String? = null)

data class PkgmgrConfig(
    val brew: String? = null,
    val scoop: String? = null,
    val apt: String? = null,
    val winget: String? = null,
)

data class DotnetToolConfig(val pkg: String, val command: String? = null)

data class ResolveInput(
    val binaryName: String,
    val expectedVersion: String,
    val sources: List<Source>,
    val expectedName: String? = null,
    val platform: Platform = Platform.DarwinArm64,
    val userSettingPath: String? = null,
    val env: Map<String, String> = emptyMap(),
    val envConfig: EnvConfig = EnvConfig(),
    val pathEntries: List<String> = emptyList(),
    val bundledDir: String? = null,
    val cargoBin: String? = null,
    val pkgmgr: PkgmgrConfig? = null,
    val dotnetTool: DotnetToolConfig? = null,
)

sealed interface PromptAction {
    data class PkgmgrInstall(val commands: Map<String, String>) : PromptAction
    data class DotnetToolUpdate(val command: String) : PromptAction
}

data class Resolution(
    val status: Status,
    val source: Source? = null,
    val path: String? = null,
    val version: String? = null,
    val warningCode: WarningCode? = null,
    val errorCode: ErrorCode? = null,
    val errorDetails: ErrorDetails? = null,
    val action: PromptAction? = null,
    val deferredCheck: DeferredCheckKind? = null,
) {
    data class ErrorDetails(val expected: String, val found: String, val at: String)

    companion object {
        fun ok(source: Source, path: String, version: String) =
            Resolution(Status.Ok, source = source, path = path, version = version)
        fun okWarn(source: Source, path: String, version: String, code: WarningCode) =
            Resolution(Status.OkWithWarning, source = source, path = path, version = version, warningCode = code)
        fun error(code: ErrorCode, details: ErrorDetails? = null) =
            Resolution(Status.Error, errorCode = code, errorDetails = details)
        fun prompt(action: PromptAction) =
            Resolution(Status.Prompt, action = action)
        fun deferred(source: Source, path: String, kind: DeferredCheckKind) =
            Resolution(Status.Deferred, source = source, path = path, deferredCheck = kind)
    }
}

// ── Resolver ────────────────────────────────────────────────────────────────

fun resolve(input: ResolveInput, probe: Probe): Resolution {
    for (source in input.sources) {
        val r = trySource(source, input, probe)
        if (r != null) return r
    }
    return Resolution.error(ErrorCode.NoSourceResolved)
}

private fun trySource(source: Source, input: ResolveInput, probe: Probe): Resolution? =
    when (source) {
        Source.UserSetting -> tryUserSetting(input, probe)
        Source.Env -> tryEnv(input, probe)
        Source.Path -> tryPath(input, probe)
        Source.Bundled -> tryBundled(input, probe)
        Source.CargoBin -> input.cargoBin?.let {
            Resolution.deferred(Source.CargoBin, it, DeferredCheckKind.LspInitialize)
        }
        Source.Pkgmgr -> input.pkgmgr?.let {
            Resolution.prompt(PromptAction.PkgmgrInstall(pkgmgrCommands(it)))
        }
        Source.DotnetTool -> tryDotnetTool(input, probe)
        Source.NpmGlobal, Source.GithubRelease, Source.LspInitialize -> null
    }

private fun tryUserSetting(input: ResolveInput, probe: Probe): Resolution? {
    val path = input.userSettingPath ?: return null
    val got = probe(path) ?: return Resolution.error(
        ErrorCode.UserSettingVersionMismatch,
        Resolution.ErrorDetails(input.expectedVersion, "", path),
    )
    if (!nameMatches(input, got)) return Resolution.error(ErrorCode.BinaryNameMismatch)
    return if (got.version == input.expectedVersion) {
        Resolution.ok(Source.UserSetting, path, got.version)
    } else {
        Resolution.error(
            ErrorCode.UserSettingVersionMismatch,
            Resolution.ErrorDetails(input.expectedVersion, got.version, path),
        )
    }
}

private fun tryEnv(input: ResolveInput, probe: Probe): Resolution? {
    val path = envPath(input) ?: return null
    val got = probe(path) ?: return null
    if (!nameMatches(input, got)) return Resolution.error(ErrorCode.BinaryNameMismatch)
    return if (got.version == input.expectedVersion) {
        Resolution.ok(Source.Env, path, got.version)
    } else {
        Resolution.okWarn(Source.Env, path, got.version, WarningCode.EnvVersionMismatch)
    }
}

private fun tryPath(input: ResolveInput, probe: Probe): Resolution? {
    for (entry in input.pathEntries) {
        val candidate = joinBinary(entry, input.binaryName, input.platform)
        val got = probe(candidate) ?: continue
        if (!nameMatches(input, got)) return Resolution.error(ErrorCode.BinaryNameMismatch)
        if (got.version == input.expectedVersion) {
            return Resolution.ok(Source.Path, candidate, got.version)
        }
    }
    return null
}

private fun tryBundled(input: ResolveInput, probe: Probe): Resolution? {
    val dir = input.bundledDir ?: return null
    val candidate = joinBinary(dir, input.binaryName, input.platform)
    val got = probe(candidate) ?: return null
    if (!nameMatches(input, got)) return Resolution.error(ErrorCode.BinaryNameMismatch)
    return if (got.version == input.expectedVersion) {
        Resolution.ok(Source.Bundled, candidate, got.version)
    } else {
        Resolution.okWarn(Source.Bundled, candidate, got.version, WarningCode.BundledVersionDrift)
    }
}

private fun tryDotnetTool(input: ResolveInput, probe: Probe): Resolution? {
    val dt = input.dotnetTool ?: return null
    val cmd = dt.command ?: dt.pkg
    val got = probe(cmd)
    return when {
        got != null && got.version == input.expectedVersion ->
            Resolution.ok(Source.DotnetTool, cmd, got.version)
        got != null -> Resolution.prompt(
            PromptAction.DotnetToolUpdate(
                "dotnet tool update -g ${dt.pkg} --version ${input.expectedVersion}",
            ),
        )
        else -> Resolution.prompt(
            PromptAction.DotnetToolUpdate(
                "dotnet tool install -g ${dt.pkg} --version ${input.expectedVersion}",
            ),
        )
    }
}

private fun nameMatches(input: ResolveInput, probed: ProbedVersion): Boolean =
    probed.name == (input.expectedName ?: input.binaryName)

private fun envPath(input: ResolveInput): String? {
    input.envConfig.pathVar?.let { key ->
        input.env[key]?.let { return it }
    }
    input.envConfig.dirVar?.let { key ->
        input.env[key]?.let { dir ->
            return joinBinary(dir, input.binaryName, input.platform)
        }
    }
    return null
}

private fun joinBinary(dir: String, name: String, platform: Platform): String {
    var trimmed = dir
    while (trimmed.endsWith('/') || trimmed.endsWith('\\')) {
        trimmed = trimmed.dropLast(1)
    }
    return "$trimmed/$name${platform.exeSuffix}"
}

private fun pkgmgrCommands(pkg: PkgmgrConfig): Map<String, String> {
    val out = linkedMapOf<String, String>()
    pkg.brew?.let { b ->
        for (p in listOf("darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64")) {
            out[p] = "brew install $b"
        }
    }
    pkg.scoop?.let { s ->
        out["win32-x64"] = "scoop install $s"
        out["win32-arm64"] = "scoop install $s"
    }
    return out
}
