import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity
import dev.shipwright.intellij.BinaryResolver

class ShipwrightStartupActivity : StartupActivity.DumbAware {
    override fun runActivity(project: Project) {
        val result = BinaryResolver
            .forPlugin(ShipwrightStartupActivity::class.java)
            .verifyHost("jetbrains")

        if (!result.ok) {
            result.showNotifications(project)
            return
        }

        // Start LSP, tool windows, services, and actions here.
    }
}
