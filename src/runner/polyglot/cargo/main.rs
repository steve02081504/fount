use std::env;
use std::path::PathBuf;
use std::process::{Command, exit};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let root = workspace_root();

    let status = if cfg!(windows) {
        Command::new("cmd.exe")
            .arg("/c")
            .arg("path\\fount.bat")
            .args(&args)
            .current_dir(&root)
            .status()
    } else {
        Command::new("sh")
            .arg("path/fount")
            .args(&args)
            .current_dir(&root)
            .status()
    };

    match status {
        Ok(s) => exit(s.code().unwrap_or(1)),
        Err(err) => {
            eprintln!("failed to start fount: {err}");
            exit(1);
        }
    }
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}
