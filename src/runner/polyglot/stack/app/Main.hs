module Main where

import System.Environment (getArgs)
import System.Info (os)
import System.Exit (ExitCode(..), exitWith)
import System.Process (StdStream(Inherit), CreateProcess(..), createProcess, proc, waitForProcess)

main :: IO ()
main = do
	args <- getArgs
	let (cmd, cmdArgs) =
		if os == "mingw32"
			then ("cmd.exe", ["/c", "run.bat"] ++ args)
			else ("sh", ["run.sh"] ++ args)

	-- Inherit stdio so the fount launcher behaves normally.
	(_, _, _, ph) <- createProcess (proc cmd cmdArgs)
		{ std_in = Inherit
		, std_out = Inherit
		, std_err = Inherit
		, cwd = Just "."
		}

	exitCode <- waitForProcess ph
	exitWith exitCode
