# backend/main.py
# Application entry point: lifespan, middleware, router registration, static file mount, logging.

import logging
import logging.config
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# Load environment variables from .env before anything else
load_dotenv()

from backend.api import auth_routes  # noqa: E402
from backend.api import csv_routes  # noqa: E402
from backend.api import record_routes  # noqa: E402
from backend.api import user_routes  # noqa: E402
from backend.database import init_db, seed_default_admin  # noqa: E402

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before the app begins serving requests."""
    logger.info("Starting Yokogawa Maintenance Management System...")
    init_db()
    seed_default_admin()
    logger.info("Startup complete. Application is ready.")
    yield
    logger.info("Application shutting down.")


# ---------------------------------------------------------------------------
# FastAPI application instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Yokogawa Maintenance Data Entry & Management System",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = (
    [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    if allowed_origins_env
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handler — never expose tracebacks to the client
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later."},
    )


# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------

app.include_router(auth_routes.router)
app.include_router(user_routes.router)
app.include_router(record_routes.router)
app.include_router(csv_routes.router)


# ---------------------------------------------------------------------------
# Static files — serve the frontend
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
