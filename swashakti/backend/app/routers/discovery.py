import re
from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.database import ObjectId, db
from app.models import FeedbackSchema, OrderRequestSchema, ProductReviewSchema
from app.whatsapp_bot import create_whatsapp_link

router = APIRouter(prefix="/api/discovery", tags=["Discovery"])

@router.get("/Products")
async def discover_products(category: str | None=None, search:str | None=None )
    products = await db.products.find({}).to_list(None)
    sellers = await db.sellers.find({}).to_list(None)
    seller_by_id = {str(seller["_id"]): seller for seller in sellers}
    normalized_search = (search or "").strip().casefold()
    results = []
    for product in products:
        seller = seller_by_id.get(product.get("seller_id", ""))
        if not seller:
            continue
        if category and category not in {"All", ""} and seller.get("category") != category:
            continue
        if normalized_search and normalized_search not in " ".join((
            str(product.get("title", "")), str(product.get("description", "")),
            str(seller.get("business_name", "")), str(seller.get("address", "")),
        )).casefold():
            continue
        results.append({
            **product,
            "_id": str(product["_id"]),
            "seller": {
                "_id": str(seller["_id"]),
                "business_name": seller.get("business_name", "Local seller"),
                "category": seller.get("category", ""),
                "phone": seller.get("phone", ""),
                "address": seller.get("address", ""),
                "latitude": seller.get("latitude"),
                "longitude": seller.get("longitude"),
                "service_mode": seller.get("service_mode", "both"),
            },
        })
    return results

@router.get("/products/{product_id}")
async def get_product_detail(product_id: str):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID")
    product = await db.products.find_one({"_id": ObjectId(product_id)})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    seller_id = product.get("seller_id", "")
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=404, detail="Seller profile not found")
    seller = await db.sellers.find_one({"_id": ObjectId(seller_id)})
    if not seller:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    reviews = await db.product_reviews.find({"product_id": product_id}).to_list(None)
    ratings = [review["rating"] for review in reviews]
    serialized_reviews = []
    for review in reviews:
        review["_id"] = str(review["_id"])
        serialized_reviews.append(review)
    product["_id"] = str(product["_id"])
    return {
        "product": product,
        "seller": {
            "_id": str(seller["_id"]),
            "business_name": seller.get("business_name", "Local seller"),
            "phone": seller.get("phone", ""),
            "category": seller.get("category", ""),
            "address": seller.get("address", ""),
            "latitude": seller.get("latitude"),
            "longitude": seller.get("longitude"),
            "service_mode": seller.get("service_mode", "both"),
        },
        "reviews": serialized_reviews,
        "average_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "review_count": len(ratings),
    }


@router.post("/product-reviews")
async def add_product_review(review: ProductReviewSchema):
    if not ObjectId.is_valid(review.product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID")
    product = await db.products.find_one({"_id": ObjectId(review.product_id)}, {"_id": 1})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    saved = await db.product_reviews.insert_one({**review.model_dump(), "created_at": datetime.utcnow().isoformat()})
    return {"status": "review saved", "review_id": str(saved.inserted_id)}


@router.get("/sellers")
async def discover_sellers(category: str | None = None, product: str | None = None):
    query = {} if not category or category == "All" else {"category": category}
    sellers = await db.sellers.find(query).to_list(100)
    feedback_rows = await db.feedbacks.aggregate(
        [{"$group": {
            "_id": "$seller_id",
            "average_rating": {"$avg": "$rating"},
            "rating_count": {"$sum": 1},
        }}]
    ).to_list(1000)
    ratings = {
        row["_id"]: {
            "average_rating": round(row["average_rating"], 1),
            "rating_count": row["rating_count"],
        }
        for row in feedback_rows
    }

    for seller in sellers:
        seller["_id"] = str(seller["_id"])
        seller.update(ratings.get(seller["_id"], {"average_rating": None, "rating_count": 0}))

    if product:
        product_rows = await db.products.find(
            {"title": {"$regex": re.escape(product), "$options": "i"}}, {"seller_id": 1}
        ).to_list(1000)
        seller_ids = {row["seller_id"] for row in product_rows}
        sellers = [seller for seller in sellers if seller["_id"] in seller_ids]
    return sellers


@router.post("/feedback")
async def add_feedback(feedback: FeedbackSchema):
    if not ObjectId.is_valid(feedback.seller_id):
        raise HTTPException(status_code=400, detail="Invalid seller ID")
    seller = await db.sellers.find_one({"_id": ObjectId(feedback.seller_id)}, {"_id": 1})
    if not seller:
        raise HTTPException(status_code=404, detail="Seller not found")
    await db.feedbacks.insert_one(feedback.model_dump())
    return {"status": "feedback added"}


@router.post("/order")
async def create_order_request(order: OrderRequestSchema):
    if not ObjectId.is_valid(order.product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID")
    product = await db.products.find_one({"_id": ObjectId(order.product_id)})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.get("stock", 0) < order.quantity:
        raise HTTPException(status_code=409, detail="Requested quantity is not currently available")

    seller_id = product.get("seller_id", "")
    if not ObjectId.is_valid(seller_id):
        raise HTTPException(status_code=409, detail="Seller profile is unavailable")
    seller = await db.sellers.find_one({"_id": ObjectId(seller_id)})
    if not seller:
        raise HTTPException(status_code=404, detail="Seller profile not found")

    total_amount = float(product.get("price", 0)) * order.quantity
    message = (
        f"Hello {seller['business_name']}, I would like to order {order.quantity} × "
        f"{product['title']} (estimated total ₹{total_amount:.2f}). "
        f"Delivery address: {order.delivery_address}. Please confirm availability and final details."
    )
    saved = await db.orders.insert_one({
        **order.model_dump(),
        "seller_id": seller_id,
        "product_title": product["title"],
        "unit_price": product.get("price", 0),
        "total_amount": total_amount,
        "status": "enquiry_created",
    })
    return {
        "order_id": str(saved.inserted_id),
        "status": "enquiry_created",
        "message": "Order enquiry saved. The seller must confirm stock, price, delivery and payment directly.",
        "whatsapp_link": create_whatsapp_link(seller["phone"], message),
        "total_amount": total_amount,
    }
