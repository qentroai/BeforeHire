# Setup

## 1. Create Supabase
Create a Supabase project. Save:
- Project URL
- Publishable/anon key
- Project reference ID

## 2. Create database schema
Supabase Dashboard → SQL Editor.
Run the full contents of:
`supabase/migrations/001_schema.sql`

This creates customer/company tables, legal reference tables, hiring cases, RLS policies, and a six-company cap.

## 3. Configure Auth
Supabase Dashboard → Authentication.
Use passwordless email / OTP.
After GitHub Pages is live, set Site URL and Redirect URL to:
`https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO/`

For local testing also allow:
`http://localhost:8080`

## 4. Deploy Edge Function
Install CLI:
`npm install -g supabase`

Then:
`supabase login`
`supabase link --project-ref YOUR_PROJECT_REF`
`supabase functions deploy run-check --project-ref YOUR_PROJECT_REF`

## 5. Configure frontend
Edit `config.js`:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY

Never put the service-role key in browser files.

## 6. Push to GitHub
Create a repo, then:
`git init`
`git add .`
`git commit -m "Initial Statute pilot"`
`git branch -M main`
`git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git`
`git push -u origin main`

GitHub → Settings → Pages:
- Source: Deploy from a branch
- Branch: main
- Folder: /(root)

## 7. One-time scrape
Open `data/source_registry.csv`.
For every row you want to ingest, enter:
- official agency
- official source title
- exact official URL

The package intentionally leaves URLs blank rather than guessing legal sources.

Create Python env:
`python -m venv .venv`

macOS/Linux:
`source .venv/bin/activate`

Windows PowerShell:
`.\.venv\Scripts\Activate.ps1`

Install:
`pip install -r scripts/requirements.txt`

Set server-side credentials.

macOS/Linux:
`export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"`
`export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"`

PowerShell:
`$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"`
`$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"`

Run:
`python scripts/scrape_sources.py`

The scraper:
1. fetches each URL,
2. extracts readable page text,
3. hashes it,
4. stores a source snapshot in Supabase,
5. marks changed/new sources for review.

## 8. Review and load legal requirements
Fill `data/reviewed_requirements.csv`.

Each approved row needs:
- state/category
- green/yellow/red
- requirement text
- action
- owner
- deadline
- effective date
- verified date
- official source URL

Then run:
`python scripts/import_reviewed_requirements.py`

Old versions are retained; the importer only marks the new reviewed version active.

## 9. Pilot isolation test
Create two customer accounts.
Create a hiring case as Customer A.
Sign in as Customer B.
Customer B must not see Customer A's case. RLS enforces this in Postgres.

## 10. Before real customers
Do not invite pilot customers until:
- every supported state/category has an approved requirement version,
- source URLs and verification dates are checked,
- customer-isolation tests pass,
- legal framing/disclaimer is reviewed,
- the six-company cap behaves as expected.
