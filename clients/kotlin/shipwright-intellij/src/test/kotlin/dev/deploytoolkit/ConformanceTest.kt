/// Runs every vector from `schemas/test-vectors.json` through [resolve].

package dev.deploytoolkit

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

class ConformanceTest {

    @Test
    fun resolverPassesEveryVector() {
        val vectorsFile = File("../../../schemas/test-vectors.json").also {
            check(it.exists()) { "missing ${it.absolutePath}" }
        }
        val root = Json.parseToJsonElement(vectorsFile.readText()).jsonObject
        val vectors = root["vectors"]!!.jsonArray
        val failures = mutableListOf<String>()
        for (raw in vectors) {
            val v = raw.jsonObject
            val id = v["id"]!!.jsonPrimitive.content
            try {
                runVector(v)
            } catch (e: Mismatch) {
                failures += "$id: ${e.message}"
            }
        }
        assertEquals(emptyList(), failures, failures.joinToString("\n"))
    }

    private class Mismatch(msg: String) : Exception(msg)

    private fun runVector(v: JsonObject) {
        val input = v["input"]!!.jsonObject
        val expect = v["expect"]!!.jsonObject

        val probeMap = mutableMapOf<String, ProbedVersion>()
        val probeJson = input["probe"]
        if (probeJson is JsonObject) {
            for ((k, value) in probeJson) {
                val o = value.jsonObject
                probeMap[k] = ProbedVersion(
                    o["name"]!!.jsonPrimitive.content,
                    o["version"]!!.jsonPrimitive.content,
                )
            }
        }

        val expectedName = input["expectedName"]?.jsonPrimitive?.contentOrNull
        val sources = input["sources"]!!.jsonArray.mapNotNull {
            Source.fromWire(it.jsonPrimitive.content)
        }
        val binaryName = expectedName ?: probeMap.values.firstOrNull()?.name ?: "deslop-lsp"

        val envConfigJson = input["envConfig"]?.jsonObject
        val envConfig = EnvConfig(
            pathVar = envConfigJson?.get("pathVar")?.jsonPrimitive?.contentOrNull,
            dirVar = envConfigJson?.get("dirVar")?.jsonPrimitive?.contentOrNull,
        )

        val pathEntries = input["path"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
        val env = input["env"]?.jsonObject?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap()

        val pkgmgrJson = input["pkgmgr"]?.jsonObject
        val pkgmgr = pkgmgrJson?.let {
            PkgmgrConfig(
                brew = it["brew"]?.jsonPrimitive?.contentOrNull,
                scoop = it["scoop"]?.jsonPrimitive?.contentOrNull,
                apt = it["apt"]?.jsonPrimitive?.contentOrNull,
                winget = it["winget"]?.jsonPrimitive?.contentOrNull,
            )
        }
        val dotnetJson = input["dotnetTool"]?.jsonObject
        val dotnetTool = dotnetJson?.let {
            DotnetToolConfig(
                pkg = it["package"]!!.jsonPrimitive.content,
                command = it["command"]?.jsonPrimitive?.contentOrNull,
            )
        }

        val platform = Platform.fromWire(input["platform"]?.jsonPrimitive?.contentOrNull)

        val result = resolve(
            ResolveInput(
                binaryName = binaryName,
                expectedName = expectedName,
                expectedVersion = input["expectedVersion"]!!.jsonPrimitive.content,
                sources = sources,
                platform = platform,
                userSettingPath = input["userSettingPath"]?.let {
                    if (it is JsonNull) null else it.jsonPrimitive.contentOrNull
                },
                env = env,
                envConfig = envConfig,
                pathEntries = pathEntries,
                bundledDir = input["bundledDir"]?.let {
                    if (it is JsonNull) null else it.jsonPrimitive.contentOrNull
                },
                cargoBin = input["cargoBin"]?.jsonPrimitive?.contentOrNull,
                pkgmgr = pkgmgr,
                dotnetTool = dotnetTool,
            ),
        ) { p -> probeMap[p] }

        expectMatches(result, expect)
    }

    private fun expectMatches(r: Resolution, want: JsonObject) {
        fun str(key: String): String? = want[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }

        val wantStatus = str("status") ?: throw Mismatch("expected.status missing")
        if (r.status.wire != wantStatus) throw Mismatch("status want=$wantStatus got=${r.status.wire}")

        str("source")?.let { if (r.source?.wire != it) throw Mismatch("source want=$it got=${r.source?.wire}") }
        str("path")?.let { if (r.path != it) throw Mismatch("path want=$it got=${r.path}") }
        str("version")?.let { if (r.version != it) throw Mismatch("version want=$it got=${r.version}") }
        str("errorCode")?.let { if (r.errorCode?.wire != it) throw Mismatch("errorCode want=$it got=${r.errorCode?.wire}") }
        str("warningCode")?.let { if (r.warningCode?.wire != it) throw Mismatch("warningCode want=$it got=${r.warningCode?.wire}") }
        str("deferredCheck")?.let { if (r.deferredCheck?.wire != it) throw Mismatch("deferredCheck want=$it got=${r.deferredCheck?.wire}") }

        val wantAction = want["action"]?.jsonObject
        if (wantAction != null) {
            val gotAction = actionToJson(r.action) ?: throw Mismatch("expected action but got none")
            if (gotAction != wantAction) throw Mismatch("action mismatch. want=$wantAction got=$gotAction")
        }
    }

    private fun actionToJson(a: PromptAction?): JsonObject? = when (a) {
        null -> null
        is PromptAction.PkgmgrInstall -> JsonObject(
            mapOf(
                "kind" to JsonPrimitive("pkgmgr-install"),
                "commands" to JsonObject(a.commands.mapValues { JsonPrimitive(it.value) }),
            ),
        )
        is PromptAction.DotnetToolUpdate -> JsonObject(
            mapOf(
                "kind" to JsonPrimitive("dotnet-tool-update"),
                "command" to JsonPrimitive(a.command),
            ),
        )
    }
}
