<idea-plugin>
  <id>{{PLUGIN_ID}}</id>
  <name>{{DISPLAY_NAME}}</name>
  <vendor>{{ORG}}</vendor>

  <depends>com.intellij.modules.platform</depends>

  <extensions defaultExtensionNs="com.intellij">
    <postStartupActivity implementation="ShipwrightStartupActivity" />
  </extensions>
</idea-plugin>
