// Pure .NET port of the deploy-toolkit resolver.
// No I/O: the caller supplies a `probe` function. Public surface mirrors the
// Rust / TypeScript / Dart / Kotlin ports. Conformance: the shared vectors
// in `schemas/test-vectors.json` must pass against this implementation.

namespace DeployToolkit;

public enum Source
{
    UserSetting,
    Env,
    Path,
    Bundled,
    Pkgmgr,
    DotnetTool,
    NpmGlobal,
    CargoBin,
    GithubRelease,
    LspInitialize,
}

public enum Platform
{
    DarwinArm64,
    DarwinX64,
    LinuxX64,
    LinuxArm64,
    Win32X64,
    Win32Arm64,
    All,
}

public enum Status
{
    Ok,
    OkWithWarning,
    Deferred,
    Prompt,
    Error,
}

public enum WarningCode
{
    EnvVersionMismatch,
    BundledVersionDrift,
}

public enum ErrorCode
{
    UserSettingVersionMismatch,
    NoSourceResolved,
    BinaryNameMismatch,
}

public enum DeferredCheckKind
{
    LspInitialize,
}

public static class WireFormats
{
    public static string Wire(Source s) => s switch
    {
        Source.UserSetting => "user-setting",
        Source.Env => "env",
        Source.Path => "path",
        Source.Bundled => "bundled",
        Source.Pkgmgr => "pkgmgr",
        Source.DotnetTool => "dotnet-tool",
        Source.NpmGlobal => "npm-global",
        Source.CargoBin => "cargo-bin",
        Source.GithubRelease => "github-release",
        Source.LspInitialize => "lsp-initialize",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    public static Source? SourceFromWire(string s) => s switch
    {
        "user-setting" => Source.UserSetting,
        "env" => Source.Env,
        "path" => Source.Path,
        "bundled" => Source.Bundled,
        "pkgmgr" => Source.Pkgmgr,
        "dotnet-tool" => Source.DotnetTool,
        "npm-global" => Source.NpmGlobal,
        "cargo-bin" => Source.CargoBin,
        "github-release" => Source.GithubRelease,
        "lsp-initialize" => Source.LspInitialize,
        _ => null,
    };

    public static string Wire(Platform p) => p switch
    {
        Platform.DarwinArm64 => "darwin-arm64",
        Platform.DarwinX64 => "darwin-x64",
        Platform.LinuxX64 => "linux-x64",
        Platform.LinuxArm64 => "linux-arm64",
        Platform.Win32X64 => "win32-x64",
        Platform.Win32Arm64 => "win32-arm64",
        Platform.All => "all",
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };

    public static Platform PlatformFromWire(string? s) => s switch
    {
        "darwin-arm64" => Platform.DarwinArm64,
        "darwin-x64" => Platform.DarwinX64,
        "linux-x64" => Platform.LinuxX64,
        "linux-arm64" => Platform.LinuxArm64,
        "win32-x64" => Platform.Win32X64,
        "win32-arm64" => Platform.Win32Arm64,
        "all" => Platform.All,
        _ => Platform.DarwinArm64,
    };

    public static string ExeSuffix(Platform p) =>
        p is Platform.Win32X64 or Platform.Win32Arm64 ? ".exe" : string.Empty;

    public static string Wire(Status s) => s switch
    {
        Status.Ok => "ok",
        Status.OkWithWarning => "ok-with-warning",
        Status.Deferred => "deferred",
        Status.Prompt => "prompt",
        Status.Error => "error",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    public static string Wire(ErrorCode e) => e switch
    {
        ErrorCode.UserSettingVersionMismatch => "user-setting-version-mismatch",
        ErrorCode.NoSourceResolved => "no-source-resolved",
        ErrorCode.BinaryNameMismatch => "binary-name-mismatch",
        _ => throw new ArgumentOutOfRangeException(nameof(e)),
    };

    public static string Wire(WarningCode w) => w switch
    {
        WarningCode.EnvVersionMismatch => "env-version-mismatch",
        WarningCode.BundledVersionDrift => "bundled-version-drift",
        _ => throw new ArgumentOutOfRangeException(nameof(w)),
    };
}

public sealed record ProbedVersion(string Name, string Version);

public sealed record EnvConfig(string? PathVar = null, string? DirVar = null);

public sealed record PkgmgrConfig(
    string? Brew = null,
    string? Scoop = null,
    string? Apt = null,
    string? Winget = null
);

public sealed record DotnetToolConfig(string Package, string? Command = null);

public sealed record ResolveInput(
    string BinaryName,
    string ExpectedVersion,
    IReadOnlyList<Source> Sources,
    string? ExpectedName = null,
    Platform Platform = Platform.DarwinArm64,
    string? UserSettingPath = null,
    IReadOnlyDictionary<string, string>? Env = null,
    EnvConfig? EnvConfig = null,
    IReadOnlyList<string>? PathEntries = null,
    string? BundledDir = null,
    string? CargoBin = null,
    PkgmgrConfig? Pkgmgr = null,
    DotnetToolConfig? DotnetTool = null
);

public abstract record PromptAction
{
    public sealed record PkgmgrInstall(IReadOnlyDictionary<string, string> Commands) : PromptAction;
    public sealed record DotnetToolUpdate(string Command) : PromptAction;
}

public sealed record ErrorDetails(string Expected, string Found, string At);

public sealed record Resolution(
    Status Status,
    Source? Source = null,
    string? Path = null,
    string? Version = null,
    WarningCode? WarningCode = null,
    ErrorCode? ErrorCode = null,
    ErrorDetails? ErrorDetails = null,
    PromptAction? Action = null,
    DeferredCheckKind? DeferredCheck = null
)
{
    public static Resolution Ok(Source s, string path, string version) =>
        new(Status.Ok, Source: s, Path: path, Version: version);
    public static Resolution OkWarn(Source s, string path, string version, WarningCode code) =>
        new(Status.OkWithWarning, Source: s, Path: path, Version: version, WarningCode: code);
    public static Resolution Error(ErrorCode code, ErrorDetails? details = null) =>
        new(Status.Error, ErrorCode: code, ErrorDetails: details);
    public static Resolution Prompt(PromptAction a) =>
        new(Status.Prompt, Action: a);
    public static Resolution Deferred(Source s, string path, DeferredCheckKind k) =>
        new(Status.Deferred, Source: s, Path: path, DeferredCheck: k);
}

public static class BinaryResolver
{
    public delegate ProbedVersion? Probe(string path);

    public static Resolution Resolve(ResolveInput input, Probe probe)
    {
        foreach (var src in input.Sources)
        {
            var r = TrySource(src, input, probe);
            if (r is not null) return r;
        }
        return Resolution.Error(global::DeployToolkit.ErrorCode.NoSourceResolved);
    }

    private static Resolution? TrySource(Source source, ResolveInput input, Probe probe) => source switch
    {
        Source.UserSetting => TryUserSetting(input, probe),
        Source.Env => TryEnv(input, probe),
        Source.Path => TryPath(input, probe),
        Source.Bundled => TryBundled(input, probe),
        Source.CargoBin => input.CargoBin is null
            ? null
            : Resolution.Deferred(Source.CargoBin, input.CargoBin, DeferredCheckKind.LspInitialize),
        Source.Pkgmgr => input.Pkgmgr is null
            ? null
            : Resolution.Prompt(new PromptAction.PkgmgrInstall(PkgmgrCommands(input.Pkgmgr))),
        Source.DotnetTool => TryDotnetTool(input, probe),
        _ => null,
    };

    private static Resolution? TryUserSetting(ResolveInput input, Probe probe)
    {
        if (input.UserSettingPath is null) return null;
        var got = probe(input.UserSettingPath);
        if (got is null)
        {
            return Resolution.Error(
                global::DeployToolkit.ErrorCode.UserSettingVersionMismatch,
                new ErrorDetails(input.ExpectedVersion, string.Empty, input.UserSettingPath));
        }
        if (!NameMatches(input, got)) return Resolution.Error(global::DeployToolkit.ErrorCode.BinaryNameMismatch);
        return got.Version == input.ExpectedVersion
            ? Resolution.Ok(Source.UserSetting, input.UserSettingPath, got.Version)
            : Resolution.Error(
                global::DeployToolkit.ErrorCode.UserSettingVersionMismatch,
                new ErrorDetails(input.ExpectedVersion, got.Version, input.UserSettingPath));
    }

    private static Resolution? TryEnv(ResolveInput input, Probe probe)
    {
        var path = EnvPath(input);
        if (path is null) return null;
        var got = probe(path);
        if (got is null) return null;
        if (!NameMatches(input, got)) return Resolution.Error(global::DeployToolkit.ErrorCode.BinaryNameMismatch);
        return got.Version == input.ExpectedVersion
            ? Resolution.Ok(Source.Env, path, got.Version)
            : Resolution.OkWarn(Source.Env, path, got.Version, global::DeployToolkit.WarningCode.EnvVersionMismatch);
    }

    private static Resolution? TryPath(ResolveInput input, Probe probe)
    {
        var entries = input.PathEntries ?? Array.Empty<string>();
        foreach (var entry in entries)
        {
            var candidate = JoinBinary(entry, input.BinaryName, input.Platform);
            var got = probe(candidate);
            if (got is null) continue;
            if (!NameMatches(input, got)) return Resolution.Error(global::DeployToolkit.ErrorCode.BinaryNameMismatch);
            if (got.Version == input.ExpectedVersion) return Resolution.Ok(Source.Path, candidate, got.Version);
        }
        return null;
    }

    private static Resolution? TryBundled(ResolveInput input, Probe probe)
    {
        if (input.BundledDir is null) return null;
        var candidate = JoinBinary(input.BundledDir, input.BinaryName, input.Platform);
        var got = probe(candidate);
        if (got is null) return null;
        if (!NameMatches(input, got)) return Resolution.Error(global::DeployToolkit.ErrorCode.BinaryNameMismatch);
        return got.Version == input.ExpectedVersion
            ? Resolution.Ok(Source.Bundled, candidate, got.Version)
            : Resolution.OkWarn(Source.Bundled, candidate, got.Version, global::DeployToolkit.WarningCode.BundledVersionDrift);
    }

    private static Resolution? TryDotnetTool(ResolveInput input, Probe probe)
    {
        if (input.DotnetTool is null) return null;
        var cmd = input.DotnetTool.Command ?? input.DotnetTool.Package;
        var got = probe(cmd);
        if (got is not null && got.Version == input.ExpectedVersion)
            return Resolution.Ok(Source.DotnetTool, cmd, got.Version);
        if (got is not null)
            return Resolution.Prompt(new PromptAction.DotnetToolUpdate(
                $"dotnet tool update -g {input.DotnetTool.Package} --version {input.ExpectedVersion}"));
        return Resolution.Prompt(new PromptAction.DotnetToolUpdate(
            $"dotnet tool install -g {input.DotnetTool.Package} --version {input.ExpectedVersion}"));
    }

    private static bool NameMatches(ResolveInput input, ProbedVersion probed) =>
        probed.Name == (input.ExpectedName ?? input.BinaryName);

    private static string? EnvPath(ResolveInput input)
    {
        var cfg = input.EnvConfig;
        var env = input.Env;
        if (cfg?.PathVar is { } pv && env is not null && env.TryGetValue(pv, out var v)) return v;
        if (cfg?.DirVar is { } dv && env is not null && env.TryGetValue(dv, out var dir))
            return JoinBinary(dir, input.BinaryName, input.Platform);
        return null;
    }

    private static string JoinBinary(string dir, string name, Platform platform)
    {
        var trimmed = dir.TrimEnd('/', '\\');
        return $"{trimmed}/{name}{WireFormats.ExeSuffix(platform)}";
    }

    private static Dictionary<string, string> PkgmgrCommands(PkgmgrConfig pkg)
    {
        var map = new Dictionary<string, string>();
        if (pkg.Brew is { } b)
        {
            foreach (var p in new[] { "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64" })
                map[p] = $"brew install {b}";
        }
        if (pkg.Scoop is { } s)
        {
            map["win32-x64"] = $"scoop install {s}";
            map["win32-arm64"] = $"scoop install {s}";
        }
        return map;
    }
}
