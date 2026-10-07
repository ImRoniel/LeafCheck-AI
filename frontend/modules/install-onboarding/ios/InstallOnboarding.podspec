Pod::Spec.new do |s|
  s.name = 'InstallOnboarding'
  s.version = '1.0.0'
  s.summary = 'Backup-excluded installation onboarding state'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'LeafCheck AI'
  s.homepage = 'https://github.com/imroniel/Leaf-Check-AI'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
