FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY paramyth/ ./paramyth/
RUN pip install --no-cache-dir '.[studio,tiger,api,rag,docx,hosted]'
COPY web/ ./web/
COPY data/ ./data/
COPY frontend/public/ ./frontend/public/
COPY --from=frontend /build/dist/ ./frontend/dist/
RUN useradd --uid 10001 --create-home paramyth && mkdir -p /data && chown 10001:10001 /data
USER 10001
EXPOSE 8000
CMD ["python", "-m", "paramyth.studio.hosted"]
