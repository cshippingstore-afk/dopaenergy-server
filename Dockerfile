# DOPAENERGY Game Server — Docker image
# Build:  docker build -t dopaenergy-server .
# Run:    docker run -p 2567:2567 dopaenergy-server

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 2567
CMD ["node", "dist/index.js"]
