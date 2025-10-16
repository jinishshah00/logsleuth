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
# Ensure TLS certs are available for outbound HTTPS/SSL connections (Supabase requires SSL)
RUN apk add --no-cache ca-certificates openssl && update-ca-certificates
RUN addgroup -S app && adduser -S app -G app
# copy package manifest and install production deps in final image to ensure runtime modules exist
COPY package.json ./
RUN npm install -g pnpm@9 || true
# copy node_modules and Prisma generated client from builder to final image
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
# copy built artifacts (compiled JS)
COPY --from=builder /app/dist ./dist
# create uploads directory and ensure the runtime user owns relevant runtime files
RUN mkdir -p /app/data/uploads \
	&& chown -R app:app /app/data \
	# fix ownership for copied runtime files so the non-root runtime user can write during prisma generate
	&& chown -R app:app /app/node_modules /app/prisma /app/dist || true
ENV NODE_ENV=production
USER app
EXPOSE 4000
# Run Prisma migrations on container start, then launch the server
CMD ["sh", "-c", "npx --yes prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
