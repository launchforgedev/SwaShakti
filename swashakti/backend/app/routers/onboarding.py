from pathlib import Path
from uuid import uuid4
from io import BytesIO
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import create_session, hash_password, require_seller
from app.database import ObjectId, db
from app.models import SellerOnboardSchema

router= APIRouter(prefix="/api/onboard", tags=["onboarding"])
UPLOAD_DIR=Path(__file__).resolve().parents[2]/"uploads"
UPLOAD_DIR=mkdir(parents=True,exist_ok=True)
router = APIRouter(prefix="/api/onboard", tags=["Onboarding"])
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/register")
async def register_seller(seller: SellerOnboardSchema):
    phone = seller.phone.strip()
    if await db.seller_auth.find_one({"phone": phone}):
        raise HTTPException(status_code=409, detail="A seller account already uses this phone number. Sign in instead.")
    seller_data = seller.model_dump(exclude={"password"})
    seller_data["phone"] = phone
    result = await db.sellers.insert_one(seller_data)
    seller_id = str(result.inserted_id)
    await db.seller_auth.insert_one({
        "seller_id": seller_id,
        "phone": phone,
        "password_hash": hash_password(seller.password),
    })
    return {
        "status": "success",
        "seller_id": seller_id,
        "access_token": await create_session(seller_id),
        "token_type": "bearer",
    }


@router.get("/seller/{seller_id}")
async def get_seller(seller_id: str, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only access your own seller dashboard.")
    seller = await db.sellers.find_one({"_id": ObjectId(seller_id)})
    if not seller:
        raise HTTPException(status_code=404, detail="Seller not found")
    seller["_id"] = str(seller["_id"])
    return seller


@router.patch("/service-mode/{seller_id}")
async def update_service_mode(seller_id: str, mode: str, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only update your own seller settings.")
    if mode not in {"delivery", "pickup", "both"}:
        raise HTTPException(status_code=422, detail="Mode must be delivery, pickup, or both")
    result = await db.sellers.update_one(
        {"_id": ObjectId(seller_id)}, {"$set": {"service_mode": mode}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Seller not found")
    return {"status": "updated", "service_mode": mode}


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...), enhance: bool = Form(False)):
    allowed_types = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    allowed_extensions = {".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp", ".gif": ".gif"}
    extension = allowed_types.get(file.content_type or "") or allowed_extensions.get(
        Path(file.filename or "").suffix.lower()
    )
    if not extension:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, WEBP, or GIF image.")

    content = await file.read(10 * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")

    enhanced = False
    enhancement_message = None
    if enhance and extension != ".gif":
        hf_token = os.getenv("HF_TOKEN")
        if hf_token:
            try:
                from huggingface_hub import InferenceClient

                model = os.getenv("HF_IMAGE_ENHANCEMENT_MODEL", "caidas/swin2SR-classical-sr-x2-64")
                client = InferenceClient(provider="auto", api_key=hf_token, timeout=60)
                result = client.image_to_image(content, model=model)
                output = BytesIO()
                result.convert("RGB").save(output, format="JPEG", quality=92, optimize=True)
                content = output.getvalue()
                extension = ".jpg"
                enhanced = True
            except Exception:
                enhancement_message = "Hugging Face enhancement was unavailable; the original photo was saved."
        else:
            enhancement_message = "Set HF_TOKEN in backend/.env to enable Hugging Face image enhancement."
    elif enhance:
        enhancement_message = "GIF photos are saved without enhancement."

    filename = f"{uuid4().hex}{extension}"
    (UPLOAD_DIR / filename).write_bytes(content)
    return {
        "image_url": f"/static/{filename}",
        "enhanced": enhanced,
        "enhancement_message": enhancement_message,
    }
