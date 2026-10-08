from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_seller 
from app.database import ObjectId,db 
from app.models import SHGProfileSchema

router=APIRouter(prefix="/api/credit",tags=["SHG credit readiness"])
CHECKS=(
    "regular_meetings",
    "regular_savings",
    "regular_internal_lending",
    "timely_repayments",
    "books_up_to_date",
)

def with_readiness(profile:dict) -> dict:
    active_since=date.fromisoformat(profile["active_since"])
    today=date.today()
    active_months=max(0, (today.year-active_since.year) * 12 + today.month - active_since.month)
    missing=[]
    if active_months<6:
        missing.append("Keep the SHG active for at least six months, supported by its books of account.")
    for field, text in zip(CHECKS, (
        "Hold regular meetings",
        "Maintain regular savings",
        "Record regular internal lending",
        "Record timely repayments",
        "Keep the books of account up to date",
    )):
        if not profile.get(field):
            missing.append(text)
    if not profile.get("nabard_grading_completed"):
         missing.append("Ask the federation or SHG promoting institution about the applicable grading process.")
    if not profile.get("bank_savings_account"):
        missing.append("Contact a bank branch or authorized Business Correspondent about an SHG savings account.")
    readiness = {
        "active_months": active_months,
        "checklist_complete": not missing,
        "next_steps": missing,
        "notice": "This checklist is for preparation only. The bank and relevant DAY-NRLM/SRLM authorities determine eligibility and lending terms.",
    }
    return {**profile, "readiness": readiness}

@router.get("/shg")
async def get_shg_profile(seller_id: str=Depends(require_seller)):
    profile=await db.shgs.find_one({"seller_id":seller_id})
    return with_readiness(profile)  if profile else {"profile":None}

@router.put("/shg")
async def save_shg_profile(profile: SHGProfileSchema, seller_id: str = Depends(require_seller)):
    data = profile.model_dump(mode="json")
    data["seller_id"] = seller_id
    existing = await db.shgs.find_one({"seller_id": seller_id})
    if existing:
        await db.shgs.update_one({"_id": ObjectId(existing["_id"])}, {"$set": data})
        saved = {**existing, **data}
    else:
        result = await db.shgs.insert_one(data)
        saved = {**data, "_id": str(result.inserted_id)}
    return with_readiness(saved)
