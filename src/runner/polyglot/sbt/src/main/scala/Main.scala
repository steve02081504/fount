import java.io.File
import java.nio.file.Paths
import java.nio.file.Files
@main def main(args: String*): Unit = 
	object PathLocator
	val isWindows = System.getProperty("os.name").toLowerCase.contains("windows")
	val scriptName = if isWindows then
		"run.bat" 
	else 
		"run.sh"
	val codeSource = PathLocator.getClass.getProtectionDomain.getCodeSource
	val codePath = Option(codeSource).map(cr => Paths.get(cr.getLocation().toURI()))
		.getOrElse(Paths.get(".").toAbsolutePath())
	val startDir = if Files.isRegularFile(codePath) then
		codePath.getParent
	else 
		codePath
	val maybeDir = Iterator
		.iterate(startDir)(_.getParent())
		.takeWhile(_ != null)
		.take(16)
		.find(d => Files.exists(d.resolve(scriptName)))
	val scriptDir = maybeDir.getOrElse(Paths.get(System.getProperty("user.dir")))
	val finalDir = scriptDir.toFile()
			// In some runtime environments `getCodeSource` (or `getLocation`) can be null.
			// Fall back to the current working directory in that case.

			// Walk up from class/jar location so we can set the correct working directory
			// (and avoid relying on the JVM current working directory).


		val cmd =
			if (isWindows) Seq("cmd.exe", "/c", "run.bat") ++ args
			else Seq("sh", "run.sh") ++ args

		val exitCode =
			new ProcessBuilder(cmd*)
				.directory(finalDir)
				.inheritIO()
				.start()
				.waitFor()
		sys.exit(exitCode)
