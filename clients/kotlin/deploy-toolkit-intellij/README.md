# `deploy-toolkit-intellij`

JVM / Kotlin port of the deploy-toolkit resolver. Drop-in for IntelliJ
plugins and any JVM consumer that needs the same binary-resolution
algorithm as the Rust / TypeScript / Dart ports.

- Conformance: passes every vector in `schemas/test-vectors.json`.
- Package: `dev.deploytoolkit:intellij` (generic, not company-branded).
- No IntelliJ platform dependencies at the resolver layer; an optional
  platform adapter lives in a separate module once it exists upstream.

## Usage

```kotlin
import dev.deploytoolkit.*

val resolution = resolve(
  ResolveInput(
    binaryName = "forge-lsp",
    expectedVersion = "1.0.3",
    sources = listOf(Source.UserSetting, Source.Env, Source.Path, Source.Pkgmgr),
    userSettingPath = settings.getOrNull("forge.lspPath"),
    env = System.getenv(),
    envConfig = EnvConfig(pathVar = "FORGE_LSP_PATH"),
    pathEntries = System.getenv("PATH").orEmpty().split(File.pathSeparatorChar),
    pkgmgr = PkgmgrConfig(brew = "nimblesite/tap/forge-lsp", scoop = "nimblesite/forge-lsp"),
  ),
) { path -> probeVersionFlag(path, timeoutMs = 1500) }
```

## Building

```
./gradlew build
./gradlew test
```
