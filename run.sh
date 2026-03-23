#!/bin/sh

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

# 1. 如果参数为空，则用默认参数打开 fount
if [ "$#" -eq 0 ]; then
	/bin/sh "$SCRIPT_DIR/path/fount" open keepalive
else
	/bin/sh "$SCRIPT_DIR/path/fount" "$@"
fi

# 2. 捕获退出码，并为非正常退出提供用户交互
RETURN_CODE=$?
if [ "$RETURN_CODE" -ne 0 ] && [ "$RETURN_CODE" -ne 255 ]; then
	echo "Press Enter to continue..."
	read -r _
fi

exit "$RETURN_CODE"
