#!/bin/bash
# Build the NanoClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

# Read optional vars from parent .env (ignored if absent or unset)
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"
ND_PUSH_SERVICE_URL=""
ND_PUSH_APP_TOKEN=""
if [ -f "$ENV_FILE" ]; then
    ND_PUSH_SERVICE_URL=$(grep -E '^ND_PUSH_SERVICE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'" | head -1)
    ND_PUSH_APP_TOKEN=$(grep -E '^ND_PUSH_APP_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'" | head -1)
fi

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

${CONTAINER_RUNTIME} build \
    --build-arg ND_PUSH_SERVICE_URL="$ND_PUSH_SERVICE_URL" \
    --build-arg ND_PUSH_APP_TOKEN="$ND_PUSH_APP_TOKEN" \
    -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
