# Shipwright

.NET library for binary resolution and deployment manifest helpers following the Shipwright version contract.

Use this in any .NET application or tool that needs to locate, verify, and launch Shipwright-managed binaries.

## Installation

```bash
dotnet add package Shipwright
```

## Usage

```csharp
using Shipwright;

var resolver = new ManifestResolver();
var result = await resolver.ResolveAsync("shipwright.json");
```

## License

Licensed under either of [MIT](LICENSE) or [Apache-2.0](LICENSE) at your option.

Copyright (c) 2026 NIMBLESITE PTY LTD
