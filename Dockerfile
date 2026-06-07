# Base image
FROM node:20-slim

# Install system dependencies (ffmpeg for merging/conversion, python3 for yt-dlp, curl for downloads)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the Next.js application for production
RUN npm run build

# Expose Next.js port
EXPOSE 5055

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=5055

# Start Next.js server
CMD ["npm", "start"]
