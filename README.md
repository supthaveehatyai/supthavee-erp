# Supthavee ERP SuperApp

Next.js + Supabase ERP for บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด.

## Environment variables (no more `.env.local` switching)

Next.js loads env files by `NODE_ENV` automatically:

| Command | `NODE_ENV` | File loaded |
|---|---|---|
| `npm run dev` | `development` | `.env.development` → Local Supabase `http://127.0.0.1:54321` |
| `npm run build` / `npm start` | `production` | `.env.production` → Cloud Supabase |

**Do not create `.env.local` for flipping Local ↔ Cloud.** That file overrides both and causes accidental mix-ups.

- Template: `.env.example` (safe to commit)
- Secrets stay gitignored via `.env*` (except `.env.example`)

After changing env files, restart the Next.js process.

On Vercel / CI, set the same Cloud keys in the host dashboard (do not rely on committing `.env.production`).

---

## Sync Cloud schema → Local via migrations (`supabase db pull`)

Pulls the remote (Cloud) public schema — including `contacts`, `vendor_product_mapping`, and related tables — into a migration that you apply locally.

```bash
# 0) From the repo root
cd C:\STV_ERP\supthavee-erp

# 1) One-time: login + init (skip init if supabase/config.toml already exists)
supabase login
supabase init

# 2) Link this folder to the Cloud project (project ref from the dashboard URL)
#    Example ref for https://xurwbxpzzlrlntpywtdi.supabase.co → xurwbxpzzlrlntpywtdi
supabase link --project-ref xurwbxpzzlrlntpywtdi

# 3) Start Local Supabase (Docker must be running)
supabase start

# 4) Pull Cloud schema into a new migration under supabase/migrations/
#    This introspects the linked remote DB (contacts, vendor_product_mapping, etc.)
supabase db pull

#    Optional: limit to public schema only
#    supabase db pull --schema public

# 5) Apply migrations to Local (resets local DB to match migration history)
supabase db reset

# 6) Confirm Local keys (paste anon key into .env.development if it changed)
supabase status
```

### Useful follow-ups

```bash
# List migration files created by db pull
dir supabase\migrations

# Re-diff after more Cloud changes
supabase db pull

# Push local migrations UP to Cloud (only when intentionally promoting schema)
# supabase db push
```

---

## Edge Functions — secrets checklist

### `process-receipt-ocr` (Smart Goods Receipt / Gemini Vision)

**Required:** set `GEMINI_API_KEY` in the Supabase project secrets before deploying or calling this function. Without it, invoice OCR will fail at runtime.

```bash
# From the project root (with Supabase CLI linked to the project)
supabase secrets set GEMINI_API_KEY=your_google_ai_studio_key

# Deploy
supabase functions deploy process-receipt-ocr
```

Optional:

```bash
supabase secrets set GEMINI_MODEL=gemini-3.5-flash
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically by the Edge runtime.
