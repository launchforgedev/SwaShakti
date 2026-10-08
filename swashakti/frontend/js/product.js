const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
const productId = new URLSearchParams(location.search).get("id");
let selectedProduct;
let selectedSeller;
let productMap;

function mapUrl(seller) {
    const hasCoordinates = seller.latitude != null && seller.longitude != null
        && Number.isFinite(Number(seller.latitude)) && Number.isFinite(Number(seller.longitude));
    const query = hasCoordinates
        ? `${seller.latitude},${seller.longitude}` : seller.address || seller.business_name;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderReviews(reviews, average, count) {
    const list = document.getElementById("reviewList");
    list.replaceChildren();
    document.getElementById("reviewSummary").textContent = count ? `· ${average} / 5 from ${count} review${count === 1 ? "" : "s"}` : "· No reviews yet";
    document.getElementById("reviewsEmpty").classList.toggle("hidden", reviews.length > 0);
    reviews.forEach(review => {
        const item = document.createElement("li");
        item.className = "border-b pb-4 last:border-0";
        const heading = document.createElement("div");
        heading.className = "flex flex-wrap justify-between gap-2";
        const name = document.createElement("strong"); name.textContent = review.buyer_name;
        const rating = document.createElement("span"); rating.className = "text-amber-700"; rating.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
        heading.append(name, rating);
        const comment = document.createElement("p"); comment.className = "mt-2 whitespace-pre-wrap text-sm text-slate-700"; comment.textContent = review.comment;
        item.append(heading, comment);
        if (review.created_at) {
            const date = document.createElement("p"); date.className = "mt-1 text-xs text-slate-500";
            const parsed = new Date(review.created_at); date.textContent = Number.isNaN(parsed.valueOf()) ? "" : parsed.toLocaleDateString();
            item.appendChild(date);
        }
        list.appendChild(item);
    });
}

function renderMap(seller) {
    const lat = Number(seller.latitude), lng = Number(seller.longitude);
    const hasCoordinates = seller.latitude != null && seller.longitude != null
        && Number.isFinite(lat) && Number.isFinite(lng);
    document.getElementById("openMap").href = mapUrl(seller);
    if (!window.L || !hasCoordinates) {
        document.getElementById("sellerMap").textContent = seller.address ? "Map coordinates are not available. Use the address above." : "Seller has not shared a location.";
        return;
    }
    productMap = L.map("sellerMap").setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "OpenStreetMap contributors" }).addTo(productMap);
    L.marker([lat, lng]).addTo(productMap).bindPopup(seller.business_name).openPopup();
}

async function loadProduct() {
    if (!productId) throw new Error("Product link is missing its ID. Return to the marketplace and choose a product.");
    const response = await fetch(`${API_BASE}/api/discovery/products/${encodeURIComponent(productId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Server returned ${response.status}`);
    selectedProduct = data.product;
    selectedSeller = data.seller;
    document.title = `${selectedProduct.title} | Namma Angadi`;
    document.getElementById("productStatus").textContent = "";
    document.getElementById("productLayout").classList.remove("hidden");
    document.getElementById("productCategory").textContent = selectedSeller.category || "Local product";
    document.getElementById("productTitle").textContent = selectedProduct.title;
    document.getElementById("productPrice").textContent = `INR ${selectedProduct.price}`;
    document.getElementById("productStock").textContent = Number(selectedProduct.stock) > 0 ? `${selectedProduct.stock} available` : "Currently out of stock";
    document.getElementById("productDescription").textContent = selectedProduct.description || "The seller has not added a description yet.";
    document.getElementById("sellerName").textContent = selectedSeller.business_name;
    const modes = { delivery: "Delivery available", pickup: "Buyer pickup", both: "Delivery or buyer pickup" };
    document.getElementById("fulfillment").textContent = modes[selectedSeller.service_mode] || "Ask seller about fulfillment";
    document.getElementById("sellerAddress").textContent = selectedSeller.address || "Location is shown on the map when available.";
    const image = document.getElementById("productImage");
    if (selectedProduct.image_url) {
        image.src = selectedProduct.image_url.startsWith("http") ? selectedProduct.image_url : `${API_BASE}${selectedProduct.image_url.startsWith("/") ? "" : "/"}${selectedProduct.image_url}`;
        image.alt = selectedProduct.title;
        image.classList.remove("hidden");
        document.getElementById("imagePlaceholder").classList.add("hidden");
        image.onerror = () => { image.classList.add("hidden"); document.getElementById("imagePlaceholder").classList.remove("hidden"); };
    }
    const quantity = document.getElementById("quantity");
    quantity.max = String(Math.max(1, Number(selectedProduct.stock) || 1));
    const orderButton = document.getElementById("orderButton");
    orderButton.disabled = Number(selectedProduct.stock) < 1;
    if (orderButton.disabled) orderButton.textContent = "Currently out of stock";
    renderMap(selectedSeller);
    renderReviews(data.reviews || [], data.average_rating, data.review_count || 0);
}

document.getElementById("orderForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("orderStatus");
    const quantity = Number(document.getElementById("quantity").value);
    if (!selectedProduct || !selectedSeller || quantity > Number(selectedProduct.stock)) { status.textContent = "That quantity is not currently available."; return; }
    const tab = window.open("about:blank", "_blank");
    const button = document.getElementById("orderButton");
    button.disabled = true;
    status.textContent = "Sending your order enquiry…";
    try {
        const response = await fetch(`${API_BASE}/api/discovery/order`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_id: selectedProduct._id, buyer_name: document.getElementById("buyerName").value.trim(), buyer_phone: document.getElementById("buyerPhone").value.trim(), quantity, delivery_address: document.getElementById("deliveryAddress").value.trim() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Server returned ${response.status}`);
        status.textContent = `${data.message} Estimated total: INR ${Number(data.total_amount).toFixed(2)}.`;
        if (tab) tab.location = data.whatsapp_link;
        else location.assign(data.whatsapp_link);
    } catch (error) {
        if (tab) tab.close();
        status.textContent = `Could not send request: ${error.message}`;
    } finally {
        button.disabled = Number(selectedProduct?.stock) < 1;
    }
});

document.getElementById("reviewForm").addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("reviewStatus");
    if (!selectedProduct) { status.textContent = "Product details are not available."; return; }
    const button = event.currentTarget.querySelector("button[type='submit'], button:not([type])");
    button.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/api/discovery/product-reviews`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_id: selectedProduct._id, buyer_name: document.getElementById("reviewName").value.trim(), rating: Number(document.getElementById("reviewRating").value), comment: document.getElementById("reviewComment").value.trim() }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Server returned ${response.status}`);
        document.getElementById("reviewComment").value = "";
        status.textContent = "Thanks, your review was added.";
        const refreshed = await fetch(`${API_BASE}/api/discovery/products/${encodeURIComponent(selectedProduct._id)}`);
        const details = await refreshed.json();
        renderReviews(details.reviews || [], details.average_rating, details.review_count || 0);
    } catch (error) { status.textContent = `Could not add review: ${error.message}`; }
    finally { button.disabled = false; }
});

loadProduct().catch(error => {
    document.getElementById("productStatus").textContent = `Could not load product: ${error.message}`;
    document.getElementById("productLayout").classList.add("hidden");
});
