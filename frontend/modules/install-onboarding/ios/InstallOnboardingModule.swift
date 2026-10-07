import ExpoModulesCore
import Foundation

public class InstallOnboardingModule: Module {
  private let lock = NSLock()
  private func directory() throws -> URL {
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    var directory = support.appendingPathComponent("LeafCheckInstallIntro", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
      throw NSError(domain: "InstallOnboarding", code: 1)
    }
    return directory
  }
  public func definition() -> ModuleDefinition {
    Name("InstallOnboarding")
    AsyncFunction("read") { () throws -> String? in
      self.lock.lock()
      defer { self.lock.unlock() }
      let file = try self.directory().appendingPathComponent("completion-v1.json")
      guard FileManager.default.fileExists(atPath: file.path) else { return nil }
      var excludedFile = file
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try excludedFile.setResourceValues(values)
      guard try excludedFile.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
        throw NSError(domain: "InstallOnboarding", code: 2)
      }
      return try String(contentsOf: file, encoding: .utf8)
    }
    AsyncFunction("write") { (record: String) throws -> Void in
      self.lock.lock()
      defer { self.lock.unlock() }
      guard record.utf8.count <= 128,
            let data = record.data(using: .utf8),
            let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            value.count == 2,
            let version = value["version"] as? NSNumber,
            CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1, version.doubleValue == 1,
            let completed = value["completed"] as? NSNumber,
            CFGetTypeID(completed) == CFBooleanGetTypeID(), completed.boolValue else {
        throw NSError(domain: "InstallOnboarding", code: 3)
      }
      var file = try self.directory().appendingPathComponent("completion-v1.json")
      try data.write(to: file, options: .atomic)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try file.setResourceValues(values)
      guard try file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
        throw NSError(domain: "InstallOnboarding", code: 4)
      }
      let handle = try FileHandle(forWritingTo: file)
      defer { try? handle.close() }
      try handle.synchronize()
    }
  }
}
