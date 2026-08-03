#!/usr/bin/env bash
# Taskbar progress (Windows Terminal / ConEmu OSC sequences)
taskbar_progress_enabled() { [ -t 1 ]; }
write_taskbar_progress() {
	if ! taskbar_progress_enabled; then return; fi
	if [ -n "${1:-}" ]; then
		printf "\033]9;4;1;%s\007" "$1"
	else
		printf "\033]9;4;3\007"
	fi
}
write_taskbar_progress_clear() { taskbar_progress_enabled && printf "\033]9;4;0\007"; }
write_taskbar_progress_error() { taskbar_progress_enabled && printf "\033]9;4;2;100\007"; }

# Terminal window title via OSC 0
set_title() {
	[ -c /dev/tty ] || return
	printf '\033]0;%s\007' "$1" >/dev/tty 2>/dev/null || true
}
get_title() {
	[ -c /dev/tty ] || {
		echo ""
		return
	}
	(
		set +e
		ss=$(stty -g </dev/tty 2>/dev/null) || {
			echo ""
			exit 0
		}
		trap 'stty "$ss" </dev/tty 2>/dev/null' EXIT
		e=$(printf '\033')
		st=$(printf '\234')
		t=
		stty -echo -icanon min 0 time "${2:-2}" </dev/tty 2>/dev/null || {
			echo ""
			exit 0
		}
		printf '\033[21t' >/dev/tty 2>/dev/null || {
			echo ""
			exit 0
		}
		while true; do
			c=$(dd bs=1 count=1 2>/dev/null </dev/tty) || break
			[ -n "$c" ] || break
			t="$t$c"
			case "$t" in
			$e*$e\\ | $e*$st)
				t=${t%"$e"\\}
				t=${t%"$st"}
				printf '%s\n' "${t#"$e"\][lL]}"
				exit 0
				;;
			$e*) ;;
			*) break ;;
			esac
		done
		echo ""
		exit 1
	) 2>/dev/null
}

trap_taskbar_clear() {
	trap 'write_taskbar_progress_clear' EXIT INT TERM
}

# Restore title + clear taskbar progress on EXIT/INT/TERM
trap_terminal_teardown() {
	local _saved_title
	_saved_title=$(get_title)
	# shellcheck disable=SC2329
	_terminal_teardown() {
		write_taskbar_progress_clear
		set_title "$_saved_title"
	}
	trap '_terminal_teardown' EXIT INT TERM
}

