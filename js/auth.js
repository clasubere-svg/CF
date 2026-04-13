/* ============================================================
   AUTH.JS — CampusFinds
   ============================================================ */

async function hashPassword(pw) {
  var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,"0"); }).join("");
}

/* ── Modal helpers ── */
function openModal(id)     { var el = document.getElementById(id); if (el) el.classList.add("show"); }
function closeModal(id)    { var el = document.getElementById(id); if (el) el.classList.remove("show"); }
function switchModal(a, b) { closeModal(a); openModal(b); }

/* Close on backdrop click */
window.addEventListener("click", function(e) {
  document.querySelectorAll(".modal").forEach(function(m) {
    if (e.target === m) m.classList.remove("show");
  });
});

/* ── Enter key: move to next input or submit ── */
function bindEnterKey(modalId, submitFn) {
  var box = document.getElementById(modalId);
  if (!box) return;
  var inputs = Array.from(box.querySelectorAll("input"));
  inputs.forEach(function(input, idx) {
    input.addEventListener("keydown", function(e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (idx < inputs.length - 1) {
        inputs[idx + 1].focus();
      } else {
        submitFn();
      }
    });
  });
}

/* ── Nav profile bar ── */
function showProfile(user) {
  var area = document.getElementById("profileArea");
  var pic  = document.getElementById("navProfilePic");
  var lBtn = document.querySelector(".btn.login");
  var sBtn = document.querySelector(".btn.signup");
  if (area) area.style.display = "flex";
  if (pic) {
    pic.src = user.imageurl || user.imageUrl || "images/default-avatar.png";
    pic.style.cursor = "pointer";
    pic.title = "View Profile";
    pic.onclick = function() { openProfileModal(user); };
  }
  if (lBtn) lBtn.style.display = "none";
  if (sBtn) sBtn.style.display = "none";
}

function logoutUser() {
  clearSession();
  location.reload();
}

/* Restore session on every page load */
(function autoLogin() {
  var user = getSession();
  if (user) showProfile(user);
})();

/* ════════════════════════════════════════
   PROFILE MODAL
   ════════════════════════════════════════ */
function openProfileModal(user) {
  var modal = document.getElementById("profileModal");
  if (!modal) return;
  // Populate fields
  document.getElementById("profileModalName").textContent  = user.name  || "";
  document.getElementById("profileModalEmail").textContent = user.email || "";
  document.getElementById("profileModalPhone").textContent = user.contact || "Not set";
  var img = document.getElementById("profileModalPic");
  if (img) img.src = user.imageurl || user.imageUrl || "images/default-avatar.png";
  modal.classList.add("show");
}

function closeProfileModal() {
  var modal = document.getElementById("profileModal");
  if (modal) modal.classList.remove("show");
}

async function changeProfilePicture() {
  var input = document.getElementById("profileChangePic");
  if (!input || !input.files[0]) { alert("Please choose a photo first."); return; }

  var user = getSession();
  if (!user) return;

  var file = input.files[0];
  var btn  = document.getElementById("changePicBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  var imageUrl = await uploadImage(file, "profile-images");
  if (!imageUrl) {
    // fallback: dataURL
    imageUrl = await new Promise(function(resolve) {
      var r = new FileReader();
      r.onload = function(e) { resolve(e.target.result); };
      r.readAsDataURL(file);
    });
  }

  try {
    await updateUserImage(user.id, imageUrl);
    user.imageurl = imageUrl;
    setSession(user);
    // Update all profile pics on page
    var navPic = document.getElementById("navProfilePic");
    if (navPic) { navPic.src = imageUrl; navPic.onclick = function(){ openProfileModal(user); }; }
    var modalPic = document.getElementById("profileModalPic");
    if (modalPic) modalPic.src = imageUrl;
    alert("Profile picture updated! ");
  } catch(err) {
    alert("Failed to update: " + err.message);
  }

  if (btn) { btn.disabled = false; btn.textContent = "Save Photo"; }
}

/* ════════════════════════════════════════
   SIGNUP
   ════════════════════════════════════════ */
async function signupUser() {
  var name    = ((document.getElementById("signupName")    ||{}).value||"").trim();
  var email   = ((document.getElementById("signupEmail")   ||{}).value||"").trim();
  var phone   = ((document.getElementById("signupPhone")   ||{}).value||"").trim();
  var password= (document.getElementById("signupPassword") ||{}).value||"";
  var confirm = (document.getElementById("signupConfirm")  ||{}).value||"";
  var fileEl  = document.getElementById("profileInput");

  if (!name || !email || !password) { alert("Please fill in all required fields."); return; }
  if (password.length < 8)           { alert("Password must be at least 8 characters long."); return; }
  if (password !== confirm)          { alert("Passwords do not match.");             return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Please enter a valid email."); return; }

  try {
    var existing = await getUserByEmail(email);
    if (existing) { alert("An account with this email already exists."); return; }
  } catch(e) { console.warn("Duplicate check failed:", e); }

  var pwHash = await hashPassword(password);

  var imageUrl = null;
  if (fileEl && fileEl.files[0]) {
    imageUrl = await uploadImage(fileEl.files[0], "profile-images");
    if (!imageUrl) {
      imageUrl = await new Promise(function(resolve) {
        var r = new FileReader(); r.onload = function(e){ resolve(e.target.result); }; r.readAsDataURL(fileEl.files[0]);
      });
    }
  }

  try {
    var newUser = await createUser({ name: name, email: email, passwordHash: pwHash, imageUrl: imageUrl, contact: phone });
    if (!newUser || !newUser.id) throw new Error("No user returned. Check Supabase RLS policies.");
    setSession(newUser);
    showProfile(newUser);
    closeModal("signupModal");
    alert("Signup successful! Welcome, " + newUser.name + " ");
  } catch(err) {
    console.error("Signup error:", err);
    alert("Signup failed: " + err.message);
  }
}

/* ════════════════════════════════════════
   LOGIN
   ════════════════════════════════════════ */
async function loginUser() {
  var email    = ((document.getElementById("loginEmail")   ||{}).value||"").trim();
  var password = (document.getElementById("loginPassword") ||{}).value||"";

  // Admin shortcut — set session flag then go straight to admin dashboard
  if (email === "admin" && password === "Campusfinds2026") {
    sessionStorage.setItem("cfAdmin", "1");
    window.location.href = "admin.html";
    return;
  }

  if (!email || !password) { alert("Please enter your email and password."); return; }

  try {
    var user = await getUserByEmail(email);
    if (!user) { alert("No account found with this email."); return; }

    var pwHash = await hashPassword(password);
    if (user.passwordhash !== pwHash) { alert("Incorrect password."); return; }

    try { await logLogin(user.id); } catch(_) {}

    setSession(user);
    showProfile(user);
    closeModal("loginModal");
    alert("Welcome back, " + user.name + "!");
  } catch(err) {
    console.error("Login error:", err);
    alert("Login failed: " + err.message);
  }
}

/* ── Profile picture preview ── */
document.addEventListener("DOMContentLoaded", function() {
  // Enter key navigation
  bindEnterKey("loginModal",  loginUser);
  bindEnterKey("signupModal", signupUser);

  // Profile pic preview
  var input   = document.getElementById("profileInput");
  var preview = document.getElementById("profilePreview");
  if (input && preview) {
    input.addEventListener("change", function() {
      var file = this.files[0];
      if (file) { var r = new FileReader(); r.onload = function(e){ preview.src = e.target.result; }; r.readAsDataURL(file); }
    });
  }

  // Change pic preview inside profile modal
  var changePic = document.getElementById("profileChangePic");
  var changePreview = document.getElementById("profileModalPic");
  if (changePic && changePreview) {
    changePic.addEventListener("change", function() {
      var file = this.files[0];
      if (file) { var r = new FileReader(); r.onload = function(e){ changePreview.src = e.target.result; }; r.readAsDataURL(file); }
    });
  }
});
