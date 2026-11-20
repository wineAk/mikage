FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY admin ./admin

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "src/index.mjs"]
