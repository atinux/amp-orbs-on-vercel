# Runs `amp orb provider` as a Vercel Daemon.
# Debian (glibc) base: the Amp CLI binary doesn't run on Alpine.
FROM node:24-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl gzip \
	&& rm -rf /var/lib/apt/lists/*
ENV AMP_HOME=/opt/amp
RUN curl -fsSL https://ampcode.com/install.sh | bash \
	&& ln -sf /opt/amp/bin/amp /usr/local/bin/amp \
	&& amp --version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dispatch.mjs ./
RUN chmod +x dispatch.mjs
CMD ["amp", "orb", "provider", "/app/dispatch.mjs"]
