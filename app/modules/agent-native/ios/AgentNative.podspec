Pod::Spec.new do |s|
 s.name = 'AgentNative'
 s.version = '1.0.0'
 s.summary = 'Agent Noticeboard shared storage and ActivityKit bridge'
 s.description = s.summary
 s.license = { :type => 'MIT' }
 s.author = 'Agent Noticeboard'
 s.homepage = 'https://github.com/mattsuthe/agent-noticeboard'
 s.platform = :ios, '26.0'
 s.source = { :git => 'https://github.com/mattsuthe/agent-noticeboard.git' }
 s.static_framework = true
 s.dependency 'ExpoModulesCore'
 s.source_files = '**/*.swift'
 s.swift_version = '5.0'
end
