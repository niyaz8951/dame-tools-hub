/* ============================================================
   DAME Tools Hub - site settings. This is the ONLY file you edit
   to connect the website to your database.

   Leave SUPABASE_URL empty to run in DEMO MODE (no database, data
   kept in this browser only, login: admin / admin12345).
   ============================================================ */
window.HUB_CONFIG = {
  SITE_NAME: "DAME Tools Hub",

  // Supabase > Project Settings > API
  SUPABASE_URL: "https://oaoapindwlydxhgfltgz.supabase.co",          // e.g. "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hb2FwaW5kd2x5ZHhoZ2ZsdGd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NzIxMTMsImV4cCI6MjEwNjM0ODExM30.I5EY7Vz0C_B3Sy7IVhpD8sjsxxlia94D3hiXvQaqYoQ"      // the "anon public" key (safe to publish; never paste the service_role key)
};
