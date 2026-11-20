# AccessAble Way

A responsive, browser-based prototype for finding Omaha-area places, sharing wheelchair-access notes, and planning an outing around personal interests.

## Run locally

The app loads `omaha_businesses_glide.csv` in the browser, so serve this folder over HTTP instead of opening `index.html` directly. From this folder, run:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`. Python 3 is required. If the CSV cannot be loaded, the app displays a small starter list and explains the limitation.

## Prototype behavior

- Search and filter the local Omaha-area directory, view wheelchair-access details when present, and add ratings and notes.
- View directory locations and community roadblock reports on an interactive Leaflet map using OpenStreetMap tiles.
- Place roadblock pins on the map or use browser location; reports are shared through Supabase and disappear from the map after 72 hours.
- Select outing interests and get suggestions based on directory categories.

## Share ratings and reports between devices

Ratings and roadblock reports are shared through Supabase when configured. The places directory remains in `omaha_businesses_glide.csv`; ratings are linked to each place by its `business_id`, and reports store latitude/longitude from the map pin. Without Supabase configuration, both continue to be saved only in the current browser.

1. Create a Supabase project at [supabase.com](https://supabase.com/).
2. In the Supabase SQL Editor, run the contents of `supabase-schema.sql` to create the ratings and reports tables and their row-level security policies. If you already ran an earlier version of this file, run the updated file again to add the reports table.
3. In `supabase-config.js`, set `url` to the project's Project URL and `anonKey` to its public anon/publishable key. Do not put a `service_role` or secret key in this file.
4. For local testing, run `python -m http.server 8000` and open `http://localhost:8000`. To let other people use the site, publish these files to a public web host; ratings and reports submitted after setup will then be visible to all visitors using the same Supabase project. The local Python server is not public website hosting.

The public policies allow anyone to read active reports and submit ratings or reports, but do not allow edits or deletes. Reports become hidden after 72 hours; expired rows remain in the database until manually cleaned up. This prototype has no sign-in or spam protection, so people can submit multiple ratings or reports. Add authentication, rate limiting, and moderation before relying on contributions for production decisions. Ratings or reports previously saved in browsers are not automatically copied into Supabase. Interests and favorites remain browser-local.

The Supabase free plan may pause projects after a week of inactivity. Directory access details can be incomplete or out of date; confirm directly with a venue before visiting.

The map uses OpenStreetMap's public tile server for prototype traffic and includes its attribution. For a public launch, use a tile provider whose usage policy supports your expected traffic. Geolocation requires visitor permission and an HTTPS site (localhost is allowed for development).
