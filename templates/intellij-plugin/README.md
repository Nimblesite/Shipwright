# `templates/intellij-plugin`

Copy this directory into an IntelliJ Platform plugin repo to verify bundled
or user-selected binaries before the plugin starts language services.

## Files

- `build.gradle.kts.tpl` — rename to `build.gradle.kts` and substitute
  placeholders.
- `src/main/resources/META-INF/plugin.xml.tpl` — rename to `plugin.xml`.
- `src/main/kotlin/ShipwrightStartupActivity.kt` — startup verification
  hook using `shipwright-intellij`.
- `shipwright.json` — plugin manifest with bundled binary layout.

## One-time bootstrap

```sh
export PRODUCT_ID=my-tool
export DISPLAY_NAME="My Tool"
export VERSION=0.1.0
export PLUGIN_ID=com.example.mytool
export LSP_COMPONENT_ID=my-tool-lsp
export LSP_BINARY_NAME=my-tool-lsp

sed -e "s/{{PRODUCT_ID}}/$PRODUCT_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{PLUGIN_ID}}/$PLUGIN_ID/g" \
    build.gradle.kts.tpl > build.gradle.kts
sed -e "s/{{PLUGIN_ID}}/$PLUGIN_ID/g" \
    -e "s/{{DISPLAY_NAME}}/$DISPLAY_NAME/g" \
    src/main/resources/META-INF/plugin.xml.tpl > src/main/resources/META-INF/plugin.xml
rm build.gradle.kts.tpl src/main/resources/META-INF/plugin.xml.tpl
```

Package runtime binaries under `bin/<platform>` inside the plugin root and
keep `shipwright.json` in the final plugin artifact.
