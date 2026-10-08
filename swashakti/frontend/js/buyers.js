const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
const grid = document.getElementById("productGrid");
const status = document.getElementById("catalogStatus");
const emptyState = document.getElementById("emptyState");
let searchTimer;

function productImageUrl(path) {
    if (!path) return "";
    return path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

function productCard(item) {
    const link = document.createElement("a");
    link.href = `product.html?id=${encodeURIComponent(item._id)}`;
    link.className = "group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md";
    const imageWrap = document.createElement("div");
    imageWrap.className = "flex h-48 items-center justify-center overflow-hidden bg-emerald-50";
    if (item.image_url) {
        const image = document.createElement("img");
        image.src = productImageUrl(item.image_url);
        image.alt = item.title || "Product photo";
        image.className = "h-full w-full object-cover";
        image.onerror = () => { image.remove(); imageWrap.textContent = "Product photo unavailable"; };
        imageWrap.appendChild(image);
    } else {
        const placeholder = document.createElement("span");
        placeholder.className = "text-5xl text-emerald-800";
        placeholder.setAttribute("aria-hidden", "true");
        placeholder.textContent = "✿";
        imageWrap.appendChild(placeholder);
    }
    const content = document.createElement("div");
    content.className = "space-y-2 p-4";
    const title = document.createElement("h2");
    title.className = "line-clamp-1 text-lg font-bold group-hover:text-emerald-800";
    title.textContent = item.title || "Untitled product";
    const seller = document.createElement("p");
    seller.className = "text-sm text-slate-600";
    seller.textContent = item.seller.business_name;
    const location = document.createElement("p");
    location.className = "line-clamp-1 text-xs text-slate-500";
    location.textContent = item.seller.address || "Seller location on product page";
    const bottom = document.createElement("div");
    bottom.className = "flex items-center justify-between gap-2 pt-1";
    const price = document.createElement("span");
    price.className = "font-bold text-emerald-800";
    price.textContent = `INR ${item.price}`;
    const stock = document.createElement("span");
    stock.className = Number(item.stock) > 0 ? "text-xs text-emerald-700" : "text-xs font-semibold text-rose-700";
    stock.textContent = Number(item.stock) > 0 ? `${item.stock} available` : "Out of stock";
    bottom.append(price, stock);
    content.append(title, seller, location, bottom);
    link.append(imageWrap, content);
    return link;
}

async function loadProducts() {
    status.textContent = "Loading products…";
    grid.replaceChildren();
    emptyState.classList.add("hidden");
    const query = new URLSearchParams({ search: document.getElementById("productSearch").value.trim(), category: document.getElementById("categoryFilter").value });
    try {
        const response = await fetch(`${API_BASE}/api/discovery/products?${query}`);
        const result = await response.json().catch(() => []);
        if (!response.ok) throw new Error(result.detail || `Server returned ${response.status}`);
        result.forEach(item => grid.appendChild(productCard(item)));
        status.textContent = `${result.length} product${result.length === 1 ? "" : "s"} listed by local sellers`;
        emptyState.classList.toggle("hidden", result.length > 0);
    } catch (error) {
        status.textContent = `Could not load products. Check that the backend is running. (${error.message})`;
    }
}

document.getElementById("productSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadProducts, 250);
});
document.getElementById("categoryFilter").addEventListener("change", loadProducts);
loadProducts();
