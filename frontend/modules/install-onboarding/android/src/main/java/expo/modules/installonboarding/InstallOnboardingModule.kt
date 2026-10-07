package expo.modules.installonboarding

import android.util.AtomicFile
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

class InstallOnboardingModule : Module() {
  private val lock = Any()
  private fun file(): AtomicFile {
    val context = appContext.reactContext ?: throw IllegalStateException("Context unavailable")
    // Excluded by Android from both cloud backup and device transfer; removed on uninstall.
    return AtomicFile(File(context.noBackupFilesDir, "leafcheck-install-intro-v1.json"))
  }
  override fun definition() = ModuleDefinition {
    Name("InstallOnboarding")
    AsyncFunction("read") {
      synchronized(lock) {
        val file = file()
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) null
        else String(file.readFully(), Charsets.UTF_8)
      }
    }
    AsyncFunction("write") { record: String ->
      synchronized(lock) {
        require(record.length <= 128) { "Invalid record" }
        val value = JSONObject(record)
        require(value.length() == 2 && value.get("version") == 1 && value.get("completed") == true) { "Invalid record" }
        val file = file()
        val stream = file.startWrite()
        try {
          stream.write(record.toByteArray(Charsets.UTF_8))
          stream.fd.sync()
          file.finishWrite(stream)
        } catch (error: Throwable) {
          file.failWrite(stream)
          throw error
        }
      }
    }
  }
}
