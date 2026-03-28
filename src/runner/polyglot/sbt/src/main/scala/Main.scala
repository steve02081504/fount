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
	val codePath = Option(codeSource).flatMap(cr => Option(cr.getLocation()))
		.map(l => Paths.get(l.toURI()))
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
