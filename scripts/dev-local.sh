#!/bin/sh
# Arranque local: MongoDB portable + backend API.
# Uso: ./scripts/dev-local.sh
# Luego en otra terminal: cd frontend && npm start

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONGO_DIR="$ROOT/.local/mongodb"
DATA_DIR="$ROOT/.local/mongodb-data"
LOG="$ROOT/.local/mongod.log"
MONGO_TGZ="https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.0.4.tgz"

mkdir -p "$MONGO_DIR" "$DATA_DIR"

if [ ! -x "$MONGO_DIR/bin/mongod" ]; then
  echo "→ Descargando MongoDB (solo la primera vez)..."
  curl -L -o /tmp/vs-mongo.tgz "$MONGO_TGZ"
  tar -xzf /tmp/vs-mongo.tgz -C "$MONGO_DIR" --strip-components=1
fi

if ! pgrep -f "$MONGO_DIR/bin/mongod" >/dev/null 2>&1; then
  echo "→ Iniciando MongoDB en localhost:27017..."
  "$MONGO_DIR/bin/mongod" --dbpath "$DATA_DIR" --port 27017 --bind_ip 127.0.0.1 --logpath "$LOG" --fork
  sleep 2
else
  echo "→ MongoDB ya está en marcha."
fi

if lsof -i :8000 >/dev/null 2>&1; then
  echo "→ Backend ya escucha en http://127.0.0.1:8000"
else
  echo "→ Iniciando backend en http://127.0.0.1:8000 ..."
  cd "$ROOT/backend"
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "   Creado backend/.env desde .env.example"
  fi
  exec "$ROOT/backend/venv/bin/python" -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
fi
