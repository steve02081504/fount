#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

. "$SCRIPT_DIR/path/fount.sh" $@
RETURN_CODE=$?

if [[ $RETURN_CODE -ne 0 ]] && [[ $RETURN_CODE -ne 255 ]]; then
	read -n 1 -s -r -p "Press any key to continue..."
	echo
fi
exit $RETURN_CODE
