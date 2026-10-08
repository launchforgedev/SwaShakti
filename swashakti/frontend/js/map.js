const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
let map;
let selectedSeller;
let markers = [];
let sellerLoadRequest = 0;
const registeredParams = new URLSearchParams(window.location.search);
const registeredSellerId = registeredParams.get("seller_id");
const registeredLat = registeredParams.has("lat") ? Number(registeredParams.get("lat")) : Number.NaN;
const registeredLng = registeredParams.has("lng") ? Number(registeredParams.get("lng")) : Number.NaN;

function popupText(text) {
    const element = document.createElement("div");
    element.textContent = text;
    return element;
}

function showRegisteredPinIfNeeded() {
    if (!registeredSellerId || !Number.isFinite(registeredLat) || !Number.isFinite(registeredLng)) return;
    if (markers.some(marker => marker.options?.sellerId === registeredSellerId)) return;
    const name = registeredParams.get("name") || "New seller";
    const address = registeredParams.get("address") || "";
    const marker = L.marker([registeredLat, registeredLng]).addTo(map).bindPopup(popupText(`${name}${address ? ` | ${address}` : ""}`));
    marker.options.sellerId = registeredSellerId;
    markers.push(marker);
    map.setView([registeredLat, registeredLng], 16);
    marker.openPopup();
    showSeller({
        _id: registeredSellerId,
        business_name: name,
        address,
        latitude: registeredLat,
        longitude: registeredLng,
        category: "Newly registered",
        service_mode: "both"
    });
    document.getElementById("mapStatus").textContent = "Seller registered. Showing the new map pin; loading the seller profile…";
}

async function loadMapSellers() {
    if (!map) return;
    const requestNumber = ++sellerLoadRequest;
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    const category = document.getElementById("categoryFilter")?.value || "All";
    const product = document.getElementById("productFilter")?.value || "";
    try {
        const url = `${API_BASE}/api/discovery/sellers?category=${encodeURIComponent(category)}&product=${encodeURIComponent(product)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const sellers = await response.json();
        if (requestNumber !== sellerLoadRequest) return;
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
        sellers.forEach(seller => {
            const latitude = Number(seller.latitude), longitude = Number(seller.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            const rating = seller.average_rating ? ` | Rating ${seller.average_rating} (${seller.rating_count})` : " | No ratings yet";
            const marker = L.marker([latitude, longitude]).addTo(map).bindPopup(popupText(seller.business_name + rating));
            marker.options.sellerId = seller._id;
            marker.on("click", () => showSeller(seller));
            markers.push(marker);
            if (registeredSellerId && seller._id === registeredSellerId) {
                map.setView([latitude, longitude], 16);
                marker.openPopup();
                showSeller(seller);
            }
        });
        if (registeredSellerId && !sellers.some(seller => seller._id === registeredSellerId)) showRegisteredPinIfNeeded();
        else if (!registeredSellerId && markers.length > 1) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15), { maxZoom: 14 });
        else if (!registeredSellerId && markers.length === 1) map.setView(markers[0].getLatLng(), 13);
        if (!registeredSellerId || !sellers.some(seller => seller._id === registeredSellerId)) {
            document.getElementById("mapStatus").textContent = sellers.length ? `${sellers.length} businesses found` : "No businesses found for this search.";
        }
    } catch (error) {
        if (requestNumber !== sellerLoadRequest) return;
        showRegisteredPinIfNeeded();
        document.getElementById("mapStatus").textContent = `Could not load businesses. Start the backend and try again. (${error.message})`;
    }
}

async function showSeller(seller) {
    selectedSeller = seller;
    document.getElementById("sellerDetails").classList.remove("hidden");
    document.getElementById("sellerName").textContent = seller.business_name || "Business";
    document.getElementById("sellerCategory").textContent = seller.category || "";
    document.getElementById("sellerPhone").textContent = seller.phone || "";
    document.getElementById("sellerRating").textContent = seller.average_rating ? `Rating ${seller.average_rating} / 5 (${seller.rating_count} ratings)` : "No ratings yet";
    const modes = { delivery: "Delivery", pickup: "Buyer pickup", both: "Delivery or buyer pickup" };
    document.getElementById("sellerServiceMode").textContent = `Fulfillment: ${modes[seller.service_mode] || "Ask seller"}`;
    const googleMapsLink = document.getElementById("googleMapsLink");
    if (googleMapsLink) {
        const query = [seller.business_name, seller.address, `${seller.latitude},${seller.longitude}`].filter(Boolean).join(" ");
        googleMapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    }
    const deliveryList = document.getElementById("deliveryList");
    deliveryList.replaceChildren();
    try {
        const response = await fetch(`${API_BASE}/api/delivery/contacts/${encodeURIComponent(seller._id)}`);
        if (response.ok) (await response.json()).forEach(contact => {
            const item = document.createElement("li");
            const estimatedFare = contact.estimated_price_per_delivery ?? contact.estimated_price_per_km;
            item.textContent = `${contact.name} | ${contact.phone} | Estimated INR ${estimatedFare} per parcel`;
            deliveryList.appendChild(item);
        });
    } catch (_) { /* Keep seller details visible if delivery lookup fails. */ }
    if (!deliveryList.children.length) deliveryList.textContent = "No delivery contacts listed.";
    const productList = document.getElementById("sellerProducts");
    productList.replaceChildren();
    try {
        const response = await fetch(`${API_BASE}/api/inventory/seller/${encodeURIComponent(seller._id)}`);
        if (response.ok) (await response.json()).forEach(item => {
            const row = document.createElement("li");
            const link = document.createElement("a");
            link.href = `product.html?id=${encodeURIComponent(item._id)}`;
            link.className = "block w-full rounded border bg-white p-2 text-left hover:border-emerald-600";
            link.textContent = `${item.title} | ${item.stock > 0 ? `${item.stock} in stock` : "NO STOCK"} | INR ${item.price} - View details`;
            row.appendChild(link);
            productList.appendChild(row);
        });
    } catch (_) { /* Product list is optional if the API is temporarily unavailable. */ }
    if (!productList.children.length) productList.textContent = "No products listed.";
}

async function submitSellerFeedback() {
    if (!selectedSeller) return;
    const button = document.getElementById("feedbackButton");
    button.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/api/discovery/feedback`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ seller_id: selectedSeller._id, rating: Number(document.getElementById("feedbackRating").value), comment: document.getElementById("feedbackComment").value })
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        alert("Feedback saved. Thank you!");
        document.getElementById("feedbackComment").value = "";
        await loadMapSellers();
    } catch (error) { alert(`Could not save feedback: ${error.message}`); }
    finally { button.disabled = false; }
}

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("map")) return;
    if (!window.L) {
        document.getElementById("mapStatus").textContent = "Map library did not load. Check your internet connection and refresh.";
        return;
    }
    const initialView = registeredSellerId && Number.isFinite(registeredLat) && Number.isFinite(registeredLng)
        ? [registeredLat, registeredLng] : [12.9716, 77.5946];
    map = L.map("map").setView(initialView, registeredSellerId ? 16 : 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "OpenStreetMap contributors" })
        .on("tileerror", () => { document.getElementById("mapStatus").textContent = "Map tiles could not load. Check your internet connection; seller pins remain available."; })
        .addTo(map);
    loadMapSellers();
});
