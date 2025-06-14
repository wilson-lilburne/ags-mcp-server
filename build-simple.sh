#!/bin/bash

set -e

echo "🔧 Building Simple AGS MCP Server Docker Image..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: Run this script from the ags-mcp-server directory"
    exit 1
fi

# Build the TypeScript project
echo "📦 Building TypeScript..."
npm run build

# Check if crmpak exists and copy it
echo "📋 Looking for pre-built AGS tools..."
CRMPAK_LOCATIONS=(
    "../build/Tools/crmpak"
    "../Tools/crmpak"
)

FOUND_TOOLS=false
for location in "${CRMPAK_LOCATIONS[@]}"; do
    if [[ -f "$location" ]]; then
        echo "   ✅ Found crmpak at: $location"
        cp "$location" "./crmpak-binary"
        chmod +x "./crmpak-binary"
        FOUND_TOOLS=true
        break
    fi
done

if [[ "$FOUND_TOOLS" = false ]]; then
    echo "   ⚠️  No pre-built crmpak found. Building a container without embedded tools."
    echo "   💡 You can still use it by mounting host tools:"
    echo "      docker run -v /path/to/ags/build/Tools:/usr/local/bin ags-mcp-server:simple"
fi

# Create Dockerfile
cat > Dockerfile.simple << 'EOF'
FROM node:18-slim

# Install any runtime dependencies
RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy pre-built binary if available
COPY crmpak-binary* /usr/local/bin/
RUN if [ -f /usr/local/bin/crmpak-binary ]; then \
        mv /usr/local/bin/crmpak-binary /usr/local/bin/crmpak && \
        chmod +x /usr/local/bin/crmpak; \
    fi

# Copy application code
COPY dist/ ./dist/

# Create directories
RUN mkdir -p /app/rooms /app/games

# Add non-root user
RUN groupadd -r ags && useradd -r -g ags ags && chown -R ags:ags /app
USER ags

# Health check - only check if crmpak exists
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD if command -v crmpak >/dev/null; then crmpak --help >/dev/null; else echo "No crmpak but server OK"; fi

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
EOF

# Build the image
echo "🐳 Building simple Docker image..."
docker build -f Dockerfile.simple -t ags-mcp-server:simple .

# Clean up
echo "🧹 Cleaning up..."
rm -f ./crmpak-binary Dockerfile.simple

echo "✅ Simple build complete!"

if [[ "$FOUND_TOOLS" = true ]]; then
    echo "🔍 Test: docker run --rm ags-mcp-server:simple crmpak --help"
    echo "🚀 Run: docker run -p 3000:3000 ags-mcp-server:simple"
else
    echo "🔍 Test: docker run --rm -v $(pwd)/../build/Tools:/usr/local/bin ags-mcp-server:simple crmpak --help"
    echo "🚀 Run: docker run -p 3000:3000 -v $(pwd)/../build/Tools:/usr/local/bin ags-mcp-server:simple"
fi

echo ""
echo "📝 For a complete self-contained image, first ensure AGS tools are built:"
echo "   cd .. && cmake . -DAGS_BUILD_TOOLS=ON && cmake --build . --target crmpak"
echo "   Then run this script again."