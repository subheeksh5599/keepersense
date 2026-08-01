#!/usr/bin/env bash
# keepersense dev env setup
set -e
cd /home/arch/keepersense
uv venv .venv -q
uv pip install -p .venv/bin/python -q httpx uvicorn pytest
echo "INSTALL_OK"
