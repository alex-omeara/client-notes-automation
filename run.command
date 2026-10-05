#!/bin/sh
set -eu

cd "$(dirname "$0")"
echo "Application starting..."
echo "Quit the application by pressing Ctrl+C."
exec npm run dev
