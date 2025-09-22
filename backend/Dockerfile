FROM node:18-alpine AS builder
WORKDIR /app
# use pnpm v9 to match workspace lockfile
RUN npm install -g pnpm@9 || true
# copy package manifest and install deps for build (dev+prod)
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

# copy source files only
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./tsconfig.json
# generate prisma client during build (fail build if generation fails)
RUN pnpm prisma generate
RUN pnpm run build

FROM node:18-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# copy package manifest and install production deps in final image to ensure runtime modules exist
COPY package.json ./
RUN npm install -g pnpm@9 || true
# copy node_modules and Prisma generated client from builder to final image
COPY --from=builder /app/node_modules ./node_modules
# copy built artifacts (compiled JS)
COPY --from=builder /app/dist ./dist
# create uploads directory and ensure the runtime user owns it
RUN mkdir -p /app/data/uploads && chown -R app:app /app/data
ENV NODE_ENV=production
USER app
EXPOSE 4000
CMD ["node", "dist/index.js"]
