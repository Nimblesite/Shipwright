# `shipwright-intellij`

JVM / Kotlin port of the Shipwright resolver. Drop-in for IntelliJ
plugins and any JVM consumer that needs the same binary-resolution
algorithm as the Rust / TypeScript / Dart ports.

- Conformance: passes every vector in `schemas/test-vectors.json`.
- Package: `dev.shipwright:intellij` (generic, not company-branded).
- No IntelliJ platform dependencies at the resolver layer; an optional
  platform adapter lives in a separate module once it exists upstream.

## Usage

```kotlin
import dev.shipwright.*

val resolution = resolve(
  ResolveInput(
    binaryName = "sharplsp-lsp",
    expectedVersion = "1.0.3",
    sources = listOf(Source.UserSetting, Source.Env, Source.Path, Source.Pkgmgr),
    userSettingPath = settings.getOrNull("sharplsp.lspPath"),
    env = System.getenv(),
    envConfig = EnvConfig(pathVar = "SHARPLSP_LSP_PATH"),
    pathEntries = System.getenv("PATH").orEmpty().split(File.pathSeparatorChar),
    pkgmgr = PkgmgrConfig(brew = "nimblesite/tap/sharplsp-lsp", scoop = "nimblesite/sharplsp-lsp"),
  ),
) { path -> probeVersionFlag(path, timeoutMs = 1500) }
```

## Building

```
./gradlew build
./gradlew test
```
