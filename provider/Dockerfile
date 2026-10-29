# Runs `amp orb provider` as a Vercel Daemon.
# Debian (glibc) base: the Amp CLI binary doesn't run on Alpine.
FROM node:24-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# This daemon can obtain the project's OIDC tokens, so it only runs code pinned
# in package-lock.json. The Amp CLI comes from npm at an exact version, and
# `npm ci` verifies every package against the lockfile's integrity hashes.
# Lifecycle scripts stay off until all packages pass verification; Amp's setup
# script then places the native binary, and `amp --version` fails the build if
# the binary is missing.
ENV AMP_SKIP_UPDATE_CHECK=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --ignore-scripts \
	&& node ./node_modules/@ampcode/cli/install.cjs \
	&& ./node_modules/.bin/amp --version
ENV PATH="/app/node_modules/.bin:${PATH}"
COPY dispatch.mjs ./
RUN chmod +x dispatch.mjs
CMD ["amp", "orb", "provider", "/app/dispatch.mjs"]
