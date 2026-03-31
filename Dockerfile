FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm pkg delete scripts.prepare && npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
COPY skills/ skills/
CMD ["node", "dist/index.js"]
