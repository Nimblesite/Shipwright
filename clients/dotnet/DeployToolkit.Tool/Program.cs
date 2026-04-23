using System.Reflection;
using DeployToolkit;

var toolVersion = typeof(Program)
    .Assembly
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
    ?.InformationalVersion
    .Split('+', 2)[0] ?? "0.1.0";

var spec = new VersionSpec(
    Name: "deploy-toolkit-dotnet",
    Version: toolVersion,
    Kind: "tool",
    Language: "dotnet",
    Product: "deployment-toolkit",
    Target: System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription);

if (VersionManifest.WriteTo(Console.Out, args, spec))
{
    return 0;
}

Console.Out.WriteLine("deploy-toolkit-dotnet");
Console.Out.WriteLine("Usage:");
Console.Out.WriteLine("  deploy-toolkit-dotnet --version");
Console.Out.WriteLine("  deploy-toolkit-dotnet --version --json");
return 0;
