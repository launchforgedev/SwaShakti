import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

SQLITE_DB_PATH = Path(os.getenv("SQLITE_DB_PATH", "women_seller.db"))
if not SQLITE_DB_PATH.is_absolute():
    SQLITE_DB_PATH = BACKEND_DIR / SQLITE_DB_PATH