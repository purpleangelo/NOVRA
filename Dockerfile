# One image for both `web` and `worker`. Based on the Playwright image so the worker has headless Chromium.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /data/storage
EXPOSE 3000
CMD ["sh", "scripts/start-web.sh"]
