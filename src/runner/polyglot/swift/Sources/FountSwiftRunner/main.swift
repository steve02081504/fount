import Foundation

let rootDir = FileManager.default.currentDirectoryPath
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

