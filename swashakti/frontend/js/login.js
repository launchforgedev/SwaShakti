const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
const form = document.getElementById("loginForm");
form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = document.getElementById("loginButton");
    const status = document.getElementById("loginStatus");
    button.disabled = true;
    status.textContent = "Signing in…";
    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: document.getElementById("phone").value.trim(),
                password: document.getElementById("password").value,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = Array.isArray(data.detail)
                ? data.detail.map(issue => issue.msg).join("; ")
                : data.detail;
            throw new Error(detail || `Sign in failed (${response.status})`);
        }
        localStorage.setItem("sellerToken", data.access_token);
        localStorage.setItem("sellerId", data.seller_id);
        const next = new URLSearchParams(location.search).get("next");
        location.href = next === "dashboard" ? `dashboard.html?seller_id=${encodeURIComponent(data.seller_id)}` : "dashboard.html";
    } catch (error) {
        status.textContent = error instanceof TypeError && error.message === "Failed to fetch"
            ? `Cannot reach the seller service at ${API_BASE}. Check that the backend is running on port 8003.`
            : error.message;
        button.disabled = false;
    }
});
