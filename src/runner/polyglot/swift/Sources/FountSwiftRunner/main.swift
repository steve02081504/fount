import Foundation
let fm = FileManager.default

func repoRootDir(maxParents: Int = 10) -> String {
	// Derive repo root from the executable location, not the process cwd.
	let exeURL = (Bundle.main.executableURL ?? URL(
		fileURLWithPath: CommandLine.arguments[0],
		relativeTo: URL(fileURLWithPath: fm.currentDirectoryPath)
	)).resolvingSymlinksInPath()

	var dirURL = exeURL.deletingLastPathComponent()
	for _ in 0...maxParents {
		let pkgMarker = dirURL.appendingPathComponent("Package.swift")
		let gitMarker = dirURL.appendingPathComponent(".git")
		if fm.fileExists(atPath: pkgMarker.path) || fm.fileExists(atPath: gitMarker.path) {
			return dirURL.path
		}
		dirURL = dirURL.deletingLastPathComponent()
	}

	// Fallback: keep old behaviour if markers aren't found.
	return fm.currentDirectoryPath
}

let rootDir = repoRootDir()
let args = Array(CommandLine.arguments.dropFirst())

#if os(Windows)
let proc = Process()
proc.executableURL = URL(fileURLWithPath: "cmd.exe")
proc.arguments = ["/c", "run.bat"] + args
#else
let proc = Process()
proc.executableURL = URL(fileURLWithPath: "/bin/sh")
proc.arguments = ["run.sh"] + args
#endif

proc.currentDirectoryURL = URL(fileURLWithPath: rootDir)
proc.standardInput = FileHandle.standardInput
proc.standardOutput = FileHandle.standardOutput
proc.standardError = FileHandle.standardError

do {
	try proc.run()
} catch {
	FileHandle.standardError.write(Data("failed to start fount: \(error)\n".utf8))
	exit(1)
}

proc.waitUntilExit()
exit(proc.terminationStatus)

