plugins {
    id("org.jetbrains.intellij.platform") version "2.2.1"
    kotlin("jvm") version "2.1.0"
}

group = "{{PLUGIN_ID}}"
version = "{{VERSION}}"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("dev.deploytoolkit:deploy-toolkit-intellij:0.1.0")
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
    }
}

tasks {
    patchPluginXml {
        version.set("{{VERSION}}")
    }
}
