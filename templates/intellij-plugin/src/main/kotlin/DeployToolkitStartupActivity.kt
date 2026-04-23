import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity
import dev.deploytoolkit.intellij.BinaryResolver

class DeployToolkitStartupActivity : StartupActivity.DumbAware {
    override fun runActivity(project: Project) {
        val result = BinaryResolver
            .forPlugin(DeployToolkitStartupActivity::class.java)
            .verifyHost("jetbrains")

        if (!result.ok) {
            result.showNotifications(project)
            return
        }

        // Start LSP, tool windows, services, and actions here.
    }
}
