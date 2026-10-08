const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
let imageUploadTask = Promise.resolve();
let onboardingSubmitting = false;

async function submitOnboarding(event) {
    event.preventDefault();
    const form = document.getElementById("onboardForm");
    if (!form.reportValidity()) return;

    const button = document.getElementById("registerSeller");
    onboardingSubmitting = true;
    button.disabled = true;
    const mode = document.querySelector('input[name="onboarding_mode"]:checked').value;
    const studentId = document.getElementById("student_id").value.trim();
    if (mode === "student" && !studentId) {
        document.getElementById("student_id").focus();
        document.getElementById("student_id").reportValidity();
        onboardingSubmitting = false;
        button.disabled = false;
        return;
    }
    const payload = {
        password: document.getElementById("password").value,
        business_name: document.getElementById("business_name").value.trim(),
        owner_name: document.getElementById("owner_name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        category: document.getElementById("category").value,
        onboarded_by: mode === "student" ? `Student:${studentId}` : "Self",
        address: document.getElementById("address").value.trim(),
        latitude: Number(document.getElementById("latitude").value),
        longitude: Number(document.getElementById("longitude").value),
        images: Array.isArray(window.sellerImages) ? [...window.sellerImages] : [],
        delivery_contacts: [],
    };

    try {
        await imageUploadTask;
        payload.images = Array.isArray(window.sellerImages) ? [...window.sellerImages] : [];
        const response = await fetch(`${API_BASE}/api/onboard/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = Array.isArray(result.detail)
                ? result.detail.map(issue => `${(issue.loc || []).slice(1).join(".")}: ${issue.msg}`).join("; ")
                : result.detail;
            throw new Error(detail || `Registration failed (${response.status})`);
        }
        localStorage.setItem("sellerToken", result.access_token);
        localStorage.setItem("sellerId", result.seller_id);
        window.location.href = `dashboard.html?seller_id=${encodeURIComponent(result.seller_id)}`;
    } catch (error) {
        const message = error instanceof TypeError && error.message === "Failed to fetch"
            ? `Cannot reach the backend at ${API_BASE}. Start the FastAPI server on port 8003 and check that the local SQLite database is accessible.`
            : error.message;
        document.getElementById("voiceOutput").textContent = `Registration failed: ${message}`;
        imageUploadTask = Promise.resolve();
        onboardingSubmitting = false;
        button.disabled = false;
    }
}

document.getElementById("onboardForm")?.addEventListener("submit", submitOnboarding);

async function uploadSellerImages(input) {
    const button = document.getElementById("registerSeller");
    const status = document.getElementById("imageStatus");
    const files = Array.from(input.files || []);
    window.sellerImages = Array.isArray(window.sellerImages) ? window.sellerImages : [];

    imageUploadTask = (async () => {
        button.disabled = true;
        status.textContent = "Uploading image(s)…";
        try {
            for (const file of files) {
                const data = new FormData();
                data.append("file", file);
                const response = await fetch(`${API_BASE}/api/onboard/upload-image`, { method: "POST", body: data });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.detail || "Image upload failed. Check the backend connection.");
                if (typeof result.image_url !== "string") throw new Error("Image upload returned no image URL.");
                window.sellerImages.push(result.image_url);
            }
            status.textContent = `${window.sellerImages.length} image(s) uploaded.`;
            input.value = "";
        } finally {
            button.disabled = onboardingSubmitting;
        }
    })();
    await imageUploadTask;
}

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
        document.getElementById("latitude").value = position.coords.latitude;
        document.getElementById("longitude").value = position.coords.longitude;
    }, () => {
        document.getElementById("voiceOutput").textContent = "Location permission was not granted. Enter latitude and longitude manually to pin the seller on the map.";
    }, { timeout: 10000 });
}
