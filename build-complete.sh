#!/bin/bash

set -e

echo "🔧 Building Complete AGS MCP Server Docker Image..."

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "❌ Error: Run this script from the ags-mcp-server directory"
    exit 1
fi

# Build the TypeScript project
echo "📦 Building TypeScript..."
npm run build

# Create temporary directory with AGS source
echo "📋 Preparing AGS source for Docker build..."
TEMP_DIR=$(mktemp -d)
echo "   Using temp directory: $TEMP_DIR"

# Copy AGS source files needed for build
echo "   Copying AGS source files..."
cp -r ../Common "$TEMP_DIR/"
cp -r ../Tools "$TEMP_DIR/"
cp -r ../libsrc "$TEMP_DIR/"
cp -r ../CMake "$TEMP_DIR/"
cp ../CMakeLists.txt "$TEMP_DIR/"

# Create a build context with everything needed
echo "   Creating build context..."
BUILD_CONTEXT=$(mktemp -d)
cp -r . "$BUILD_CONTEXT/app/"
cp -r "$TEMP_DIR"/* "$BUILD_CONTEXT/"

# Create the Dockerfile in the build context
cat > "$BUILD_CONTEXT/Dockerfile" << 'EOF'
# Multi-stage build for AGS MCP Server with embedded tools
# Stage 1: Build AGS tools from source
FROM ubuntu:22.04 as ags-builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Set up build environment
WORKDIR /ags-source

# Copy AGS source code
COPY Common ./Common
COPY Tools ./Tools  
COPY libsrc ./libsrc
COPY CMake ./CMake
COPY CMakeLists.txt ./CMakeLists.txt

# Configure and build AGS tools
RUN mkdir build && cd build && \
    cmake .. \
        -DAGS_BUILD_TOOLS=ON \
        -DAGS_BUILD_ENGINE=ON \
        -DAGS_BUILD_COMPILER=OFF \
        -DCMAKE_BUILD_TYPE=Release \
        -DAGS_USE_LOCAL_ALL_LIBRARIES=OFF && \
    cmake --build . --target crmpak --target crm2ash -- -j$(nproc)

# Verify tools were built
RUN ls -la build/Tools/ && \
    file build/Tools/crmpak && \
    ./build/Tools/crmpak --help

# Stage 2: Runtime image with Node.js and AGS tools
FROM node:18-slim as runtime

# Install runtime dependencies (if any needed)
RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled AGS tools from builder stage
COPY --from=ags-builder /ags-source/build/Tools/crmpak /usr/local/bin/crmpak
COPY --from=ags-builder /ags-source/build/Tools/crm2ash /usr/local/bin/crm2ash

# Make tools executable
RUN chmod +x /usr/local/bin/crmpak /usr/local/bin/crm2ash

# Verify tools work
RUN crmpak --help && crm2ash --help

# Set up application directory
WORKDIR /app

# Copy package files and install dependencies
COPY app/package*.json ./
RUN npm ci --only=production

# Copy application code
COPY app/dist/ ./dist/

# Create directories for room files and games
RUN mkdir -p /app/rooms /app/games

# Create non-root user for security
RUN groupadd -r ags && useradd -r -g ags ags && \
    chown -R ags:ags /app
USER ags

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD crmpak --help > /dev/null || exit 1

# Expose port for potential HTTP interface
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PATH="/usr/local/bin:${PATH}"

# Run the MCP server
CMD ["node", "dist/index.js"]
EOF

# Build Docker image from the prepared context
echo "🐳 Building Docker image with embedded AGS tools..."
cd "$BUILD_CONTEXT"
docker build -t ags-mcp-server:complete .

# Clean up temporary directories
echo "🧹 Cleaning up temporary files..."
rm -rf "$TEMP_DIR" "$BUILD_CONTEXT"

echo "✅ Complete build finished!"
echo "🚀 To run: docker run -p 3000:3000 ags-mcp-server:complete"
echo "🔍 To verify tools: docker run --rm ags-mcp-server:complete crmpak --help"
echo "📦 To publish: docker tag ags-mcp-server:complete your-registry/ags-mcp-server:latest"