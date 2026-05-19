using System.Reflection;
using Shipwright;

var version = typeof(Program)
    .Assembly
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
    ?.InformationalVersion
    .Split('+', 2)[0] ?? "{{VERSION}}";

var spec = new VersionSpec(
    Name: "{{COMPONENT_ID}}",
    Version: version,
    Kind: "sidecar",
    Language: "dotnet",
    Product: "{{PRODUCT_ID}}");

if (VersionManifest.WriteTo(Console.Out, args, spec))
{
    return 0;
}

// Real sidecar entry point below.
Console.WriteLine("starting {{COMPONENT_ID}}");
return 0;
