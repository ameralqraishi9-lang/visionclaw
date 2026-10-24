// swift-tools-version: 5.9
import PackageDescription

// Test the deterministic question gate without an iPhone or Meta SDK.
let package = Package(
  name: "StudyCore",
  products: [.library(name: "StudyCore", targets: ["StudyCore"])],
  targets: [
    .target(
      name: "StudyCore",
      path: "samples/CameraAccess/CameraAccess/Study",
      exclude: ["StudyAIClient.swift", "StudyGlassesDisplay.swift",
                "StudyQuestionEngine.swift", "StudySessionView.swift"],
      sources: ["StudyQuestionGate.swift"]
    ),
    .testTarget(name: "StudyCoreTests", dependencies: ["StudyCore"], path: "tests/StudyCoreTests")
  ]
)
