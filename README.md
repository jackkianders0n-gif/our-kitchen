# Our Kitchen

Meal planning for two: a weekly plan, recipes with cooking mode, a pantry that learns how often you rebuy things, and a shared shopping list. It's a single-page web app (`index.html`) that you can install on your phone, with data synced through Supabase.

## Supabase setup

The app stores everything in one row per account in the `user_data` table (`kitchen_*` columns). Two optional steps turn on the newer features:

### 1. Live updates between phones

Turn this on and a change made on one phone shows up on the other straight away. Without it, the app still syncs safely, but it only checks for changes every 15 seconds and whenever you open it.

In the Supabase dashboard, open **SQL Editor** and run:

```sql
alter publication supabase_realtime add table public.user_data;
```

(Or go to **Database → Publications → supabase_realtime** and switch on `user_data`.)

### 2. Import recipes from a link

Recipe import uses a small Edge Function in `supabase/functions/import-recipe`. It fetches the recipe page, because browsers can't read other websites directly. Only signed-in users of the app can call it.

Deploy it with the Supabase CLI:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy import-recipe --no-verify-jwt
```

`--no-verify-jwt` is correct here: the function checks the sign-in itself, which works with both the legacy and the new Supabase API keys.

Without the CLI: go to **Edge Functions → Deploy a new function → Via editor**, name it `import-recipe`, paste in the contents of `supabase/functions/import-recipe/index.ts`, and turn off **Verify JWT** in the function's settings.

On Android, once the app is installed you can also share a link from Chrome straight to **Our Kitchen** to import it.

## Releasing changes

Installed copies of the app are served by the service worker from its cache. When you change `index.html`, bump `APP_VERSION` in `index.html` and `CACHE_VERSION` in `sw.js` together, so phones pick up the new version.
