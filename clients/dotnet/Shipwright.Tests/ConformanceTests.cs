// Runs every vector from `schemas/test-vectors.json` through BinaryResolver.Resolve.

using System.Text.Json;
using Shipwright;
using Xunit;

namespace Shipwright.Tests;

public class ConformanceTests
{
    private static string TestVectorsPath()
    {
        var dir = AppContext.BaseDirectory;
        // Walk up to the repo root.
        for (int i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, "schemas", "test-vectors.json");
            if (File.Exists(candidate)) return candidate;
            var parent = Directory.GetParent(dir);
            if (parent is null) break;
            dir = parent.FullName;
        }
        throw new FileNotFoundException("schemas/test-vectors.json not found");
    }

    [Fact]
    public void ResolverPassesEveryVector()
    {
        var doc = JsonDocument.Parse(File.ReadAllText(TestVectorsPath()));
        var vectors = doc.RootElement.GetProperty("vectors");

        var failures = new List<string>();
        foreach (var v in vectors.EnumerateArray())
        {
            var id = v.GetProperty("id").GetString()!;
            try { RunVector(v); }
            catch (MismatchException e) { failures.Add($"{id}: {e.Message}"); }
        }

        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    private static void RunVector(JsonElement vec)
    {
        var input = vec.GetProperty("input");
        var expect = vec.GetProperty("expect");

        var probeMap = new Dictionary<string, ProbedVersion>();
        if (input.TryGetProperty("probe", out var probeJson) && probeJson.ValueKind == JsonValueKind.Object)
        {
            foreach (var kvp in probeJson.EnumerateObject())
            {
                probeMap[kvp.Name] = new ProbedVersion(
                    kvp.Value.GetProperty("name").GetString()!,
                    kvp.Value.GetProperty("version").GetString()!);
            }
        }

        string? expectedName = input.TryGetProperty("expectedName", out var en) ? en.GetString() : null;
        var sources = new List<Source>();
        foreach (var s in input.GetProperty("sources").EnumerateArray())
        {
            var src = WireFormats.SourceFromWire(s.GetString()!);
            if (src is Source sv) sources.Add(sv);
        }

        string binaryName = expectedName ?? probeMap.Values.FirstOrDefault()?.Name ?? "deslop-lsp";

        var envConfig = input.TryGetProperty("envConfig", out var ecj)
            ? new EnvConfig(
                PathVar: ecj.TryGetProperty("pathVar", out var pv) ? pv.GetString() : null,
                DirVar: ecj.TryGetProperty("dirVar", out var dv) ? dv.GetString() : null)
            : new EnvConfig();

        var env = new Dictionary<string, string>();
        if (input.TryGetProperty("env", out var envJson) && envJson.ValueKind == JsonValueKind.Object)
        {
            foreach (var kvp in envJson.EnumerateObject())
                env[kvp.Name] = kvp.Value.GetString() ?? string.Empty;
        }

        var pathEntries = new List<string>();
        if (input.TryGetProperty("path", out var pathJson) && pathJson.ValueKind == JsonValueKind.Array)
        {
            foreach (var p in pathJson.EnumerateArray())
                pathEntries.Add(p.GetString()!);
        }

        PkgmgrConfig? pkg = null;
        if (input.TryGetProperty("pkgmgr", out var pj) && pj.ValueKind == JsonValueKind.Object)
        {
            pkg = new PkgmgrConfig(
                Brew: pj.TryGetProperty("brew", out var b) ? b.GetString() : null,
                Scoop: pj.TryGetProperty("scoop", out var s) ? s.GetString() : null,
                Apt: pj.TryGetProperty("apt", out var a) ? a.GetString() : null,
                Winget: pj.TryGetProperty("winget", out var w) ? w.GetString() : null);
        }
        DotnetToolConfig? dotnetTool = null;
        if (input.TryGetProperty("dotnetTool", out var dj) && dj.ValueKind == JsonValueKind.Object)
        {
            dotnetTool = new DotnetToolConfig(
                Package: dj.GetProperty("package").GetString()!,
                Command: dj.TryGetProperty("command", out var c) ? c.GetString() : null);
        }

        var platform = WireFormats.PlatformFromWire(
            input.TryGetProperty("platform", out var plj) ? plj.GetString() : null);

        var ri = new ResolveInput(
            BinaryName: binaryName,
            ExpectedName: expectedName,
            ExpectedVersion: input.GetProperty("expectedVersion").GetString()!,
            Sources: sources,
            Platform: platform,
            UserSettingPath: input.TryGetProperty("userSettingPath", out var usp) && usp.ValueKind != JsonValueKind.Null
                ? usp.GetString() : null,
            Env: env,
            EnvConfig: envConfig,
            PathEntries: pathEntries,
            BundledDir: input.TryGetProperty("bundledDir", out var bdj) && bdj.ValueKind != JsonValueKind.Null
                ? bdj.GetString() : null,
            CargoBin: input.TryGetProperty("cargoBin", out var cbj) ? cbj.GetString() : null,
            Pkgmgr: pkg,
            DotnetTool: dotnetTool);

        var result = BinaryResolver.Resolve(ri, p => probeMap.TryGetValue(p, out var got) ? got : null);

        AssertMatches(result, expect);
    }

    private static void AssertMatches(Resolution r, JsonElement want)
    {
        string? TryStr(string key) => want.TryGetProperty(key, out var v) && v.ValueKind != JsonValueKind.Null
            ? v.GetString() : null;

        var wantStatus = TryStr("status") ?? throw new MismatchException("expect.status missing");
        if (WireFormats.Wire(r.Status) != wantStatus)
            throw new MismatchException($"status want={wantStatus} got={WireFormats.Wire(r.Status)}");

        var ws = TryStr("source");
        if (ws is not null)
        {
            var got = r.Source is null ? null : WireFormats.Wire(r.Source.Value);
            if (got != ws) throw new MismatchException($"source want={ws} got={got}");
        }
        var wp = TryStr("path");
        if (wp is not null && r.Path != wp) throw new MismatchException($"path want={wp} got={r.Path}");
        var wv = TryStr("version");
        if (wv is not null && r.Version != wv) throw new MismatchException($"version want={wv} got={r.Version}");

        var we = TryStr("errorCode");
        if (we is not null)
        {
            var got = r.ErrorCode is null ? null : WireFormats.Wire(r.ErrorCode.Value);
            if (got != we) throw new MismatchException($"errorCode want={we} got={got}");
        }
        var ww = TryStr("warningCode");
        if (ww is not null)
        {
            var got = r.WarningCode is null ? null : WireFormats.Wire(r.WarningCode.Value);
            if (got != ww) throw new MismatchException($"warningCode want={ww} got={got}");
        }
        var wd = TryStr("deferredCheck");
        if (wd is not null)
        {
            var got = r.DeferredCheck is null ? null : "lsp-initialize";
            if (got != wd) throw new MismatchException($"deferredCheck want={wd} got={got}");
        }

        if (want.TryGetProperty("action", out var actionJson))
        {
            if (r.Action is null) throw new MismatchException("expected action but got none");
            var got = ActionToJson(r.Action);
            var wantStr = actionJson.GetRawText();
            var gotStr = got;
            if (!JsonNormalizedEquals(gotStr, wantStr))
                throw new MismatchException($"action mismatch. want={wantStr} got={gotStr}");
        }
    }

    private static string ActionToJson(PromptAction a)
    {
        return a switch
        {
            PromptAction.PkgmgrInstall pki => JsonSerializer.Serialize(new
            {
                kind = "pkgmgr-install",
                commands = pki.Commands,
            }),
            PromptAction.DotnetToolUpdate dtu => JsonSerializer.Serialize(new
            {
                kind = "dotnet-tool-update",
                command = dtu.Command,
            }),
            _ => "{}",
        };
    }

    private static bool JsonNormalizedEquals(string a, string b)
    {
        using var da = JsonDocument.Parse(a);
        using var db = JsonDocument.Parse(b);
        return JsonElementEquals(da.RootElement, db.RootElement);
    }

    private static bool JsonElementEquals(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind) return false;
        return a.ValueKind switch
        {
            JsonValueKind.Object => a.EnumerateObject().Count() == b.EnumerateObject().Count()
                && a.EnumerateObject().All(p =>
                    b.TryGetProperty(p.Name, out var bv) && JsonElementEquals(p.Value, bv)),
            JsonValueKind.Array => a.GetArrayLength() == b.GetArrayLength()
                && a.EnumerateArray().Zip(b.EnumerateArray(), JsonElementEquals).All(x => x),
            JsonValueKind.String => a.GetString() == b.GetString(),
            JsonValueKind.Number => a.GetRawText() == b.GetRawText(),
            _ => a.GetRawText() == b.GetRawText(),
        };
    }

    private class MismatchException(string message) : Exception(message);
}
