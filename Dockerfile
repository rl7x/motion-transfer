FROM node:22-bookworm

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app

RUN groupadd --gid 10001 verifier \
    && useradd --uid 10001 --gid 10001 --home-dir /home/verifier --create-home --shell /usr/sbin/nologin verifier \
    && mkdir -p /output /ms-playwright /opt/google/chrome

COPY package.json package-lock.json ./
RUN npm ci \
    && npx playwright install --with-deps chromium \
    && chrome="$(find /ms-playwright -type f -name chrome ! -path '*headless*' | head -n 1)" \
    && test -n "$chrome" \
    && printf '%s\n' '#!/bin/sh' "exec '$chrome' --no-sandbox --disable-dev-shm-usage --disable-gpu \"\$@\"" > /opt/google/chrome/chrome \
    && chmod 755 /opt/google/chrome/chrome \
    && ln -sf /opt/google/chrome/chrome /usr/local/bin/google-chrome \
    && chmod -R a+rX /ms-playwright

COPY . .
RUN chmod -R a+rX /app

USER 10001:10001
ENTRYPOINT ["node", "/app/hosting/worker.mjs"]
