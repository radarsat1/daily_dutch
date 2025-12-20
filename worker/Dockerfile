# Use an official Python runtime based on Debian 12 "Bookworm"
FROM python:3.12-slim-bookworm

# Install uv directly from the official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Set environment variables
# UV_LINK_MODE=copy: Ensures files are copied (not symlinked) for container stability
# UV_COMPILE_BYTECODE=1: Compiles python files for faster startup
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Copy dependency definition files first (for Docker layer caching)
COPY pyproject.toml uv.lock ./

# Install dependencies
# --frozen: Require uv.lock to be up to date
# --no-dev: Do not install development dependencies
# --no-install-project: Only install dependencies first
RUN uv sync --frozen --no-dev --no-install-project

# Copy the rest of the application code
COPY . .

# Install the project itself
RUN uv sync --frozen --no-dev

# Place the virtual environment in the PATH so we can run `uvicorn` directly
ENV PATH="/app/.venv/bin:$PATH"

# Run the application (Production settings: no reload, 0.0.0.0)
# Matches your request for port 3001
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3001"]
