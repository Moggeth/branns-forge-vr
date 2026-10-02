# syntax=docker/dockerfile:1
# Build context must be multiplayer/, not the parent personal workspace.
FROM node:22.20.0-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && test -s dist/index.html
RUN npm prune --omit=dev

FROM node:22.20.0-bookworm-slim AS runtime
ARG TARGETARCH
ARG GODOT_SHA256=cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4
RUN test "${TARGETARCH:-amd64}" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip gosu libfontconfig1 libfreetype6 libx11-6 libxcursor1 libxinerama1 libxrandr2 libxi6 libasound2 libgl1 \
    && curl --fail --location --retry 3 --output /tmp/godot.zip https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/Godot_v4.7.2-stable_linux.x86_64.zip \
    && printf '%s  %s\n' "$GODOT_SHA256" /tmp/godot.zip | sha256sum --check --strict \
    && unzip /tmp/godot.zip -d /tmp/godot \
    && install -m 0755 /tmp/godot/Godot_v4.7.2-stable_linux.x86_64 /usr/local/bin/godot \
    && godot --headless --version \
    && rm -rf /tmp/godot /tmp/godot.zip /var/lib/apt/lists/*
WORKDIR /app
COPY --from=frontend --chown=node:node /app/node_modules ./node_modules
COPY --from=frontend --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json gateway.mjs ./
COPY --chown=node:node server ./server
RUN mkdir -p /data/worlds /data/logs \
    && chown node:node /data /data/worlds /data/logs /app \
    && ln -s /data/logs /app/logs
ENV NODE_ENV=production PORT=8090 SIMULATION_PORT=8081 GODOT_BIN=/usr/local/bin/godot WORLD_DATA_DIR=/data/worlds
EXPOSE 8090
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
# Initialize fresh mounted-volume directories, then permanently drop to uid1000.
ENTRYPOINT ["sh", "-ec", "mkdir -p /data/worlds /data/logs; chown node:node /data/worlds /data/logs; exec gosu node node gateway.mjs"]
