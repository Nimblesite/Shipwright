# Example: .NET Tool with Shipwright Version Contract

This example shows how to wire the Shipwright version contract into a .NET global tool using the `Shipwright` NuGet library.

The tool emits `--version` and `--version --json` per the Shipwright contract so that IDE extensions and CI pipelines can verify its version before use.

## Run

```bash
dotnet run -- --version
dotnet run -- --version --json
```

## Key pattern

```csharp
using Shipwright;

var spec = new VersionSpec(
    Name: "my-tool",
    Version: toolVersion,
    Kind: "tool",
    Language: "dotnet",
    Product: "my-product",
    Target: RuntimeInformation.FrameworkDescription);

if (VersionManifest.WriteTo(Console.Out, args, spec))
    return 0;
```

Replace `my-tool` and `my-product` with your tool and product ids.
