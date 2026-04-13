/* ============================================================
   MATCHING.JS — CampusFinds AI Matching (Imagga API)
   Uses Imagga for fast, reliable image tagging + similarity.
   ============================================================ */

// ── Imagga config ──────────────────────────────────────────
const IMAGGA_KEY    = "acc_561a28e79a21882";
const IMAGGA_SECRET = "0847e3a9c52c6af533513945326efcec";
const IMAGGA_AUTH   = "Basic " + btoa(IMAGGA_KEY + ":" + IMAGGA_SECRET);

// ── Supabase config ────────────────────────────────────────
const SUPA_URL  = "https://ijfjkvwvkunhkipchfep.supabase.co";
const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmprdnd2a3VuaGtpcGNoZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MTMsImV4cCI6MjA4Nzk0NzQxM30.fp9KwwU9U1YahKZdThXf5gWkfkRsj8CS1KbUa5bVCS4";

console.log("=== MATCHING.JS (Imagga) LOADED ===");

var currentUploadedImage = null;

document.addEventListener("DOMContentLoaded", function () {
    var findBtn = document.querySelector(".ai-action-btn");
    if (findBtn) findBtn.addEventListener("click", handleAnalysisClick);

    var uploadInput = document.getElementById("aiImageInput");
    if (uploadInput) uploadInput.addEventListener("change", handleFileSelect);

    var container = document.getElementById("matchContainer");
    if (container) {
        container.innerHTML = "<p style='opacity:0.5;text-align:center;margin-top:30px;'>Upload an image and click <b>Run AI Image Analysis</b> to find matches.</p>";
    }
});

function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file."); return; }
    if (file.size > 10 * 1024 * 1024)   { alert("File too large. Max 10 MB.");    return; }

    var reader = new FileReader();
    reader.onload = function (ev) {
        currentUploadedImage = ev.target.result;
        var inner   = document.getElementById("aiUploadInner");
        var preview = document.getElementById("aiImagePreview");
        var img     = document.getElementById("aiPreviewImg");
        var nameEl  = document.getElementById("aiPreviewName");
        var sizeEl  = document.getElementById("aiPreviewSize");
        var box     = document.getElementById("aiUploadCard");
        if (img)     img.src = currentUploadedImage;
        if (nameEl)  nameEl.textContent = file.name;
        if (sizeEl)  sizeEl.textContent = (file.size / 1024).toFixed(1) + " KB";
        if (inner)   inner.style.display   = "none";
        if (preview) preview.style.display = "flex";
        if (box)     box.classList.add("upload-box--has-image");
    };
    reader.readAsDataURL(file);
}

function handleAiImagePreview(input) {
    if (input && input.files && input.files[0]) handleFileSelect({ target: input });
}

function removeAiImage(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    clearUpload();
}

function handleAnalysisClick() {
    if (!currentUploadedImage) { alert("Please upload an image first."); return; }
    var fileInput = document.getElementById("aiImageInput");
    var filename  = (fileInput && fileInput.files[0]) ? fileInput.files[0].name : "image.jpg";
    analyzeUploadedImage(filename);
}

// ── Supabase fetch ─────────────────────────────────────────
async function fetchAllReports() {
    var url = SUPA_URL + "/rest/v1/Report?order=reporttime.desc&select=*,User!Report_user_id_fkey(id,name,email,imageurl)";
    var res = await fetch(url, { headers: { "apikey": SUPA_ANON, "Authorization": "Bearer " + SUPA_ANON } });
    if (!res.ok) throw new Error("Supabase error: " + res.status);
    return res.json();
}

// ── Image helpers ──────────────────────────────────────────
async function resizeImage(dataUrl, maxSize) {
    maxSize = maxSize || 800;
    return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
            var w = img.width, h = img.height;
            if (w <= maxSize && h <= maxSize) { resolve(dataUrl); return; }
            var scale = maxSize / Math.max(w, h);
            var canvas = document.createElement("canvas");
            canvas.width  = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = dataUrl;
    });
}

function dataUrlToBlob(dataUrl) {
    var arr  = dataUrl.split(",");
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n    = bstr.length;
    var u8   = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
}

// ── Imagga: upload image and get upload_id ─────────────────
async function imaggaUpload(dataUrl) {
    var resized = await resizeImage(dataUrl, 800);
    var blob    = dataUrlToBlob(resized);
    var form    = new FormData();
    form.append("image", blob, "image.jpg");

    var res = await fetch("https://api.imagga.com/v2/uploads", {
        method: "POST",
        headers: { "Authorization": IMAGGA_AUTH },
        body: form
    });
    if (!res.ok) {
        var t = await res.text();
        throw new Error("Imagga upload error " + res.status + ": " + t);
    }
    var data = await res.json();
    return data.result.upload_id;
}

// ── Imagga: get tags for an upload_id ─────────────────────
async function imaggaGetTags(uploadId) {
    var res = await fetch("https://api.imagga.com/v2/tags?image_upload_id=" + uploadId + "&limit=15&threshold=15", {
        headers: { "Authorization": IMAGGA_AUTH }
    });
    if (!res.ok) throw new Error("Imagga tags error " + res.status);
    var data = await res.json();
    return data.result.tags.map(function (t) {
        return { tag: t.tag.en.toLowerCase(), confidence: t.confidence };
    });
}

// ── Imagga: get tags for a found item image (fetch → upload → tag) ──
async function imaggaGetTagsFromUrl(imageUrl) {
    // Fetch the image via browser (bypasses CORS since Supabase allows it)
    var res = await fetch(imageUrl);
    if (!res.ok) throw new Error("Failed to fetch found item image (" + res.status + ")");
    var blob = await res.blob();

    // Convert to dataUrl so we can resize it
    var dataUrl = await new Promise(function(resolve, reject) {
        var r = new FileReader();
        r.onload = function(e) { resolve(e.target.result); };
        r.onerror = reject;
        r.readAsDataURL(blob);
    });

    // Resize then upload to Imagga
    var resized  = await resizeImage(dataUrl, 800);
    var resBlob  = dataUrlToBlob(resized);
    var form     = new FormData();
    form.append("image", resBlob, "found.jpg");

    var upRes = await fetch("https://api.imagga.com/v2/uploads", {
        method: "POST",
        headers: { "Authorization": IMAGGA_AUTH },
        body: form
    });
    if (!upRes.ok) {
        var t = await upRes.text();
        throw new Error("Imagga upload error " + upRes.status + ": " + t);
    }
    var upData   = await upRes.json();
    var uploadId = upData.result.upload_id;

    // Get tags
    var tagRes = await fetch("https://api.imagga.com/v2/tags?image_upload_id=" + uploadId + "&limit=15&threshold=15", {
        headers: { "Authorization": IMAGGA_AUTH }
    });
    if (!tagRes.ok) throw new Error("Imagga tags error " + tagRes.status);
    var tagData = await tagRes.json();
    return tagData.result.tags.map(function(t) {
        return { tag: t.tag.en.toLowerCase(), confidence: t.confidence };
    });
}

// ── Tag similarity scoring ─────────────────────────────────
function computeSimilarity(tagsA, tagsB, itemName, itemDesc) {
    var mapA = {};
    tagsA.forEach(function (t) { mapA[t.tag] = t.confidence; });

    var mapB = {};
    tagsB.forEach(function (t) { mapB[t.tag] = t.confidence; });

    var shared = 0, total = 0;
    var allTags = new Set(Object.keys(mapA).concat(Object.keys(mapB)));
    allTags.forEach(function (tag) {
        var a = mapA[tag] || 0;
        var b = mapB[tag] || 0;
        shared += Math.min(a, b);
        total  += Math.max(a, b);
    });
    var tagScore = total > 0 ? (shared / total) * 100 : 0;

    // Bonus: if item name/description keywords appear in uploaded image tags
    var nameWords = ((itemName || "") + " " + (itemDesc || "")).toLowerCase().split(/\s+/);
    var keywordBonus = 0;
    nameWords.forEach(function (word) {
        if (word.length > 3 && mapA[word]) keywordBonus += 12;
    });

    var finalScore = Math.min(100, Math.round(tagScore + keywordBonus));

    var sharedTags = Object.keys(mapA).filter(function (t) { return mapB[t]; });
    var reason = sharedTags.length > 0
        ? "Both items share visual features: " + sharedTags.slice(0, 5).join(", ") + "."
        : "No significant visual features in common.";

    return { confidence: finalScore, match: finalScore >= 35, reason: reason };
}

// ── Main analysis ──────────────────────────────────────────
async function analyzeUploadedImage(filename) {
    var container = document.getElementById("matchContainer");
    if (!container) return;

    showSpinner(container, "Fetching items from database…");

    var reports = [];
    try {
        reports = (typeof getAllReports === "function") ? await getAllReports() : await fetchAllReports();
    } catch (err) {
        try { reports = await fetchAllReports(); } catch (e2) { reports = []; }
    }

    if (!reports || reports.length === 0) {
        container.innerHTML = msgBox("warning", "No items in database", "Please report some lost or found items first.");
        return;
    }

    var foundItems = reports.filter(function (r) {
        return (r.reporttype || r.reportType || "").toLowerCase().trim() === "found" && !!(r.imageurl || r.imageUrl);
    });

    if (foundItems.length === 0) {
        container.innerHTML = msgBox("warning", "No found items with images",
            "There are " + reports.length + " report(s) in the database, but none are found items with images.");
        return;
    }

    // STEP 1: Upload & tag the user's image (1 Imagga call)
    showSpinner(container, " Analyzing your image with Imagga AI…");
    var uploadedTags;
    try {
        var uploadId = await imaggaUpload(currentUploadedImage);
        uploadedTags = await imaggaGetTags(uploadId);
        console.log("Your image tags:", uploadedTags);
    } catch (err) {
        container.innerHTML = msgBox("error", "Imagga Error", err.message);
        return;
    }

    // STEP 2: Tag all found items sequentially (to avoid Imagga overload)
    var tagResults = [];
    for (var i = 0; i < foundItems.length; i++) {
        showSpinner(container, " Comparing item " + (i+1) + " of " + foundItems.length + "…");
        try {
            var tags = await imaggaGetTagsFromUrl(foundItems[i].imageurl || foundItems[i].imageUrl);
            tagResults.push({ status: "fulfilled", value: tags });
        } catch(err) {
            tagResults.push({ status: "rejected", reason: err });
        }
    }

    var matches = [], errors = [];
    tagResults.forEach(function (res, idx) {
        var found = foundItems[idx];
        if (res.status === "fulfilled") {
            var result = computeSimilarity(uploadedTags, res.value, found.item, found.description);
            matches.push({ found: found, confidence: result.confidence, match: result.match, reason: result.reason });
        } else {
            errors.push({ item: found.item, error: res.reason.message });
        }
    });

    matches.sort(function (a, b) { return b.confidence - a.confidence; });
    displayUploadMatches(matches, filename, foundItems.length, errors);
}

// ── Display ────────────────────────────────────────────────
function displayUploadMatches(matches, filename, totalCompared, errors) {
    var container = document.getElementById("matchContainer");
    container.innerHTML = "";

    var header = document.createElement("div");
    header.style.cssText = "text-align:center;margin-bottom:24px;padding:20px;background:rgba(91,200,245,0.1);border-radius:12px;border:2px solid #5bc8f5;";
    header.innerHTML =
        "<img src='" + currentUploadedImage + "' style='max-width:240px;max-height:180px;border-radius:10px;object-fit:cover;border:3px solid #5bc8f5;box-shadow:0 4px 20px rgba(91,200,245,0.3);'>" +
        "<h3 style='margin:12px 0 4px;color:var(--gold);'>Your Uploaded Image</h3>" +
        "<p style='margin:0;opacity:0.7;font-size:13px;'>" + escHtml(filename) + "</p>" +
        "<p style='margin:4px 0 0;font-size:12px;opacity:0.5;'>Compared with " + totalCompared + " found item(s)</p>";
    container.appendChild(header);

    if (errors.length > 0) {
        var errDiv = document.createElement("div");
        errDiv.style.cssText = "margin-bottom:20px;padding:14px;background:rgba(248,113,113,0.1);border-radius:8px;border:1px solid rgba(248,113,113,0.3);";
        errDiv.innerHTML =
            "<p style='color:#f87171;margin:0 0 8px;'><b>" + errors.length + " comparison(s) had issues</b></p>" +
            "<details><summary style='cursor:pointer;font-size:12px;color:#f87171;'>View details</summary>" +
            "<ul style='margin:8px 0 0;padding-left:18px;font-size:12px;color:#fca5a5;'>" +
            errors.map(function (e) { return "<li>" + escHtml(e.item) + ": " + escHtml(e.error) + "</li>"; }).join("") +
            "</ul></details>";
        container.appendChild(errDiv);
    }

    var goodMatches = matches.filter(function (m) { return m.confidence >= 35; });

    if (goodMatches.length === 0) {
        var noMatch = document.createElement("div");
        noMatch.style.cssText = "text-align:center;padding:30px;background:rgba(255,193,7,0.1);border-radius:12px;border:1px solid rgba(255,193,7,0.3);";
        noMatch.innerHTML =
            "<p style='color:#ffc107;font-size:20px;margin:0 0 10px;'><b>No matches found</b></p>" +
            "<p style='opacity:0.7;margin:0;'>The AI did not find similar items. Try a clearer photo.</p>";
        container.appendChild(noMatch);
    } else {
        goodMatches.slice(0, 5).forEach(function (match) { container.appendChild(buildMatchCard(match)); });
    }

    var footer = document.createElement("div");
    footer.style.cssText = "text-align:center;margin-top:28px;padding:16px;";
    footer.innerHTML = "<button onclick='clearUpload()' style='padding:12px 28px;background:rgba(248,113,113,0.15);border:2px solid rgba(248,113,113,0.4);border-radius:10px;color:#f87171;cursor:pointer;font-weight:bold;font-size:14px;'>Clear &amp; Upload New Image</button>";
    container.appendChild(footer);
}

function buildMatchCard(match) {
    var found = match.found, foundUser = found.User || found.user || {}, conf = match.confidence;
    var borderColor, bgColor, statusText, statusColor, badge;
    if      (conf >= 80) { borderColor="#22c55e"; bgColor="rgba(34,197,94,0.08)";   statusText="STRONG MATCH";   statusColor="#22c55e"; badge="HIGH"; }
    else if (conf >= 60) { borderColor="#eab308"; bgColor="rgba(234,179,8,0.08)";   statusText="GOOD MATCH";     statusColor="#eab308"; badge="MED";  }
    else                 { borderColor="#3b82f6"; bgColor="rgba(59,130,246,0.08)";  statusText="POSSIBLE MATCH"; statusColor="#3b82f6"; badge="LOW";  }

    var foundImgSrc = escHtml(found.imageurl || found.imageUrl || "");
    var userName    = escHtml(foundUser.name  || "Unknown");
    var userEmail   = escHtml(foundUser.email || "");
    var contactBtn  = conf >= 35
        ? "<div style='padding:0 20px 20px;'><button onclick=\"contactMatch('" + userEmail + "')\" style='width:100%;padding:14px;background:linear-gradient(135deg,var(--gold),#d97706);border:none;border-radius:10px;color:#000;font-weight:bold;font-size:15px;cursor:pointer;box-shadow:0 4px 15px rgba(245,158,11,0.4);'>Contact Finder: " + userName + "</button></div>"
        : "";

    var card = document.createElement("div");
    card.className = "match-card";
    card.style.cssText = "border:3px solid " + borderColor + ";margin-bottom:24px;background:" + bgColor + ";border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:all 0.2s;";
    card.onmouseenter = function () { this.style.transform="translateY(-4px)"; this.style.boxShadow="0 12px 40px rgba(0,0,0,0.4)"; };
    card.onmouseleave = function () { this.style.transform="translateY(0)";    this.style.boxShadow="0 8px 32px rgba(0,0,0,0.3)"; };

    card.innerHTML =
        "<div style='background:" + borderColor + "25;padding:14px 20px;text-align:center;border-bottom:2px solid " + borderColor + ";'>" +
            "<div style='display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:8px;'>" +
                "<span style='font-size:13px;font-weight:bold;color:" + statusColor + ";padding:3px 10px;background:rgba(0,0,0,0.3);border-radius:12px;'>" + badge + "</span>" +
                "<h2 style='margin:0;color:" + statusColor + ";font-size:17px;font-weight:bold;'>" + statusText + "</h2>" +
            "</div>" +
            "<div style='background:rgba(0,0,0,0.3);padding:8px 18px;border-radius:20px;display:inline-block;'>" +
                "<span style='font-size:30px;font-weight:bold;color:#fff;'>" + conf + "%</span>" +
                "<span style='font-size:13px;color:" + statusColor + ";margin-left:4px;'>match</span>" +
            "</div>" +
        "</div>" +
        "<div style='display:flex;gap:14px;padding:18px;align-items:stretch;background:rgba(0,0,0,0.2);'>" +
            "<div style='flex:1;text-align:center;padding:14px;background:rgba(59,130,246,0.1);border-radius:12px;border:2px solid #3b82f6;'>" +
                "<p style='font-size:12px;color:#3b82f6;margin-bottom:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;'>YOUR UPLOAD</p>" +
                "<img src='" + currentUploadedImage + "' style='width:100%;height:170px;object-fit:cover;border-radius:10px;border:3px solid #3b82f6;'>" +
            "</div>" +
            "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 8px;'><div style='font-size:22px;opacity:0.5;font-weight:bold;color:#fff;'>VS</div></div>" +
            "<div style='flex:1;text-align:center;padding:14px;background:rgba(34,197,94,0.1);border-radius:12px;border:2px solid #22c55e;'>" +
                "<p style='font-size:12px;color:#22c55e;margin-bottom:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;'>FOUND ITEM</p>" +
                "<img src='" + foundImgSrc + "' style='width:100%;height:170px;object-fit:cover;border-radius:10px;border:3px solid #22c55e;' onerror=\"this.style.display='none'\">" +
                "<h3 style='margin:12px 0 4px;font-size:16px;color:#fff;'>" + escHtml(found.item) + "</h3>" +
                "<p style='margin:0;font-size:12px;opacity:0.7;'>" + escHtml(found.location || "") + "</p>" +
                "<p style='margin:4px 0 0;font-size:11px;opacity:0.5;'>by " + userName + "</p>" +
            "</div>" +
        "</div>" +
        "<div style='padding:18px;background:rgba(0,0,0,0.3);'>" +
            "<h4 style='margin:0 0 12px;color:var(--gold);font-size:15px;border-bottom:2px solid var(--gold);padding-bottom:6px;display:inline-block;'>AI Analysis</h4>" +
            "<div style='background:rgba(255,255,255,0.05);padding:14px;border-radius:10px;border-left:4px solid var(--gold);font-size:13px;line-height:1.6;color:#e2e8f0;'>" + escHtml(match.reason) + "</div>" +
        "</div>" +
        contactBtn;

    return card;
}

function showSpinner(container, msg) {
    container.innerHTML =
        "<div style='text-align:center;margin-top:40px;'>" +
        "<div style='display:inline-block;width:48px;height:48px;border:4px solid rgba(91,200,245,0.25);border-top:4px solid #5bc8f5;border-radius:50%;animation:cfSpin 1s linear infinite;'></div>" +
        "<p style='margin-top:18px;opacity:0.8;'>" + msg + "</p></div>" +
        "<style>@keyframes cfSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>";
}

function msgBox(type, title, body) {
    var color  = type === "warning" ? "#ffc107" : "#f87171";
    var bg     = type === "warning" ? "rgba(255,193,7,0.1)"  : "rgba(248,113,113,0.1)";
    var border = type === "warning" ? "rgba(255,193,7,0.3)"  : "rgba(248,113,113,0.3)";
    return "<div style='text-align:center;padding:30px;background:" + bg + ";border-radius:12px;border:1px solid " + border + ";'>" +
        "<p style='color:" + color + ";font-size:18px;margin:0 0 10px;'><b>" + escHtml(title) + "</b></p>" +
        "<p style='opacity:0.7;margin:0;'>" + escHtml(body) + "</p></div>";
}

function escHtml(str) { return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function sleep(ms)     { return new Promise(function(r){ setTimeout(r,ms); }); }

function clearUpload() {
    currentUploadedImage = null;
    var fileInput = document.getElementById("aiImageInput");
    if (fileInput) fileInput.value = "";
    var inner   = document.getElementById("aiUploadInner");
    var preview = document.getElementById("aiImagePreview");
    var box     = document.getElementById("aiUploadCard");
    if (inner)   inner.style.display   = "flex";
    if (preview) preview.style.display = "none";
    if (box)     box.classList.remove("upload-box--has-image");
    var c = document.getElementById("matchContainer");
    if (c) c.innerHTML = "<p style='opacity:0.5;text-align:center;margin-top:30px;'>Upload an image and click <b>Run AI Image Analysis</b> to find matches.</p>";
}

function contactMatch(email) {
    if (email) window.location.href = "mailto:" + email + "?subject=CampusFinds%3A%20Match%20Found&body=Hi%2C%20I%20think%20I%20found%20your%20item%20on%20CampusFinds.";
    else alert("Contact email not available for this finder.");
}
