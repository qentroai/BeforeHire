# Statute — Original Prototype UI + Supabase

This package keeps the original `statute-prototype-v4.html` UI as `index.html`.
Supabase is added behind it for Auth, company isolation, legal reference data, and persisted Hiring Compliance Files.

GitHub Pages: publish `main` → `/(root)`.

Before upload:
1. Edit `config.js`.
2. Deploy `supabase/functions/run-check`.
3. Configure Supabase Auth redirect URL to your GitHub Pages URL.
4. Load reviewed legal requirements before real customer use.
