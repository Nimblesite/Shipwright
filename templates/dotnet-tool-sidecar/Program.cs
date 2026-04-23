using DeployToolkit;

var spec = VersionSpec.FromAssembly(
    componentId: "{{COMPONENT_ID}}",
    productId: "{{PRODUCT_ID}}",
    kind: "sidecar",
    language: "dotnet");

if (VersionCommand.TryHandle(args, spec, Console.Out))
{
    return 0;
}

// Real sidecar entry point below.
Console.WriteLine("starting {{COMPONENT_ID}}");
return 0;
