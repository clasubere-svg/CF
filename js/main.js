/* ============================================================
   MAIN.JS — CampusFinds
   NOTE: Supabase returns columns lowercase: imageurl, reporttype etc.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function() {
  var form      = document.getElementById("reportForm");
  var container = document.getElementById("itemsContainer");
  if (form)      initReportForm(form);
  if (container) initListings();
});


/* ════════════════════════════════════════
   CONTENT FILTER — block inappropriate reports
   ════════════════════════════════════════ */

// ── 1. Explicit banned words (adult / drugs / weapons / vulgar) ──
const BANNED_WORDS = [
  // sexual / adult
  "condom","dildo","vibrator","lubricant","lube","sex toy","lingerie","thong",
  "panty","panties","bikini bottom","g-string","adult toy","fleshlight",
  "butt plug","anal","pornography","porn","nude","naked","xxx","erotic",
  // drugs / illegal
  "shabu","meth","marijuana","weed","cocaine","heroin","ecstasy","mdma",
  "drug","illegal substance","prohibited",
  // weapons
  "gun","firearm","pistol","grenade","bomb","explosives","ammo","bullet",
  "balisong","switchblade",
  // vulgar / offensive (Filipino + English)
  "putang","tangina","gago","bobo","puke","tite","pekpek","kantot",
  "malaswa","bastos","pornograpiya","fuck","shit","bitch","asshole"
];

// ── 2. Irrelevant / non-campus-item categories ──
// These are things that clearly don't belong in a campus lost & found
const IRRELEVANT_PATTERNS = [
  // Real estate / property
  { pattern: /(house|lot|condo|condominium|apartment|apt|property|real estate|land|parcel|bungalow|townhouse|villa|foreclos)/i,
    reason: "Real estate or property listings are not allowed. This platform is for lost & found campus items only." },
  // Persons / people
  { pattern: /(person|people|human|man|woman|boy|girl|child|baby|kid|infant|teen|student|missing person|pangit|tao)/i,
    reason: "You cannot report a missing person here. Please contact campus security or authorities for missing persons." },
  // Vehicles (large)
  { pattern: /(car|vehicle|motorcycle|motorbike|tricycle|jeepney|bus|truck|van|suv|sedan|pickup|bicycle|bike|scooter|e-bike|ebike)/i,
    reason: "Vehicles cannot be reported here. Only small personal items can be reported as lost or found." },
  // Animals / pets
  { pattern: /(dog|cat|pet|animal|bird|fish|rabbit|hamster|puppy|kitten|livestock|chicken|pig|cow|horse|snake|reptile)/i,
    reason: "Animals or pets cannot be reported here. Contact campus security or a local animal shelter instead." },
  // Food / consumables
  { pattern: /(food|meal|lunch|dinner|breakfast|snack|rice|viand|ulam|pagkain|drinks?|coffee|juice|water|beverage|masarap)/i,
    reason: "Food or consumable items cannot be reported as lost or found." },
  // Money is allowed — people can report lost/found cash on campus
  // For sale / buy / sell spam
  { pattern: /(for sale|buy|sell|selling|buying|pa-order|order|pwede ba|magkano|presyo|price|php|₱\s*\d|cod|meet up|meetup|gcash|paymaya)/i,
    reason: "Buy/sell or commercial listings are not allowed on this platform." },
  // Jobs / services
  { pattern: /(job|hiring|apply|applicant|resume|service|tutor|tutorial|freelance|work from home)/i,
    reason: "Job or service listings are not allowed here." },
  // Social / spam phrases
  { pattern: /(follow me|add me|dm me|message me|like and share|share this|viral|meme|joke|funny|lol|haha|hehe|test|testing|asdf|qwerty|aaaa|1234)/i,
    reason: "This does not appear to be a genuine lost or found report." },
  // Nonsense / gibberish (5+ repeated chars or all-same chars)
  { pattern: /(.){4,}/,
    reason: "Your report contains repeated characters that look like spam. Please describe the item clearly." },
];

// ── 3. Anti-spam: track recent submissions per session ──
var _recentSubmissions = [];   // array of timestamps
var SPAM_WINDOW_MS  = 5 * 60 * 1000;  // 5 minutes
var SPAM_MAX_COUNT  = 3;               // max 3 reports per 5 min

function recordSubmission() {
  var now = Date.now();
  _recentSubmissions.push(now);
  // keep only submissions within the window
  _recentSubmissions = _recentSubmissions.filter(function(t) { return now - t < SPAM_WINDOW_MS; });
}

function isSpamming() {
  var now = Date.now();
  var recent = _recentSubmissions.filter(function(t) { return now - t < SPAM_WINDOW_MS; });
  return recent.length >= SPAM_MAX_COUNT;
}

function getSpamCooldownSecs() {
  if (!_recentSubmissions.length) return 0;
  var oldest = _recentSubmissions[0];
  var waitUntil = oldest + SPAM_WINDOW_MS;
  return Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
}

// ── 4. Core check functions ──
function containsBannedContent(text) {
  var lower = (text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  var words = lower.split(/ +/);
  for (var i = 0; i < BANNED_WORDS.length; i++) {
    var banned = BANNED_WORDS[i].toLowerCase();
    if (banned.includes(" ")) {
      if (lower.includes(banned)) return BANNED_WORDS[i];
    } else {
      if (words.some(function(w) { return w === banned || w.startsWith(banned); })) return BANNED_WORDS[i];
    }
  }
  return null;
}

function checkAllFields(fields) {
  for (var i = 0; i < fields.length; i++) {
    var hit = containsBannedContent(fields[i]);
    if (hit) return hit;
  }
  return null;
}

function checkIrrelevantContent(fields) {
  var combined = fields.join(" ");
  for (var i = 0; i < IRRELEVANT_PATTERNS.length; i++) {
    var entry = IRRELEVANT_PATTERNS[i];
    if (entry.pattern.test(combined)) {
      return entry.reason;
    }
  }
  return null;
}

// ── 5. Duplicate check: same item name + location submitted recently ──
var _lastReport = null;
function isDuplicateReport(item, location) {
  if (!_lastReport) return false;
  var sameItem     = (item || "").toLowerCase().trim() === (_lastReport.item || "").toLowerCase().trim();
  var sameLoc      = (location || "").toLowerCase().trim() === (_lastReport.location || "").toLowerCase().trim();
  var withinWindow = (Date.now() - _lastReport.time) < 2 * 60 * 1000; // 2 min
  return sameItem && sameLoc && withinWindow;
}
function recordLastReport(item, location) {
  _lastReport = { item: item, location: location, time: Date.now() };
}

/* ════════════════════════════════════════
   REPORT FORM
   ════════════════════════════════════════ */
function showValidationError(msg) {
  var overlay = document.getElementById("validationOverlay");
  var msgEl   = document.getElementById("validationMsg");
  if (overlay && msgEl) {
    msgEl.textContent = msg;
    overlay.style.display = "flex";
  } else {
    alert(msg);
  }
}

function initReportForm(form) {
  // Live field warning on blur
  ["item_name","category","description","location"].forEach(function(fname) {
    var field = form.querySelector("[name='" + fname + "']");
    if (!field) return;
    field.addEventListener("input", function() {
      var hit = containsBannedContent(this.value);
      var irr = !hit ? checkIrrelevantContent([this.value]) : null;
      var hasError = hit || irr;
      this.style.borderColor = hasError ? "#f87171" : "";
      var warn = this.parentElement.querySelector(".field-warn");
      if (hasError) {
        if (!warn) {
          warn = document.createElement("p");
          warn.className = "field-warn";
          warn.style.cssText = "color:#f87171;font-size:12px;margin-top:4px;font-weight:600";
          this.parentElement.appendChild(warn);
        }
        warn.textContent = irr ? "Not allowed: " + irr.split(".")[0] + "." : "Inappropriate content detected.";
      } else if (warn) {
        warn.remove();
      }
    });
  });

  form.addEventListener("submit", async function(e) {
    e.preventDefault();

    var user = getSession();
    if (!user) { alert("Please log in to report an item."); return; }

    var btn = form.querySelector(".submit");
    btn.disabled = true; btn.textContent = "Submitting…";

    var reportType  = ((form.querySelector('input[name="item_type"]:checked') || {}).value || "lost");
    var item        = ((form.querySelector('[name="item_name"]')    || {}).value || "").trim();
    var category    = ((form.querySelector('[name="category"]')     || {}).value || "").trim();
    var description = ((form.querySelector('[name="description"]')  || {}).value || "").trim();
    var location    = ((form.querySelector('[name="location"]')     || {}).value || "").trim();
    var contact     = ((form.querySelector('[name="contact_email"]')|| {}).value || "").trim();
    var imageInput  = form.querySelector('[name="image"]');
    var imageFile   = imageInput && imageInput.files[0];

    if (!item || !category || !location) {
      showValidationError("Please fill in Item Name, Category, and Location.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    if (!contact) {
      showValidationError("Contact Email is required so people can reach you about this item.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      showValidationError("Please enter a valid Contact Email address.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    // ── Anti-spam check ──
    if (isSpamming()) {
      var secs = getSpamCooldownSecs();
      var mins = Math.ceil(secs / 60);
      showValidationError("Too many reports submitted.\nPlease wait " + mins + " minute(s) before submitting again.\n\nCampusFinds allows a maximum of 3 reports every 5 minutes.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    // ── Duplicate check ──
    if (isDuplicateReport(item, location)) {
      showValidationError("Duplicate report detected.\nYou recently submitted a report for \"" + item + "\" at the same location.\n\nIf this is a different item, please wait a moment before resubmitting.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    // ── Irrelevant content (house, person, vehicle, food, etc.) ──
    var irrelevantReason = checkIrrelevantContent([item, description, location]);
    if (irrelevantReason) {
      showValidationError(irrelevantReason);
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    // ── Explicit banned words ──
    var bannedHit = checkAllFields([item, category, description, location]);
    if (bannedHit) {
      showValidationError("Inappropriate content detected.\nThis platform is for lost & found campus items only.\n\nPlease remove the inappropriate content and try again.");
      btn.disabled = false; btn.textContent = "Report Item";
      return;
    }

    var imageUrl = null;
    if (imageFile) {
      imageUrl = await uploadImage(imageFile, "item-images");
      if (!imageUrl) {
        imageUrl = await new Promise(function(resolve) {
          var r = new FileReader();
          r.onload = function(e) { resolve(e.target.result); };
          r.readAsDataURL(imageFile);
        });
      }
    }

    try {
      var newReport = await createReport({
        userId:     user.id,
        item:       item,
        description:description,
        category:   category,
        location:   location,
        reportType: reportType.charAt(0).toUpperCase() + reportType.slice(1),
        contact:    contact,
        imageUrl:   imageUrl,
      });

      recordSubmission();
      recordLastReport(item, location);
      form.reset();
      // Reset image preview after submit
      var inner = document.getElementById('reportUploadInner');
      var preview = document.getElementById('reportUploadPreview');
      var box = document.getElementById('reportUploadBox');
      if (inner) inner.style.display = 'flex';
      if (preview) preview.style.display = 'none';
      if (box) box.classList.remove('upload-box--has-image');
      btn.disabled = false; btn.textContent = "Report Item";
      alert("Item reported successfully! Your report is under review and will appear in the listings once approved by an admin.");
    } catch(err) {
      console.error("Report error:", err);
      alert("Failed to submit report: " + err.message);
      btn.disabled = false; btn.textContent = "Report Item";
    }
  });
}

/* ════════════════════════════════════════
   LISTINGS
   ════════════════════════════════════════ */
var allItems  = [];
var editingId = null;

async function initListings() { await loadItems(); bindSearch(); }

async function loadItems() {
  var container = document.getElementById("itemsContainer");
  if (!container) return;
  container.innerHTML = "<p style='opacity:0.6;margin-top:20px'>Loading…</p>";
  try {
    allItems = await getAllReports() || [];
    displayItems(allItems);
  } catch(err) {
    container.innerHTML = "<p style='color:#f87171'>Failed to load: " + err.message + "</p>";
  }
}

function getReporter(item) { return item.User || item.user || null; }

function getImageUrl(item) {
  // DB returns imageurl (lowercase)
  return item.imageurl || item.imageUrl || null;
}

function getReportType(item) {
  return item.reporttype || item.reportType || "";
}

function displayItems(items) {
  var container = document.getElementById("itemsContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!items || !items.length) {
    container.innerHTML = "<p style='opacity:0.6;margin-top:20px'>No items found.</p>";
    return;
  }

  // Only show admin-approved reports
  items = items.filter(function(item) {
    return (item.status || "approved") === "approved";
  });

  // Filter out any items that contain banned/sexual words (already in DB)
  items = items.filter(function(item) {
    var fields = [item.item, item.description, item.category, item.location];
    return !checkAllFields(fields);
  });

  if (!items.length) {
    container.innerHTML = "<p style='opacity:0.6;margin-top:20px'>No items found.</p>";
    return;
  }

  var session = getSession();

  items.forEach(function(item) {
    var reporter   = getReporter(item);
    var rType      = getReportType(item);
    var imgUrl     = getImageUrl(item);
    var isOwner    = session && (item.user_id === session.id || (reporter && reporter.id === session.id));

    var isClaimed = item.is_claimed === true || item.is_claimed === 'true' || item.is_claimed === 1;
    var badge = rType.toLowerCase() === "lost"
      ? "<span style='background:#ef4444;color:white;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700'>LOST</span>"
      : "<span style='background:#22c55e;color:white;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700'>FOUND</span>";
    var claimedBadge = isClaimed
      ? "<span class='status-claimed-badge'>Claimed</span>"
      : "";

    var ownerBtns = isOwner
      ? "<button class='edit-btn' data-edit='" + item.id + "'>Edit</button>" +
        "<button class='delete-btn' data-del='" + item.id + "'>Delete</button>"
      : "";

    var card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML =
      "<img src='" + escHtml(imgUrl || "images/placeholder.png") + "' class='item-image' onerror=\"this.style.display='none'\">" +
      "<h3>" + escHtml(item.item) + "</h3>" +
      "<div style='margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap'>" + badge + claimedBadge + "</div>" +
      "<p><b>Category:</b> " + escHtml(item.category) + "</p>" +
      "<p><b>Location:</b> " + escHtml(item.location) + "</p>" +
      "<p style='opacity:0.75;font-size:13px;margin-top:4px'>" + escHtml(item.description || "") + "</p>" +
      "<small style='opacity:0.55'>Reported by: " + escHtml((reporter && (reporter.name)) || "Unknown") + "</small>" +
      "<div class='item-actions' style='margin-top:10px'>" +
        "<button class='edit-btn view-btn-inner'>View</button>" + ownerBtns +
      "</div>";

    card.querySelector(".view-btn-inner").addEventListener("click", function() { openItemModal(item); });
    if (isOwner) {
      var eb = card.querySelector("[data-edit]");
      var db = card.querySelector("[data-del]");
      if (eb) eb.addEventListener("click", function() { editItem(item); });
      if (db) db.addEventListener("click",  function() { deleteItem(item.id); });
    }
    container.appendChild(card);
  });
}

/* ── Search & Filter ── */
function bindSearch() {
  ["searchInput","typeFilter","categoryFilter"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.addEventListener("input", filterItems); el.addEventListener("change", filterItems); }
  });
}

function filterItems() {
  var text = ((document.getElementById("searchInput")    ||{}).value||"").toLowerCase();
  var type = (document.getElementById("typeFilter")      ||{}).value||"All";
  var cat  = (document.getElementById("categoryFilter")  ||{}).value||"All";

  var filtered = allItems.filter(function(item) {
    var rt = getReportType(item);
    var matchSearch = !text ||
      (item.item||"").toLowerCase().includes(text) ||
      (item.description||"").toLowerCase().includes(text) ||
      (item.location||"").toLowerCase().includes(text);
    var matchType = type==="All" || rt.toLowerCase()===type.toLowerCase();
    var matchCat  = cat==="All"  || (item.category||"").toLowerCase()===cat.toLowerCase();
    return matchSearch && matchType && matchCat;
  });
  displayItems(filtered);
}

/* ── View Modal ── */
function openItemModal(item) {
  var modal = document.getElementById("itemModal");
  if (!modal) return;
  var reporter = getReporter(item);
  var imgUrl   = getImageUrl(item);
  var type     = getReportType(item);

  // Image + placeholder
  var imgEl = document.getElementById("modalImage");
  var ph    = document.getElementById("modalImgPlaceholder");
  if (imgUrl) {
    imgEl.src = imgUrl;
    imgEl.style.display = "block";
    if (ph) ph.style.display = "none";
  } else {
    imgEl.src = "";
    imgEl.style.display = "none";
    if (ph) ph.style.display = "flex";
  }

  document.getElementById("modalTitle").textContent       = item.item;
  document.getElementById("modalCategory").textContent    = item.category;
  document.getElementById("modalLocation").textContent    = item.location;
  document.getElementById("modalDescription").textContent = item.description || "No description provided.";
  document.getElementById("modalReporter").textContent    = (reporter && reporter.name) || "Unknown";

  // Claimed status badge
  var isClaimed = item.is_claimed === true || item.is_claimed === 'true' || item.is_claimed === 1;
  var statusEl = document.getElementById("modalStatusBadge");
  if (statusEl) {
    statusEl.textContent = isClaimed ? "Claimed" : "Pending";
    statusEl.className   = "modal-status-badge " + (isClaimed ? "claimed" : "pending");
  }

  // Type badge
  var badge = document.getElementById("modalTypeBadge");
  if (badge) {
    badge.textContent  = type;
    badge.className    = "modal-type-badge " + (type.toLowerCase() === "lost" ? "lost" : "found");
  }

  modal.style.display = "flex";
}
function closeItemModal() { var m=document.getElementById("itemModal"); if(m) m.style.display="none"; }

window.addEventListener("click", function(e) {
  var modal = document.getElementById("itemModal");
  var edit  = document.getElementById("editModal");
  if (modal && e.target===modal) modal.style.display="none";
  if (edit  && e.target===edit)  edit.style.display ="none";
});

/* ── Delete ── */
async function deleteItem(id) {
  if (!confirm("Delete this item?")) return;
  try { await deleteReport(id); await loadItems(); }
  catch(err) { alert("Delete failed: " + err.message); }
}

/* ── Edit ── */
function editItem(item) {
  editingId = item.id;
  document.getElementById("editName").value        = item.item;
  document.getElementById("editLocation").value    = item.location;
  document.getElementById("editDescription").value = item.description || "";

  // Pre-select the correct category in the dropdown
  var catSelect = document.getElementById("editCategory");
  if (catSelect) {
    var opts = catSelect.options;
    var matched = false;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value.toLowerCase() === (item.category || "").toLowerCase()) {
        catSelect.selectedIndex = i;
        matched = true;
        break;
      }
    }
    // If category not in list, fall back to "Others"
    if (!matched) {
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].value === "Others") { catSelect.selectedIndex = j; break; }
      }
    }
  }

  document.getElementById("editModal").style.display = "flex";
}
function closeEditModal() { var m=document.getElementById("editModal"); if(m) m.style.display="none"; }

async function saveEdit() {
  if (!editingId) return;
  var name     = (document.getElementById("editName").value || "").trim();
  var location = (document.getElementById("editLocation").value || "").trim();
  var desc     = (document.getElementById("editDescription").value || "").trim();
  var catSel   = document.getElementById("editCategory");
  var category = catSel ? (catSel.value || "").trim() : "";

  if (!name || !category || !location) {
    alert("Please fill in Item Name, Category, and Location.");
    return;
  }
  try {
    await updateReport(editingId, {
      item:        name,
      category:    category,
      location:    location,
      description: desc,
    });
    closeEditModal();
    await loadItems();
  } catch(err) { alert("Save failed: " + err.message); }
}

/* ── Util ── */
function escHtml(str) {
  return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
