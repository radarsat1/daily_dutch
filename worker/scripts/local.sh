#!/bin/bash
export DOCKER_ENV=local

cd "$(dirname "$0")/.."

echo "Starting Local Environment..."
diff ../uv.lock uv.lock >/dev/null 2>&1 || cp ../uv.lock .
docker compose --env-file .env.local up --build
