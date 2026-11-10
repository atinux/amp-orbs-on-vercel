# Vercel publishes this zero-instance daemon to VCR for new orbs.
# The provider daemon keeps its separate, unchanged dependencies.
FROM us-central1-docker.pkg.dev/amp-prod-0/amp-orb/amp-orb:latest

USER root
WORKDIR /opt/orb-tools
COPY package.json package-lock.json ./
# Native agent-browser binaries are included in integrity-checked npm tarballs.
RUN npm ci --omit=dev --ignore-scripts \
    && chmod +x node_modules/agent-browser/bin/agent-browser-linux-*
ENV PATH="/opt/orb-tools/node_modules/.bin:${PATH}"

# Stable Linux amd64 release; verify before installing, never use nightly builds.
RUN curl --fail --location --silent --show-error \
      https://github.com/lightpanda-io/browser/releases/download/1.0.3/lightpanda-x86_64-linux \
      --output /tmp/lightpanda \
    && echo '53eb34da09159dcf8f04865dbfe3e63e9a652062684495aa7ced5ddd7c82e8b0  /tmp/lightpanda' | sha256sum --check --strict \
    && install -m 0755 /tmp/lightpanda /usr/local/bin/lightpanda \
    && rm /tmp/lightpanda
ENV LIGHTPANDA_DISABLE_TELEMETRY=true
ENV AGENT_BROWSER_ENGINE=lightpanda

COPY profile.sh /etc/profile.d/orb-tools.sh

# Orb bootstrap uses a login shell, which can reset the image's PATH.
USER user
ENV HOME="/home/user"
RUN bash -lc 'test "$(command -v agent-browser)" = /opt/orb-tools/node_modules/.bin/agent-browser \
    && test "$AGENT_BROWSER_ENGINE" = lightpanda \
    && test "$LIGHTPANDA_DISABLE_TELEMETRY" = true \
    && agent-browser --version \
    && lightpanda version'
WORKDIR /home/user
