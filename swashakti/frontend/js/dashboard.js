const API_PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const API_HOST = !window.location.hostname || window.location.hostname === "localhost"
    ? "127.0.0.1" : window.location.hostname;
const API_BASE = window.API_BASE || `${API_PROTOCOL}//${API_HOST}:8003`;
const $ = id => document.getElementById(id);
const sellerIdField = $("sellerId");
let speechRecognition;
const sellerToken = localStorage.getItem("sellerToken");

sellerIdField.value = new URLSearchParams(window.location.search).get("seller_id") || localStorage.getItem("sellerId") || "";

function authHeaders(headers = {}) {
    return { ...headers, Authorization: `Bearer ${sellerToken}` };
}

function showStatus(message) {
    $("dashboardStatus").textContent = message;
}

function currentSellerId() {
    const id = sellerIdField.value.trim();
    if (!sellerToken) throw new Error("Sign in to your seller account to use the dashboard.");
    if (!id) throw new Error("Register a seller first or enter the seller ID.");
    if (id !== localStorage.getItem("sellerId")) throw new Error("This account can only manage its own seller profile.");
    return id;
}

async function responseData(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem("sellerToken");
            location.href = "login.html?next=dashboard";
        }
        const detail = Array.isArray(data.detail)
            ? data.detail.map(issue => issue.msg).join("; ")
            : data.detail;
        throw new Error(detail || `Request failed (${response.status})`);
    }
    return data;
}

function imageUrl(path) {
    if (!path) return "";
    return path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

let productPreviewUrl = null;
let pendingProductImageUrl = null;
let pendingProductImageUpload = Promise.resolve();
function clearProductImagePreview() {
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    productPreviewUrl = null;
    $("productImagePreviewPhoto").removeAttribute("src");
    $("productImagePreview").classList.add("hidden");
    $("productImageFile").value = "";
    $("productImageStatus").textContent = "";
    pendingProductImageUrl = null;
    pendingProductImageUpload = Promise.resolve();
}

function renderProducts(products) {
    const rows = $("inventoryRows");
    rows.replaceChildren();
    $("inventoryEmpty").classList.toggle("hidden", products.length > 0);

    products.forEach(product => {
        const row = document.createElement("tr");
        row.className = "border-b";
        const photoCell = document.createElement("td");
        photoCell.className = "p-2 align-top";
        if (product.image_url) {
            const photo = document.createElement("img");
            photo.src = imageUrl(product.image_url);
            photo.alt = `${product.title || "Product"} photo`;
            photo.className = "h-16 w-16 rounded object-cover";
            photo.onerror = () => { photo.alt = "Product photo unavailable"; photo.classList.add("hidden"); };
            photoCell.appendChild(photo);
        } else {
            photoCell.textContent = "No photo";
        }
        row.appendChild(photoCell);
        for (const value of [product.title, product.description || "—", product.product_type, product.stock, `₹${product.price}`]) {
            const cell = document.createElement("td");
            cell.className = "p-2 align-top";
            cell.textContent = value;
            row.appendChild(cell);
        }

        const stockCell = document.createElement("td");
        stockCell.className = "p-2 whitespace-nowrap";
        const stockInput = document.createElement("input");
        stockInput.type = "number";
        stockInput.min = "0";
        stockInput.step = "1";
        stockInput.value = product.stock;
        stockInput.setAttribute("aria-label", `Stock for ${product.title}`);
        stockInput.className = "w-20 rounded border p-1";
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.textContent = "Save";
        saveButton.className = "ml-1 rounded bg-emerald-700 px-2 py-1 text-white";
        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;
            try {
                await responseData(await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(product._id)}/stock`, {
                    method: "PATCH",
                    headers: authHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({ stock: Number(stockInput.value) }),
                }));
                showStatus(`Stock updated for ${product.title}.`);
                await loadDashboard();
            } catch (error) {
                showStatus(`Could not update stock: ${error.message}`);
            } finally {
                saveButton.disabled = false;
            }
        });
        stockCell.append(stockInput, saveButton);
        row.appendChild(stockCell);

        const removeCell = document.createElement("td");
        removeCell.className = "p-2 align-top";
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.className = "rounded border border-red-300 px-2 py-1 text-sm text-red-700";
        removeButton.setAttribute("aria-label", `Remove ${product.title} from shop products`);
        removeButton.addEventListener("click", async () => {
            if (!window.confirm(`Remove “${product.title}” from your shop products?`)) return;
            removeButton.disabled = true;
            try {
                await responseData(await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(product._id)}`, {
                    method: "DELETE",
                    headers: authHeaders(),
                }));
                showStatus(`${product.title} removed from shop products.`);
                await loadDashboard();
            } catch (error) {
                showStatus(`Could not remove product: ${error.message}`);
            } finally {
                removeButton.disabled = false;
            }
        });
        removeCell.appendChild(removeButton);
        row.appendChild(removeCell);
        rows.appendChild(row);
    });
}

function renderContacts(contacts = []) {
    const list = $("deliveryContacts");
    list.replaceChildren();
    if (!contacts.length) {
        const empty = document.createElement("li");
        empty.textContent = "No delivery contacts listed.";
        list.appendChild(empty);
        return;
    }
    contacts.forEach(contact => {
        const item = document.createElement("li");
        const fare = contact.estimated_price_per_delivery ?? contact.estimated_price_per_km ?? "—";
        item.textContent = `${contact.name} · ${contact.phone} · ${contact.vehicle_type || "Vehicle not specified"} · ₹${fare} per parcel`;
        list.appendChild(item);
    });
}

async function loadDashboard() {
    try {
        const id = currentSellerId();
        showStatus("Loading seller profile and inventory…");
        const [sellerResponse, productsResponse] = await Promise.all([
            fetch(`${API_BASE}/api/onboard/seller/${encodeURIComponent(id)}`, { headers: authHeaders() }),
            fetch(`${API_BASE}/api/inventory/seller/${encodeURIComponent(id)}`, { headers: authHeaders() }),
        ]);
        const [seller, products] = await Promise.all([responseData(sellerResponse), responseData(productsResponse)]);
        $("sellerName").textContent = `${seller.business_name} · ${seller.phone}`;
        $("serviceMode").value = seller.service_mode || "both";
        renderContacts(seller.delivery_contacts || []);
        renderProducts(products);
        await loadSHGProfile();
        showStatus(`Dashboard loaded. ${products.length} product(s) in inventory.`);
    } catch (error) {
        showStatus(`Could not load dashboard: ${error.message}`);
    }
}

$("loadDashboard").addEventListener("click", loadDashboard);
sellerIdField.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        loadDashboard();
    }
});

$("productType").addEventListener("change", () => {
    const isConsumable = $("productType").value === "consumable";
    $("manufactured").required = isConsumable;
    $("expiry").required = isConsumable;
    $("manufacturedField").classList.toggle("text-slate-400", !isConsumable);
    $("expiryField").classList.toggle("text-slate-400", !isConsumable);
});
$("productType").dispatchEvent(new Event("change"));

$("productImageFile").addEventListener("change", () => {
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    const file = $("productImageFile").files[0];
    if (!file) {
        $("productImagePreview").classList.add("hidden");
        return;
    }
    productPreviewUrl = URL.createObjectURL(file);
    $("productImagePreviewPhoto").src = productPreviewUrl;
    $("productImagePreview").classList.remove("hidden");
    pendingProductImageUrl = null;
    const selectedFile = file;
    $("productImageStatus").textContent = "Photo captured. Enhancing and preparing it for your shop…";
    pendingProductImageUpload = (async () => {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("enhance", "true");
        const upload = await responseData(await fetch(`${API_BASE}/api/onboard/upload-image`, { method: "POST", body: formData }));
        if ($("productImageFile").files[0] !== selectedFile) return;
        pendingProductImageUrl = upload.image_url;
        if (upload.enhanced) {
            $("productImagePreviewPhoto").src = imageUrl(upload.image_url);
            $("productImageStatus").textContent = "Hugging Face enhancement complete. Save the product to add it to your shop.";
        } else {
            $("productImageStatus").textContent = `${upload.enhancement_message || "Original photo ready."} Save the product to add it to your shop.`;
        }
    })().catch(error => {
        if ($("productImageFile").files[0] === selectedFile) {
            $("productImageStatus").textContent = `Photo could not be prepared: ${error.message}`;
        }
        throw error;
    });
    pendingProductImageUpload.catch(() => {});
});
$("removeProductImage").addEventListener("click", clearProductImagePreview);

$("productForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector("button[type='submit'], button:not([type])");
    submitButton.disabled = true;
    try {
        const seller_id = currentSellerId();
        const consumable = $("productType").value === "consumable";
        if (consumable && $("expiry").value < $("manufactured").value) {
            throw new Error("Expiry date cannot be earlier than the manufactured date.");
        }
        let image_url = null;
        const imageFile = $("productImageFile").files[0];
        if (imageFile) {
            await pendingProductImageUpload;
            if (!pendingProductImageUrl) throw new Error("Wait for the product photo to finish uploading, or remove it and try again.");
            image_url = pendingProductImageUrl;
        }
        const result = await responseData(await fetch(`${API_BASE}/api/inventory/add-product`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                seller_id,
                title: $("title").value.trim(),
                description: $("description").value.trim(),
                product_type: $("productType").value,
                stock: Number($("stock").value),
                price: Number($("price").value),
                manufactured_date: consumable ? $("manufactured").value : null,
                expiry_date: consumable ? $("expiry").value : null,
                image_url,
            }),
        }));
        form.reset();
        clearProductImagePreview();
        $("productType").dispatchEvent(new Event("change"));
        showStatus(`Product saved (${result.product_id}).`);
        await loadDashboard();
    } catch (error) {
        showStatus(`Could not save product: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
});

$("serviceModeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector("button[type='submit'], button:not([type])");
    submitButton.disabled = true;
    try {
        const id = currentSellerId();
        const mode = $("serviceMode").value;
        await responseData(await fetch(`${API_BASE}/api/onboard/service-mode/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`, { method: "PATCH", headers: authHeaders() }));
        showStatus("Fulfillment option saved.");
    } catch (error) {
        showStatus(`Could not save fulfillment option: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
});

$("contactForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector("button[type='submit'], button:not([type])");
    submitButton.disabled = true;
    try {
        const id = currentSellerId();
        await responseData(await fetch(`${API_BASE}/api/delivery/contacts/${encodeURIComponent(id)}`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                name: $("contactName").value.trim(),
                phone: $("contactPhone").value.trim(),
                vehicle_type: $("vehicle").value.trim() || "Auto Rickshaw",
                estimated_price_per_delivery: Number($("rate").value),
            }),
        }));
        form.reset();
        $("vehicle").value = "Auto Rickshaw";
        showStatus("Delivery contact added.");
        await loadDashboard();
    } catch (error) {
        showStatus(`Could not add delivery contact: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
});

$("transactionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector("button[type='submit'], button:not([type])");
    submitButton.disabled = true;
    try {
        const seller_id = currentSellerId();
        await responseData(await fetch(`${API_BASE}/api/delivery/log-transaction`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ seller_id, amount: Number($("transactionAmount").value), payment_mode: $("transactionMode").value }),
        }));
        form.reset();
        showStatus("Transaction record saved for your bookkeeping.");
    } catch (error) {
        showStatus(`Could not record transaction: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
});

$("shareWhatsApp").addEventListener("click", async () => {
    const button = $("shareWhatsApp");
    let tab;
    button.disabled = true;
    try {
        const id = currentSellerId();
        tab = window.open("about:blank", "_blank");
        const data = await responseData(await fetch(`${API_BASE}/api/inventory/whatsapp-dashboard/${encodeURIComponent(id)}`, { headers: authHeaders() }));
        if (tab) tab.location = data.whatsapp_link;
        else window.location.assign(data.whatsapp_link);
    } catch (error) {
        if (tab) tab.close();
        showStatus(`Could not create WhatsApp link: ${error.message}`);
    } finally {
        button.disabled = false;
    }
});

function renderCreditReadiness(result) {
    const box = $("creditReadiness");
    box.classList.remove("hidden");
    box.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "font-semibold";
    heading.textContent = `SHG checklist: ${result.readiness?.checklist_complete ? "all recorded steps complete" : `${result.readiness?.active_months ?? 0} active month(s); preparation steps remain`}`;
    box.appendChild(heading);
    const note = document.createElement("p");
    note.className = "text-sm text-slate-600";
    note.textContent = result.readiness?.notice || "This checklist is for preparation only. A bank or SHG federation decides eligibility, terms, and approval.";
    box.appendChild(note);
    const list = document.createElement("ul");
    list.className = "list-disc pl-5 text-sm";
    (result.readiness?.next_steps || []).forEach(step => {
        const li = document.createElement("li"); li.textContent = step; list.appendChild(li);
    });
    box.appendChild(list);
}

async function loadSHGProfile() {
    const result = await responseData(await fetch(`${API_BASE}/api/credit/shg`, { headers: authHeaders() }));
    const profile = result.group_name ? result : null;
    if (profile) {
        $("shgName").value = profile.group_name || "";
        $("shgMembers").value = profile.member_count || "";
        $("shgVillage").value = profile.village || "";
        $("shgDistrict").value = profile.district || "";
        $("shgState").value = profile.state || "";
        $("shgActiveSince").value = profile.active_since || "";
        const fields = { bank_savings_account: "shgBankAccount", day_nrlm_linked: "shgNrlm", nabard_grading_completed: "shgGrading", regular_meetings: "shgMeetings", regular_savings: "shgSavings", regular_internal_lending: "shgInternalLending", timely_repayments: "shgRepayments", books_up_to_date: "shgBooks" };
        Object.entries(fields).forEach(([key, id]) => { $(id).checked = Boolean(profile[key]); });
    }
    renderCreditReadiness(result);
}

$("shgForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector("button[type='submit'], button:not([type])");
    submitButton.disabled = true;
    const payload = {
        group_name: $("shgName").value.trim(), member_count: Number($("shgMembers").value),
        village: $("shgVillage").value.trim(), district: $("shgDistrict").value.trim(), state: $("shgState").value.trim(),
        active_since: $("shgActiveSince").value,
        bank_savings_account: $("shgBankAccount").checked, day_nrlm_linked: $("shgNrlm").checked,
        nabard_grading_completed: $("shgGrading").checked, regular_meetings: $("shgMeetings").checked,
        regular_savings: $("shgSavings").checked, regular_internal_lending: $("shgInternalLending").checked,
        timely_repayments: $("shgRepayments").checked, books_up_to_date: $("shgBooks").checked,
    };
    try {
        const result = await responseData(await fetch(`${API_BASE}/api/credit/shg`, {
            method: "PUT", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload),
        }));
        renderCreditReadiness(result);
        showStatus("SHG credit preparation checklist saved.");
    } catch (error) { showStatus(`Could not save SHG checklist: ${error.message}`); }
    finally { submitButton.disabled = false; }
});

$("signOut").addEventListener("click", async () => {
    try { await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() }); } catch (_) { /* Clear local session even when offline. */ }
    localStorage.removeItem("sellerToken"); localStorage.removeItem("sellerId");
    location.href = "login.html";
});

$("recordDescription").addEventListener("click", () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const status = $("descriptionStatus");
    const button = $("recordDescription");
    if (!Recognition) {
        status.textContent = "This browser does not support speech recognition. Open the dashboard in the latest Chrome or Edge, allow microphone access, or type the description.";
        return;
    }
    if (speechRecognition) {
        try {
            speechRecognition.stop();
            status.textContent = "Finishing voice input…";
        } catch (error) {
            status.textContent = `Could not stop voice input: ${error.message}`;
        }
        return;
    }

    speechRecognition = new Recognition();
    speechRecognition.lang = $("descriptionLanguage").value;
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.maxAlternatives = 1;
    button.setAttribute("aria-pressed", "true");
    speechRecognition.onstart = () => {
        button.textContent = "Stop listening";
        status.textContent = "Listening. Speak clearly, then wait for transcription or click Stop listening.";
    };
    speechRecognition.onresult = event => {
        const transcript = Array.from(event.results, result => result[0].transcript).join("").trim();
        if (transcript.trim()) $("description").value = transcript.trim();
        status.textContent = transcript ? `Description: ${transcript}` : "Listening…";
    };
    speechRecognition.onerror = event => {
        const messages = {
            "not-allowed": "Microphone access was blocked. Allow microphone access for this site in browser settings, then try again.",
            "service-not-allowed": "The browser's speech service is blocked. Try the latest Chrome or Edge, or type the description.",
            "audio-capture": "No microphone was found. Connect or enable a microphone, then try again.",
            "no-speech": "No speech was detected. Check the microphone, speak after Listening appears, and try again.",
            "network": "The browser could not reach its speech recognition service. Check your internet connection and try again.",
            "language-not-supported": "Speech recognition does not support the selected language in this browser. Try English (India).",
            "aborted": "Voice input was stopped before a transcript was received.",
        };
        status.textContent = messages[event.error] || `Voice input failed (${event.error || "unknown error"}). Check microphone permission or type the description.`;
    };
    speechRecognition.onend = () => {
        speechRecognition = undefined;
        button.setAttribute("aria-pressed", "false");
        button.textContent = "Dictate description";
        if (!status.textContent || status.textContent === "Listening…" || status.textContent === "Finishing voice input…") {
            status.textContent = "No transcript received. Check microphone permission and try again, or type the description.";
        }
    };
    try {
        speechRecognition.start();
    } catch (error) {
        speechRecognition = undefined;
        button.setAttribute("aria-pressed", "false");
        button.textContent = "Dictate description";
        status.textContent = !window.isSecureContext
            ? "Voice input requires a secure page. Open the local site at http://127.0.0.1 or use HTTPS."
            : `Voice input could not start: ${error.message}. Check microphone permission and try again.`;
    }
});

if (!sellerToken) location.href = "login.html?next=dashboard";
else if (sellerIdField.value) loadDashboard();
