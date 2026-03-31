FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
COPY skills/ skills/
CMD ["node", "dist/index.js"]
