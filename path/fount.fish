#!/usr/bin/env fish

function install_package
    if type -q pkg
        pkg install -y $argv
    else if type -q apt-get
        if type -q sudo
            sudo apt-get update
            sudo apt-get install -y $argv
        else
            apt-get update
            apt-get install -y $argv
        end
    else if type -q brew
        brew install $argv
    else if type -q pacman
        if type -q sudo
            sudo pacman -Syy
            sudo pacman -S --needed --noconfirm $argv
        else
            pacman -Syy
            pacman -S --needed --noconfirm $argv
        end
    else if type -q dnf
        if type -q sudo
            sudo dnf install -y $argv
        else
            dnf install -y $argv
        end
    else if type -q zypper
        if type -q sudo
            sudo zypper install -y --no-confirm $argv
        else
            zypper install -y --no-confirm $argv
        end
    else if type -q apk
        apk add --update $argv
    else
        echo "无法安装 $argv"
        exit 1
    end
end

set SCRIPT_DIR (dirname (realpath $argv[0]))
set FOUNT_DIR (dirname $SCRIPT_DIR)
set IN_DOCKER 0
if test -f "/.dockerenv" -o (grep -q 'docker\|containerd' /proc/1/cgroup)
    set IN_DOCKER 1
end
set IN_TERMUX 0
if test -d "/data/data/com.termux"
    set IN_TERMUX 1
end

function run_deno
    set deno_args $argv
    set deno_cmd "deno"  # Default

    if test $IN_TERMUX -eq 1
        if type -q deno.glibc.sh
            set deno_cmd "deno.glibc.sh"
        else if type -q glibc-runner
            set deno_cmd "glibc-runner (which deno)"
        else
            echo "Warning: glibc-runner and deno.glibc.sh not found, falling back to plain deno in Termux (may not work)." >&2
        end
    end
    exec $deno_cmd $deno_args
end

function patch_deno
    set deno_bin (which deno)
    
    if test -z "$deno_bin"
        echo "Error: Deno executable not found before patching. Cannot patch." >&2
        return 1
    end

    if not type -q patchelf
        echo "patchelf is not installed. Please install it."
        return 1
    end

    # 使用更通用的 rpath 和正确的 interpreter 路径
    patchelf --set-rpath '${ORIGIN}/../glibc/lib' --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" $deno_bin

    if test $status -ne 0
        echo "Error: Failed to patch Deno executable with patchelf." >&2
        return 1
    else
        # Create wrapper script (Termux)
        mkdir -p ~/.deno/bin
        echo '#!/usr/bin/env sh
_oldpwd="${PWD}"
_dir="$(dirname "${0}")"
cd "${_dir}"
if not test -h "deno"
    mv -f "deno" "deno.orig"
    ln -sf "deno.glibc.sh" "deno"
end
cd "${_oldpwd}"
LD_PRELOAD= exec "${_dir}/deno.orig" $argv' > ~/.deno/bin/deno.glibc.sh
        chmod u+x ~/.deno/bin/deno.glibc.sh
    end
    return 0
end

# Main script logic

if test (count $argv) -gt 0 -a $argv[1] = 'remove'
    echo "removing fount..."

    # Remove fount from PATH in .profile
    if test -f "$HOME/.profile"
        sed -i '/export PATH="\$PATH:'"$FOUNT_DIR/path"'"/d' "$HOME/.profile"
    end

    # Remove fount from current PATH
    set PATH (string split ':' $PATH | grep -v "$FOUNT_DIR/path" | string join ':')

    # Remove fount installation directory
    rm -rf "$FOUNT_DIR"

    echo "fount uninstallation complete."
    exit 0
end

if not type -q fount.sh
    if test -f "$HOME/.profile"
        if not grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.profile"
            echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.profile"
        end
    else
        echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.profile"
    end
    set PATH $PATH:$FOUNT_DIR/path
end

if test (count $argv) -gt 0 -a $argv[1] = 'background'
    if type -q fount.sh
        nohup fount.sh $argv[2..-1] > /dev/null 2>&1 &
        exit 0
    else
        echo "this script requires fount installed"
        exit 1
    end
end

if not type -q git
    install_package git
end

# Git clone and update logic here would follow

# If Deno is missing or needs to be installed
if test ($IN_TERMUX -eq 0 -a -z (type -q deno)) -o ($IN_TERMUX -eq 1 -a not -f ~/.deno/bin/deno.glibc.sh)
    # Install Deno logic
end

# Git pull and update logic for fount repo
# If running in Docker, skip some parts of the installation

# Installing dependencies
if not -d "$FOUNT_DIR/node_modules" -o (count $argv) -gt 0 -a $argv[1] = 'init'
    echo "Installing dependencies..."
    set -e
    run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
    run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "shutdown"
    set +e
end

function run
    if test (count $argv) -gt 0 -a $argv[1] = 'debug'
        set newargs $argv[2..-1]
        run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" $newargs
    else
        run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" $argv
    end
end

if test (count $argv) -gt 0 -a $argv[1] = 'init'
    exit 0
else if test (count $argv) -gt 0 -a $argv[1] = 'keepalive'
    set runargs $argv[2..-1]
    run $runargs
    while test $status
        run
    end
else
    run $argv
end

exit $status
