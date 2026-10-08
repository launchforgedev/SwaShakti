from urllib.parse import quote


def generate_whatsapp_dashboard_link(phone: str, business_name: str, stock_data: list) -> str:
    """Build a WhatsApp click-to-send link; no Business API credentials are needed."""
    message_lines = [f"*Business Dashboard - {business_name}*", ""]
    for item in stock_data:
        stock = item.get("stock", 0)
        availability = f"{stock} items" if stock > 0 else "OUT OF STOCK"
        message_lines.append(f"- *{item.get('title', 'Product')}*: {availability}")
        if item.get("product_type") == "consumable" and item.get("expiry_date"):
            message_lines.append(f"  Expiry: {item['expiry_date']}")

    return create_whatsapp_link(phone, "\n".join(message_lines))


def create_whatsapp_link(phone: str, message: str) -> str:
    normalized_phone = "".join(character for character in phone if character.isdigit())
    if normalized_phone.startswith("0"):
        normalized_phone = normalized_phone[1:]
    if len(normalized_phone) == 10:
        normalized_phone = f"91{normalized_phone}"
    if not (10 <= len(normalized_phone) <= 15):
        raise ValueError("Seller phone must include a valid country code or 10-digit Indian number.")

    return f"https://wa.me/{normalized_phone}?text={quote(message)}"
