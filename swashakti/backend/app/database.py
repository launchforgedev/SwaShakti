import asyncio
from contextlib import contextmanager
import json
import re
import secrets
import sqlite3
import threading
from pathlib import Path
from typing import Any

from app.config import SQLITE_DB_PATH


class ObjectId(str):
    def __new__(cls, value: str | None = None):
        value = value or secrets.token_hex(12)
        if not cls.is_valid(value):
            raise ValueError("Invalid ID")
        return super().__new__(cls, value.lower())

    @staticmethod
    def is_valid(value:any)->bool:
        return isinstance(value , str) and re.fullmatch(r"[0-9a-fA-F]{24}", value) is not None

class InsertOneResult:
    def __init__(self, inserted_id: ObjectId):
        self.inserted_id = inserted_id


class UpdateResult:
    def __init__(self, matched_count: int, modified_count: int):
        self.matched_count = matched_count
        self.modified_count = modified_count


class DeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count


class Cursor:
    def __init__(self, collection: "Collection", query: dict):
        self.collection = collection
        self.query = query

    async def to_list(self, length: int | None = None) -> list[dict]:
        return await asyncio.to_thread(self.collection._find, self.query, length)

class AggregateCursor:
    def __init__(self, collection: "Collection", pipeline: list[dict]):
        self.collection = collection
        self.pipeline = pipeline

    async def to_list(self, length: int | None = None) -> list[dict]:
        return await asyncio.to_thread(self.collection._aggregate, self.pipeline, length)

class Collection:
    def __init__(self, database: "Database", name: str):
        self.database = database
        self.name = name

    async def insert_one(self, document: dict) -> InsertOneResult:
        return await asyncio.to_thread(self._insert_one, document)

    def _insert_one(self, document: dict) -> InsertOneResult:
        saved = dict(document)
        document_id = ObjectId(str(saved.get("_id") or ObjectId()))
        saved["_id"] = str(document_id)
        payload = _json_dump(saved)
        with self.database.lock, self.database.connect() as connection:
            connection.execute(
                "INSERT INTO documents (collection, document_id, payload) VALUES (?, ?, ?)",
                (self.name, str(document_id), payload),
            )
        return InsertOneResult(document_id)

    async def find_one(self, query: dict, projection: dict | None = None) -> dict | None:
        return await asyncio.to_thread(self._find_one, query, projection)

    def _find_one(self, query: dict, projection: dict | None) -> dict | None:
        rows = self._find(query, 1)
        return _project(rows[0], projection) if rows else None

    def find(self, query: dict | None = None, projection: dict | None = None) -> Cursor:
        # Current routes only call to_list() without a projection. Keep support
        # for Mongo-style inclusion projections used by find_one().
        return Cursor(self, query or {})

    def _find(self, query: dict, length: int | None) -> list[dict]:
        with self.database.lock, self.database.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM documents WHERE collection = ? ORDER BY rowid", (self.name,)
            ).fetchall()
        found = []
        for (payload,) in rows:
            document = json.loads(payload)
            if _matches(document, query):
                found.append(document)
                if length is not None and len(found) >= length:
                    break
        return found

    async def update_one(self, query: dict, update: dict) -> UpdateResult:
        return await asyncio.to_thread(self._update_one, query, update)

    async def delete_one(self, query: dict) -> DeleteResult:
        return await asyncio.to_thread(self._delete_one, query)

    def _delete_one(self, query: dict) -> DeleteResult:
        with self.database.lock, self.database.connect() as connection:
            rows = connection.execute(
                "SELECT document_id, payload FROM documents WHERE collection = ? ORDER BY rowid",
                (self.name,),
            ).fetchall()
            for document_id, payload in rows:
                if _matches(json.loads(payload), query):
                    connection.execute(
                        "DELETE FROM documents WHERE collection = ? AND document_id = ?",
                        (self.name, document_id),
                    )
                    return DeleteResult(1)
        return DeleteResult(0)

    def _update_one(self, query: dict, update: dict) -> UpdateResult:
        with self.database.lock, self.database.connect() as connection:
            rows = connection.execute(
                "SELECT document_id, payload FROM documents WHERE collection = ? ORDER BY rowid",
                (self.name,),
            ).fetchall()
            for document_id, payload in rows:
                document = json.loads(payload)
                if not _matches(document, query):
                    continue
                before = _json_dump(document)
                for key, values in update.get("$set", {}).items():
                    document[key] = values
                for key, value in update.get("$push", {}).items():
                    document.setdefault(key, []).append(value)
                after = _json_dump(document)
                if after != before:
                    connection.execute(
                        "UPDATE documents SET payload = ? WHERE collection = ? AND document_id = ?",
                        (after, self.name, document_id),
                    )
                return UpdateResult(1, int(after != before))
        return UpdateResult(0, 0)

    def aggregate(self, pipeline: list[dict]) -> AggregateCursor:
        return AggregateCursor(self, pipeline)

    def _aggregate(self, pipeline: list[dict], length: int | None) -> list[dict]:
        documents = self._find({}, None)
        result = documents
        for stage in pipeline:
            group = stage.get("$group")
            if group is None:
                continue
            grouped: dict[Any, list[dict]] = {}
            group_key = group.get("_id")
            for document in result:
                key = document.get(group_key[1:]) if isinstance(group_key, str) and group_key.startswith("$") else group_key
                grouped.setdefault(key, []).append(document)
            result = []
            for key, members in grouped.items():
                row = {"_id": key}
                for field, operation in group.items():
                    if field == "_id":
                        continue
                    if "$avg" in operation:
                        source = operation["$avg"]
                        values = [item.get(source[1:]) for item in members if isinstance(source, str) and isinstance(item.get(source[1:]), (int, float))]
                        row[field] = sum(values) / len(values) if values else None
                    elif "$sum" in operation:
                        source = operation["$sum"]
                        row[field] = sum(
                            (item.get(source[1:], 0) if isinstance(source, str) and source.startswith("$") else source)
                            for item in members
                        )
                result.append(row)
        return result if length is None else result[:length]
def matches(document:dict , query:dict)->bool:
    for key , expected  in query.items():
        actual=document.get(key)
        if isinstance(expected , dict) and "&regex" in expected:
            flag=re.IGNORECASE if "i" in expected.get("$options", " ") else 0
            try:
                if re.search(expected["$regex"] , str(actual or ""), flags) is None:
                    return False
            except re.error:
                return False

        elif actual != expected:
            return False
    return True

def _project(document: dict, projection: dict | None) -> dict:
    if not projection:
        return document
    included = {field for field, enabled in projection.items() if enabled}
    if not included:
        return {key: value for key, value in document.items() if not projection.get(key) and key != "_id"}
    result = {key: document[key] for key in included if key in document}
    if projection.get("_id", 1) and "_id" in document:
        result["_id"] = document["_id"]
    return result


def _json_dump(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=lambda item: item.isoformat())


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.collections: dict[str, Collection] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS documents ("
                "collection TEXT NOT NULL, document_id TEXT NOT NULL, payload TEXT NOT NULL, "
                "PRIMARY KEY(collection, document_id))"
            )

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def __getattr__(self, name: str) -> Collection:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self.collections:
            self.collections[name] = Collection(self, name)
        return self.collections[name]

    async def ping(self) -> bool:
        return await asyncio.to_thread(self._ping)

    def _ping(self) -> bool:
        with self.connect() as connection:
            connection.execute("SELECT 1").fetchone()
        return True


STORAGE_BACKEND = "sqlite"
db = Database(SQLITE_DB_PATH)
