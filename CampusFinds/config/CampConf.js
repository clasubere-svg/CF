/* ============================================================
   CAMPUSFINDS CONFIGURATION
   Copy this file to config.js and fill in your actual values
   DO NOT commit config.js to GitHub - it's in .gitignore
   ============================================================ */

const CONFIG = {
  // Supabase Configuration
  SUPABASE_URL: "https://ijfjkvwvkunhkipchfep.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmprdnd2a3VuaGtpcGNoZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MTMsImV4cCI6MjA4Nzk0NzQxM30.fp9KwwU9U1YahKZdThXf5gWkfkRsj8CS1KbUa5bVCS4",
  
  // AI Server Configuration
  AI_SERVER_URL: "http://0.0.0.0:5000",
  
  // App Settings
  APP_NAME: "CampusFinds",
  APP_VERSION: "1.0.0"
};

// Make available globally
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}