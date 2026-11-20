# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app

# Install native build dependencies for argon2 if needed
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

COPY backend ./backend
RUN DATABASE_URL=postgresql://build:build@localhost/build npx prisma generate --config backend/prisma.config.ts
RUN npm run build -w backend

FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=UTC
ENV PORT=4000
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
RUN apk add --no-cache ffmpeg

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/prisma.config.ts ./backend/prisma.config.ts

USER node
WORKDIR /app/backend

EXPOSE 4000
CMD ["node", "dist/server.js"]
