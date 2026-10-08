from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_seller
from app.database import ObjectId, db
from app.models import TransactionSchema, DeliveryPersonSchema

router= APIRouter(prefix="/api/delivery", tags=["Delivery & Transactions"])

@router.get("/contacts/{seller_id}")
async def get_delivery_contacts(seller_id: str):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalide Seller ID")
    seller = await db.sellers.find_one({"_id": ObjectId(seller_id)})
    return seller.get("delivery_contacts", []) if seller else []
    
@router.post("/contacts/{seller_id}")
async def add_delivery_contact(seller_id: str, contact: DeliveryPersonSchema, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only update your own delivery contacts.")
    result = await db.sellers.update_one({"_id": ObjectId(seller_id)}, {"$push": {"delivery_contacts": contact.model_dump()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Seller not found")
    return {"status": "contact added"}

@router.post("/log-transaction")
async def log_transaction(transaction: TransactionSchema, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(transaction.seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if transaction.seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only record transactions for your own shop.")
    if not await db.sellers.find_one({"_id": ObjectId(transaction.seller_id)}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Seller not found")
    result = await db.transactions.insert_one(transaction.model_dump())
    return {"status": "recorded", "credit_point_added": False, "message": "Transaction record saved for the seller's records. This does not guarantee bank credit or loan approval.", "txn_id": str(result.inserted_id)}
    