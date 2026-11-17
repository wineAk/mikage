FROM node:22-alpine

WORKDIR /db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrate.mjs ./
COPY migrations ./migrations

CMD ["node", "migrate.mjs"]
