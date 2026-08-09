#!/usr/bin/env bash
set -euo pipefail

GAME_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_PORT="${PORT:-3080}"
GAME_URL="http://127.0.0.1:${GAME_PORT}"
cd "$GAME_DIR"

open_game() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$GAME_URL" >/dev/null 2>&1 &
  fi
}

if curl -fsS --max-time 2 "$GAME_URL/health" >/dev/null 2>&1; then
  echo "WORLD ORDER уже запущен: $GAME_URL"
  open_game
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Ошибка: Node.js не установлен. Нужна версия 20 или новее."
  read -r -p "Нажмите Enter для выхода..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Первый запуск: устанавливаю зависимости..."
  npm install
fi

echo "Запускаю WORLD ORDER..."
node server.js &
GAME_PID=$!
trap 'kill "$GAME_PID" 2>/dev/null || true' INT TERM EXIT

for _ in {1..30}; do
  if curl -fsS --max-time 1 "$GAME_URL/health" >/dev/null 2>&1; then
    echo "Игра готова: $GAME_URL"
    echo "Не закрывайте это окно, пока играете. Для остановки нажмите Ctrl+C."
    open_game
    wait "$GAME_PID"
    exit $?
  fi
  sleep 0.2
done

echo "Сервер не смог запуститься. Проверьте сообщения выше."
kill "$GAME_PID" 2>/dev/null || true
exit 1
