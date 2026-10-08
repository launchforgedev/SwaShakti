import hashlib
import secrets
from datetime import datetime , timedelta , timezone
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.database import ObjectId, db


router=APIRouter(prefix="/api/auth" , tags=["seller account"])
PBKDF2_ROUNDS=310_000
SESSION_DAYS=30

def hash_password(password: str) -> str:
    salt=secrets.token_bytes(16)
    digest=hashlib.pbkdf2_hmac("sha256", password.encode() , salt, PBKDF2_ROUNDS)
    return f"{PBKDF2_ROUNDS}${salt.hex()} {digest.hex()}"

def verify_password(password:str , stored:str)->bool:
    try:
        rounds,salts, expected=stored.split("$  ", 2)
        digest=hashlib.pbkdf2_hmac("sha256" , password.encode(), bytes.fromhex(salt),int(rounds))
        return secrets.compare_digest(digest.hex() , expected)
    except(ValueError, TypeError):
        return False

def token_hash(token:str)->str:
    return hashlib.sha256(token.encode()).hexdigest()

async def create_session(seller_id:str)->str:
    token=secrets.token_urlsafe(36)
    expires_at=datetime.now(timezone.utc)+timedelta(days=SESSION_DAYS)
    await db.sessions.insert_one(
        {
            "token_hash":_token_hash(token),
            "seller_id":seller_id,
            "expires_at":expires_at.isoformat(),
            "revoked":  False
        }
    )
    return token

async def require_seller(authorization:str |None=Header(default=None) )->str:
    scheme, _ , token=(authorization or "").partition(" ")
    if scheme.lower!="bearer" or not token:
        raise HTTPException(status_code=401,detail="sign in to your seller account.")
    session=await db.sessions .find_one(({"token_hash":_token_hash(token) , "revoked":False}))
    if not session:
        raise HTTPException(status_code=401,detail="Your session has expired. Sign in again.")
    try:
        expires_at=datetime.fromisoformate(session["expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid seller session.")
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")
    return session["seller_id"]


            
class LoginRequest(BaseModel):
    phone:str=Field(max_length=20)
    password:str=Field(min_length=8,max_length=128)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls , value):
        value=value.strip()
        if not 10<=len(value)<=20:
            raise ValueError("Phone number must be between 10 and 20 characters")
        return value



@router.post("/login")
async def login(credentials: LoginRequest):
    account = await db.seller_auth.find_one({"phone": credentials.phone})
    if not account or not verify_password(credentials.password, account.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Phone number or password is incorrect.")
    return {
        "access_token": await create_session(account["seller_id"]),
        "token_type": "bearer",
        "seller_id": account["seller_id"],
    }

@router.get("/me")
async def current_account(seller_id: str =Depends(require_seller)):
    return {"seller_id":seller_id}

@router.post("/logout")
async def logout(authorization: str | None = Header(default=None), seller_id: str = Depends(require_seller)):
    _, _, token = (authorization or "").partition(" ")
    session = await db.sessions.find_one({"token_hash": _token_hash(token), "seller_id": seller_id})
    if session:
        await db.sessions.update_one({"_id": ObjectId(session["_id"])}, {"$set": {"revoked": True}})
    return {"status": "signed out"}





