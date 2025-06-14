# AGS MCP Server Container
FROM node:18-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Set up application directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy pre-built crmpak binary (copied by build.sh)
COPY ./crmpak /usr/local/bin/crmpak
RUN chmod +x /usr/local/bin/crmpak

# Copy application code
COPY dist/ ./dist/

# Create directory for room files
RUN mkdir -p /app/rooms /app/games

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "console.log('AGS MCP Server Health Check')" || exit 1

# Expose port for potential HTTP interface
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Run the MCP server
CMD ["node", "dist/index.js"]