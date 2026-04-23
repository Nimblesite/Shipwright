// Binary-side helper: emit the `--version` contract from a .NET binary.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace DeployToolkit;

/// <summary>How a binary was invoked w.r.t. the --version contract.</summary>
public enum VersionMode { NotRequested, Plain, Json }

/// <summary>Declarative spec of what a binary should report.</summary>
public sealed record VersionSpec(
    string Name,
    string Version,
    string Kind,
    string Language,
    string? Product = null,
    string[]? Capabilities = null,
    string? BuildTime = null,
    string? GitSha = null,
    bool? GitDirty = null,
    string? Target = null,
    string? Toolchain = null
);

/// <summary>Emit the deploy-toolkit `--version` contract from a .NET binary.</summary>
public static class VersionManifest
{
    private static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Parse the invocation mode from argv.</summary>
    public static VersionMode FromArgs(IEnumerable<string> args)
    {
        bool hasVersion = false, hasJson = false;
        foreach (var a in args)
        {
            if (a is "--version" or "-V") hasVersion = true;
            else if (a == "--json") hasJson = true;
        }
        return (hasVersion, hasJson) switch
        {
            (true, true) => VersionMode.Json,
            (true, false) => VersionMode.Plain,
            _ => VersionMode.NotRequested,
        };
    }

    /// <summary>Write the plain single-line contract: <c>&lt;name&gt; &lt;semver&gt;</c>.</summary>
    public static void WritePlain(TextWriter w, VersionSpec spec) =>
        w.WriteLine($"{spec.Name} {spec.Version}");

    /// <summary>Write the JSON contract matching `schemas/version-manifest.schema.json`.</summary>
    public static void WriteJson(TextWriter w, VersionSpec spec)
    {
        var payload = new Dictionary<string, object?>
        {
            ["manifestVersion"] = 1,
            ["name"] = spec.Name,
            ["version"] = spec.Version,
            ["kind"] = spec.Kind,
            ["language"] = spec.Language,
        };
        if (spec.BuildTime is not null) payload["buildTime"] = spec.BuildTime;
        if (spec.GitSha is not null) payload["gitSha"] = spec.GitSha;
        if (spec.GitDirty is not null) payload["gitDirty"] = spec.GitDirty;
        if (spec.Target is not null) payload["target"] = spec.Target;
        if (spec.Toolchain is not null) payload["toolchain"] = spec.Toolchain;
        if (spec.Capabilities is { Length: > 0 }) payload["capabilities"] = spec.Capabilities;
        if (spec.Product is not null) payload["product"] = spec.Product;
        w.WriteLine(JsonSerializer.Serialize(payload, Json));
    }

    /// <summary>One-call dispatcher. Returns <c>true</c> if a version flag was handled.</summary>
    public static bool WriteTo(TextWriter w, IEnumerable<string> args, VersionSpec spec)
    {
        switch (FromArgs(args))
        {
            case VersionMode.Plain: WritePlain(w, spec); return true;
            case VersionMode.Json: WriteJson(w, spec); return true;
            default: return false;
        }
    }
}
