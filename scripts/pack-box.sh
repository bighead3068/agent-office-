#!/bin/bash
# v0.1 nested box is retired. The flat package is pack-office.sh.
exec "$(cd "$(dirname "$0")" && pwd)/pack-office.sh"
