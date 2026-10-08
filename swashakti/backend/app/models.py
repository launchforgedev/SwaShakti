from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Literal
from datetime import date, datetime

class DeliveryPersonSchema(BaseModel):
    name: str
    phone: str
    vehicle_type: str = "Auto Rickshaw"
    estimated_price_per_delivery: float = Field(ge=0)

class SellerOnboardSchema(BaseModel):
    password: str = Field(min_length=8, max_length=128)
    business_name: str
    owner_name: str
    phone: str
    category: str  # Handicraft, Arts, Consumables, Decorating Items, Others
    onboarded_by: str = "Self"  # "Student:<ID>" or "Self"
    address: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    delivery_contacts: List[DeliveryPersonSchema] = Field(default_factory=list)
    service_mode: Literal["delivery", "pickup", "both"] = "both"
    images: List[str] = Field(default_factory=list)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value):
        value = value.strip()
        if not 10 <= len(value) <= 20:
            raise ValueError("Phone number must be between 10 and 20 characters")
        return value

    @field_validator("images", mode="before")
    @classmethod
    def normalize_images(cls, value):
        # Older frontend versions sent one image URL as a string.
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value else []
        return value

class ProductSchema(BaseModel):
    seller_id: str
    title: str
    description: str = Field(default="", max_length=1000)
    product_type: Literal["consumable", "non_consumable"]
    manufactured_date: Optional[str] = None  # YYYY-MM-DD
    expiry_date: Optional[str] = None        # YYYY-MM-DD
    stock: int = Field(ge=0)
    price: float = Field(ge=0)
    image_url: Optional[str] = None

    @model_validator(mode="after")
    def validate_consumable_dates(self):
        if self.product_type == "consumable":
            if not self.manufactured_date or not self.expiry_date:
                raise ValueError("Consumables require manufactured_date and expiry_date")
            try:
                from datetime import date
                manufactured = date.fromisoformat(self.manufactured_date)
                expiry = date.fromisoformat(self.expiry_date)
            except ValueError as exc:
                raise ValueError("Dates must use YYYY-MM-DD format") from exc
            if expiry < manufactured:
                raise ValueError("expiry_date cannot be earlier than manufactured_date")
        return self

class StockUpdateSchema(BaseModel):
    stock: int = Field(ge=0)

class TransactionSchema(BaseModel):
    seller_id: str
    amount: float = Field(gt=0)
    payment_mode: str  # UPI, Bank Transfer, QR Code
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status: str = "Reported"

class FeedbackSchema(BaseModel):
    seller_id: str
    rating: int = Field(ge=1, le=5)
    comment: str = ""


class OrderRequestSchema(BaseModel):
    product_id: str
    buyer_name: str = Field(min_length=1, max_length=120)
    buyer_phone: str = Field(min_length=8, max_length=20)
    quantity: int = Field(default=1, ge=1, le=100)
    delivery_address: str = Field(min_length=4, max_length=500)


class ProductReviewSchema(BaseModel):
    product_id: str
    buyer_name: str = Field(min_length=1, max_length=120)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=2, max_length=1000)


class SHGProfileSchema(BaseModel):
    group_name: str = Field(min_length=2, max_length=120)
    village: str = Field(min_length=2, max_length=120)
    district: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=120)
    member_count: int = Field(ge=2, le=1000)
    active_since: date
    bank_savings_account: bool = False
    day_nrlm_linked: bool = False
    nabard_grading_completed: bool = False
    regular_meetings: bool = False
    regular_savings: bool = False
    regular_internal_lending: bool = False
    timely_repayments: bool = False
    books_up_to_date: bool = False
