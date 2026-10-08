from pathlib import Path
import sqlite3

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import STORAGE_BACKEND, db
from app.auth import router as auth_router
from app.routers import credit, delivery, discovery, inventory, onboarding

app = FastAPI(title="Women Seller Platform API", version="1.0.0")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(UPLOAD_DIR)), name="static")

# Routers define their own complete /api/... prefixes; don't add another prefix here.
app.include_router(onboarding.router)
app.include_router(inventory.router)
app.include_router(discovery.router)
app.include_router(delivery.router)
app.include_router(auth_router)
app.include_router(credit.router)


@app.get("/")
async def read_root():
    return {"message": "Women Seller Platform Backend API", "storage": STORAGE_BACKEND}


@app.get("/health")
async def health_check():
    try:
        await db.ping()
    except sqlite3.Error:
        return {"status": "degraded", "storage": STORAGE_BACKEND, "detail": "SQLite database is unavailable."}
    return {"status": "ok", "storage": STORAGE_BACKEND}
