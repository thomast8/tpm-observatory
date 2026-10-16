set shell := ["bash", "-euo", "pipefail", "-c"]

setup:
    npm ci

build:
    npm run build

test:
    npm test

check:
    npm run check

qa-mcp:
    npm run qa:mcp

