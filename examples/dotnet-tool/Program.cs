using System.Reflection;
using Shipwright;

var toolVersion = typeof(Program)
    .Assembly
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
    ?.InformationalVersion
    .Split('+', 2)[0] ?? "0.1.0";

var spec = new VersionSpec(
    Name: "my-tool",
    Version: toolVersion,
    Kind: "tool",
    Language: "dotnet",
    Product: "my-product",
    Target: System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription);

if (VersionManifest.WriteTo(Console.Out, args, spec))
{
    return 0;
}

Console.Out.WriteLine("my-tool");
Console.Out.WriteLine("Usage:");
Console.Out.WriteLine("  my-tool --version");
Console.Out.WriteLine("  my-tool --version --json");
return 0;
