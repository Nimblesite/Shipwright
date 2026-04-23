# `templates/dotnet-tool-sidecar`

Copy this directory into a .NET sidecar or global tool repo to expose the
deploy-toolkit version contract and publish the sidecar alongside IDE
extensions.

## Files

- `Sidecar.csproj.tpl` — rename to `<ProjectName>.csproj` and substitute
  placeholders.
- `Program.cs` — wires the future `DeployToolkit` helper before real sidecar
  startup.
- `deployment-toolkit.json` — sidecar manifest with dotnet-tool repair data.
- `release.yml` — move to `.github/workflows/release.yml`.

## One-time bootstrap

```sh
export PRODUCT_ID=my-tool
export DISPLAY_NAME="My Tool"
export VERSION=0.1.0
export COMPONENT_ID=my-tool-sidecar
export COMMAND_NAME=my-tool-sidecar
export PACKAGE_ID=MyTool.Sidecar
export ORG=my-org

sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{COMPONENT_ID}}/$COMPONENT_ID/g" \
    -e "s/{{COMMAND_NAME}}/$COMMAND_NAME/g" \
    -e "s/{{PACKAGE_ID}}/$PACKAGE_ID/g" \
    Sidecar.csproj.tpl > "$PACKAGE_ID.csproj"
sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{COMPONENT_ID}}/$COMPONENT_ID/g" \
    Program.cs > Program.cs.tmp
mv Program.cs.tmp Program.cs
rm Sidecar.csproj.tpl
```

`dotnet run -- --version` must print `<component-id> <version>`, and
`dotnet run -- --version --json` must emit the shared version manifest.
