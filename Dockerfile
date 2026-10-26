# ---------- 1) build the Expo web bundle ----------
FROM node:20-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm i
COPY frontend/ ./
RUN npm run web:build
# Assumes web:build outputs to frontend/dist (Expo's default)

# ---------- 2) Python runtime ----------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

# Repo-root layout, so main.py's REPO (= parent of backend/) resolves to /app
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY data/ data/
COPY --from=web /app/frontend/dist frontend/dist


EXPOSE 8000
# Render sets $PORT; falls back to 8000 locally
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]