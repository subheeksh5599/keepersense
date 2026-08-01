#!/usr/bin/env bash
# Vercel build: build the frontend and stage the static output at repo-root/dist
set -e
cd "$(dirname "$0")/../frontend"
npm ci --no-audit --no-fund
npm run build
rm -rf ../dist
cp -r dist ../dist
