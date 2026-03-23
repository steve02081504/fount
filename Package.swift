// swift-tools-version: 5.9
import PackageDescription

let package = Package(
	name: "fount-swift-runner",
	products: [
		.executable(name: "fount", targets: ["FountSwiftRunner"]),
	],
	targets: [
		.executableTarget(
			name: "FountSwiftRunner",
			path: "src/runner/polyglot/swift/Sources/FountSwiftRunner"
		),
	]
)
