set positional-arguments

run *ARGS:
	{{ if os() == "windows" { "cmd /c run.bat" } else { "sh ./run.sh" } }} {{ARGS}}
