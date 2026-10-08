from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_seller
from app.database import ObjectId, db
from app.models import ProductSchema, StockUpdateSchema
from app.whatsapp_bot import generate_whatsapp_dashboard_link

router = APIRouter(prefix="/api/inventory", tags=["Inventory"])

@router.post("/add-product")
async def add_product(product: ProductSchema, account_id:str=Depends(require_seller)):
    if product.seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only add products to your own shop.")
    if not ObjectId.is_valid(product.seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if not await db.sellers.find_one({"_id": ObjectId(product.seller_id)}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Seller not found")
    prod_dict = product.model_dump()
    result = await db.products.insert_one(prod_dict)
    return {"status": "success", "product_id": str(result.inserted_id)}
@router.patch("/{product_id}/stock")
async def update_stock(product_id: str, update: StockUpdateSchema, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID")
    product = await db.products.find_one({"_id": ObjectId(product_id)})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.get("seller_id") != account_id:
        raise HTTPException(status_code=403, detail="You can only update your own products.")
    result = await db.products.update_one({"_id": ObjectId(product_id)}, {"$set": {"stock": update.stock}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"status": "updated", "stock": update.stock, "availability": "in_stock" if update.stock else "out_of_stock"}

@router.delete("/{product_id}")
async def delete_product(product_id: str, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID")
    product = await db.products.find_one({"_id": ObjectId(product_id)})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.get("seller_id") != account_id:
        raise HTTPException(status_code=403, detail="You can only remove products from your own shop.")
    await db.products.delete_one({"_id": ObjectId(product_id)})
    return {"status": "deleted", "product_id": product_id}

@router.get("/seller/{seller_id}")
async def get_seller_inventory(seller_id: str):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    products = await db.products.find({"seller_id": seller_id}).to_list(100)
    for p in products:
        p["_id"] = str(p["_id"])
    return products

@router.get("/whatsapp-dashboard/{seller_id}")
async def get_whatsapp_dashboard(seller_id: str, account_id: str = Depends(require_seller)):
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    if seller_id != account_id:
        raise HTTPException(status_code=403, detail="You can only share your own shop.")
    seller = await db.sellers.find_one({"_id": ObjectId(seller_id)})
    if not seller:
        raise HTTPException(status_code=404, detail="Seller not found")
    
    products = await db.products.find({"seller_id": seller_id}).to_list(100)
    try:
        wa_link = generate_whatsapp_dashboard_link(seller["phone"], seller["business_name"], products)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"whatsapp_link": wa_link}
