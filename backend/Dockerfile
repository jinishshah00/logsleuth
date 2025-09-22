FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@7 || true
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:18-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/package.json /app/dist ./
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
USER app
EXPOSE 4000
CMD ["node", "dist/index.js"]
