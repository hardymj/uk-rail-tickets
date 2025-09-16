# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

ENV NODE_ENV=production
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install

# Copy server and static site
COPY . .
# Expose and run
EXPOSE 3000
CMD ["npm", "start"]