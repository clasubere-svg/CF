/* ============================================================
   SUPABASE CLIENT — CampusFinds
   All DB column names are LOWERCASE to match PostgreSQL behavior
   ============================================================ */

// Configuration is loaded from CampConf.js (not committed to GitHub)
// Make sure to copy CampConf.js.template to CampConf.js and fill in your values

(function() {
  // Check if CONFIG is available
  if (typeof CONFIG === 'undefined') {
    console.error(" CONFIG not found! Make sure CampConf.js is loaded before supabase.js");
    console.error("   1. Copy CampConf.js.template to CampConf.js");
    console.error("   2. Fill in your Supabase credentials");
    console.error("   3. Include CampConf.js in your HTML before supabase.js");
    
    // Provide fallback empty values to prevent crashes
    window.CONFIG = {
      SUPABASE_URL: "https://ijfjkvwvkunhkipchfep.supabase.co",
      SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmprdnd2a3VuaGtpcGNoZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MTMsImV4cCI6MjA4Nzk0NzQxM30.fp9KwwU9U1YahKZdThXf5gWkfkRsj8CS1KbUa5bVCS4"
    };
  }
})();

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_ANON = CONFIG.SUPABASE_ANON_KEY;

/* ── Warm-up ping: wake Supabase on page load so the real query hits a live DB ── */
(function warmUpSupabase() {
  if (!SUPABASE_URL) {
    console.warn("️  Supabase URL not configured. Check CampConf.js");
    return;
  }
  fetch(SUPABASE_URL + "/rest/v1/Report?limit=1&select=id", {
    headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON }
  }).catch(function(err) {
    console.log("Supabase warm-up failed (expected if offline):", err);
  });
})();


async function sbFetch(path, method, body, prefer) {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Supabase not configured. Check CampConf.js");
  }

  method = method || "GET";
  prefer = prefer || "return=representation";
  
  const headers = {
    "apikey":        SUPABASE_ANON,
    "Authorization": "Bearer " + SUPABASE_ANON,
    "Content-Type":  "application/json",
    "Prefer":        prefer,
  };
  
  const opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, opts);
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error("Supabase " + res.status + ": " + errText);
    }
    
    if (res.status === 204) return null;
    return res.json();
    
  } catch (err) {
    console.error("Supabase fetch error:", err);
    throw err;
  }
}

/* ════════════════════════════════════════
   USERS
   Columns: id, name, email, passwordhash, contact, imageurl, createdat
   ════════════════════════════════════════ */
async function createUser(opts) {
  try {
    var name         = opts.name;
    var email        = opts.email;
    var passwordHash = opts.passwordHash;
    var imageUrl     = opts.imageUrl  || null;
    var contact      = opts.contact   || null;

    var rows = await sbFetch("User", "POST", {
      name:         name,
      email:        email,
      passwordhash: passwordHash,
      imageurl:     imageUrl,
      contact:      contact,
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    console.error("createUser error:", err);
    throw err;
  }
}

async function getUserByEmail(email) {
  try {
    var rows = await sbFetch("User?email=eq." + encodeURIComponent(email) + "&limit=1");
    return (rows && rows[0]) || null;
  } catch (err) {
    console.error("getUserByEmail error:", err);
    return null;
  }
}

/* ════════════════════════════════════════
   LOGIN HISTORY
   Columns: id, user_id, logintime
   ════════════════════════════════════════ */
async function logLogin(userId) {
  try {
    return await sbFetch("LoginHistory", "POST",
      { user_id: userId },
      "return=minimal"
    );
  } catch (err) {
    console.error("logLogin error:", err);
    return null;
  }
}

/* ════════════════════════════════════════
   REPORTS
   Columns: id, user_id, item, description, category, location,
            reporttype, contact, imageurl, reporttime
   ════════════════════════════════════════ */
async function createReport(opts) {
  try {
    // Ensure imageUrl is a proper URL, not base64
    var imageUrl = opts.imageUrl || null;
    if (imageUrl && imageUrl.startsWith('data:image')) {
      console.warn("Warning: imageUrl appears to be base64. Should upload to storage first.");
    }
    
    var rows = await sbFetch("Report", "POST", {
      user_id:     opts.userId,
      item:        opts.item,
      description: opts.description,
      category:    opts.category,
      location:    opts.location,
      reporttype:  opts.reportType,
      contact:     opts.contact  || null,
      imageurl:    imageUrl,
      status:      "pending",
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    console.error("createReport error:", err);
    throw err;
  }
}

async function getAllReports() {
  try {
    // Try with FK join first
    return await sbFetch(
      "Report?order=reporttime.desc&select=*,User!Report_user_id_fkey(id,name,email,imageurl)"
    );
  } catch (err) {
    console.warn("FK join failed, falling back to simple query:", err);
    // Fallback: reports only, no user join
    var rows = await sbFetch("Report?order=reporttime.desc");
    return (rows || []).map(function(r) { 
      return Object.assign({}, r, { User: null }); 
    });
  }
}

async function updateReport(id, fields) {
  try {
    return await sbFetch("Report?id=eq." + id, "PATCH",
      { 
        item: fields.item, 
        description: fields.description,
        category: fields.category, 
        location: fields.location 
      },
      "return=minimal"
    );
  } catch (err) {
    console.error("updateReport error:", err);
    throw err;
  }
}

async function deleteReport(id) {
  try {
    return await sbFetch("Report?id=eq." + id, "DELETE", null, "return=minimal");
  } catch (err) {
    console.error("deleteReport error:", err);
    throw err;
  }
}

/* ════════════════════════════════════════
   IMAGE UPLOAD  (Supabase Storage)
   ════════════════════════════════════════ */
async function uploadImage(file, bucket) {
  bucket = bucket || "item-images";
  
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.error("Cannot upload image: Supabase not configured");
    return null;
  }

  try {
    var ext  = file.name.split(".").pop().toLowerCase();
    var path = Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
    
    var res  = await fetch(
      SUPABASE_URL + "/storage/v1/object/" + bucket + "/" + path,
      {
        method:  "POST",
        headers: {
          "apikey":        SUPABASE_ANON,
          "Authorization": "Bearer " + SUPABASE_ANON,
          "Content-Type":  file.type,
        },
        body: file,
      }
    );
    
    if (!res.ok) {
      var errText = await res.text();
      console.error("Upload failed:", errText);
      return null;
    }
    
    // Return the public URL
    return SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + path;
    
  } catch (err) {
    console.error("uploadImage error:", err);
    return null;
  }
}

/* ════════════════════════════════════════
   SESSION  (localStorage)
   ════════════════════════════════════════ */
function setSession(user)  { 
  try {
    localStorage.setItem("cf_user", JSON.stringify(user)); 
  } catch (err) {
    console.error("setSession error:", err);
  }
}

function getSession() { 
  try { 
    return JSON.parse(localStorage.getItem("cf_user") || "null"); 
  } catch(_) { 
    return null; 
  } 
}

function clearSession() { 
  try {
    localStorage.removeItem("cf_user"); 
  } catch (err) {
    console.error("clearSession error:", err);
  }
}

/* ════════════════════════════════════════
   UPDATE USER IMAGE
   ════════════════════════════════════════ */
async function updateUserImage(userId, imageUrl) {
  try {
    // Ensure we're storing a URL, not base64
    if (imageUrl && imageUrl.startsWith('data:image')) {
      console.error("Cannot store base64 image in user profile. Upload to storage first.");
      return null;
    }
    
    return await sbFetch("User?id=eq." + userId, "PATCH",
      { imageurl: imageUrl },
      "return=minimal"
    );
  } catch (err) {
    console.error("updateUserImage error:", err);
    throw err;
  }
}