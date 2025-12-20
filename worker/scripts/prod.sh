#!/bin/bash
export DOCKER_ENV=prod

cd "$(dirname "$0")/.."

echo "Starting Production Environment..."
diff ../uv.lock uv.lock >/dev/null 2>&1 || cp ../uv.lock .
docker compose --env-file .env.prod --profile prod up -d --build
