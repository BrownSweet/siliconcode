ARG SILICONCODE_BASE_PATH=/siliconcode/

FROM node:22.23.2-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG SILICONCODE_BASE_PATH
RUN SILICONCODE_BASE_PATH=${SILICONCODE_BASE_PATH} npm run build

FROM node:22.23.2-trixie-slim AS runtime
ARG SILICONCODE_BASE_PATH
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates curl ripgrep python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/siliconcode
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard/index.html /app/dashboard/app.css /app/dashboard/workbench.html /app/dashboard/workbench.css ./dashboard/
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY --from=build /app/data ./data
COPY --from=build /app/package.json /app/LICENSE /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/LICENSES ./LICENSES
COPY docker/start.mjs docker/healthcheck.mjs ./docker/
RUN printf '#!/bin/sh\nexec node /opt/siliconcode/dist/cli/index.js "$@"\n' > /usr/local/bin/brown \
    && chmod +x /usr/local/bin/brown \
    && mkdir -p /workspace/project/node_modules /workspace/.siliconcode-worktrees /home/node/.siliconcode \
    && chown -R node:node /workspace /home/node/.siliconcode
ENV NODE_ENV=production \
    TERM=xterm-256color \
    SILICONCODE_NO_UPDATE_CHECK=1 \
    SILICONCODE_DISABLE_AUTOUPDATE=1 \
    SILICONCODE_DASHBOARD_HOST=0.0.0.0 \
    SILICONCODE_DASHBOARD_PORT=3100 \
    SILICONCODE_BASE_PATH=${SILICONCODE_BASE_PATH}
USER node
WORKDIR /workspace/project
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "/opt/siliconcode/docker/healthcheck.mjs"]
ENTRYPOINT ["node", "/opt/siliconcode/docker/start.mjs"]
