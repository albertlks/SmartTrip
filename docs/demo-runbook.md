# SmartTrip demo runbook (M2, demo 2)

## Quick guide: a live demo with real calls

This is the whole demo from a fresh terminal: the real model on the course gateway, real Google Flights and Google Hotels through SerpApi, and real Open-Meteo weather. The sections after it have the details and what to do when something breaks.

**Already done (Nov 4):** `.env.local` has `FLIGHT_PROVIDER=serpapi` and `HOTEL_PROVIDER=serpapi`, and the cache is warm for all three demo routes until about 4 pm tomorrow. A rehearsal of request 1 worked end to end.

**What it costs:** each search you type is about 20-30k model tokens on the course gateway. SerpApi searches are free while cached (24 hours after `demo:check`). A route, dates, or traveler count that isn't one of the demo requests costs 2 live searches (flights and hotels), and "Show return flights" on it costs 1 more. Weather is always free.

1. **Before you start:** ProtonVPN **off**. Close other heavy apps. At least 2 GB of disk free.
2. **Open a terminal in the project:**
   ```
   cd ~/smarttrip
   ```
3. **Check everything (free), and re-warm if needed:**
   ```
   npm run demo:check
   ```
   All five lines should say `OK`. If any demo search says `not cached`, answer `y` to spend those few searches. If `LLM` says `FIX`, try a phone hotspot (see section 4).
4. **Start the app** (leave this terminal running during the demo):
   ```
   npm run build && npm run start
   ```
   Open **http://localhost:3000** in your browser. If `build` complains, `npm run dev` also works.
5. **Demo, in this order** (copy the text exactly; the dates matter for the cache):
   1. Type **`2 of us, Honolulu to Seattle Dec 11-15, $2,000`** and press Enter. Point out the progress steps, then the rows: best match first, totals vs budget, "Cached" badges (real Google data from earlier today), "Highs 53–58°F".
   2. Click the first trip. Show the outbound legs and layover, click **Show return flights** (real return options; the cheapest is "Included in your total"), the hotel's straight-line airport distance, the weather strip ("last year's actuals", because Dec 11 is more than 16 days away), the cost breakdown that adds up, the assumptions, and open **How SmartTrip planned this** to show each tool call.
   3. Click **← All trips**, type **`cheaper hotel`** in the refine box. A new run appears with "← Previous results"; flights are reused, so it's quick. (The price-capped hotel search is 1 live SerpApi search.)
   4. Click the **Budget** chip, change it to `1500`, press Enter: a new run with the new budget in the chips and totals.
   5. Click **New search**, type **`Just me, Honolulu to Las Vegas Dec 11-14, $900, nonstop please`**: nonstop packages, the "nonstop" chip, probably a red-eye badge.
   6. Click **New search**, type **`Honolulu to Portland Dec 11-14 for one person`**: the agent asks one question (the budget). Answer **`$900 total`**: the same search continues to Portland packages.
   7. Optional: the theme toggle (top right), and a narrow browser window to show the phone layout.
6. **If SerpApi or the network fails mid-demo:** stop the server (Ctrl+C), add `DEMO_FALLBACK=offline` to `.env.local`, run `npm run start` again. The header says "Offline demo data"; request 1 still uses real saved Google searches, other routes use sample data (each badged). Remove the line afterwards.
7. **If the model gateway fails:** nothing live will work. Run `npm run seed:runs` and open http://localhost:3000/results/00000000-0000-4000-8000-000000000008 to walk through saved example runs, and explain the architecture.
8. **After the demo:** Ctrl+C to stop the server. Say what's next: activities and the map, then deployment.

---

Everything to do on the demo day, in order, and what to do when something fails. The demo runs locally.

## 1. A few hours before (about 15 minutes)

1. **Network.** Turn ProtonVPN off. The course LLM gateway refuses some networks; if it doesn't answer, try a phone hotspot.
2. **Free disk space.** Keep at least 2 GB free (the disk filled up once during development and every command stopped).
3. **`.env.local`** for live data:
   ```
   FLIGHT_PROVIDER=serpapi
   HOTEL_PROVIDER=serpapi
   LLM_DEFAULT_MODEL=claude-haiku-4.5
   # DEMO_FALLBACK=offline   <- leave commented out
   ```
4. **`npm run demo:check`.** It checks the gateway, SerpApi (searches left), Open-Meteo, disk space, and the providers, all for free. Then it lists each demo search as cached or not and asks before spending any SerpApi search. Answer `y` to warm the cache (about 3 searches per request; the cache lasts 24 hours). Every line should say `OK`; see section 4 for anything marked `FIX`.
5. **Build and start:** `npm run build && npm run start`, then open http://localhost:3000. (`npm run dev` works too, but the production server is faster.)
6. **Rehearse once** with the first request below.

## 2. The demo requests

They are in `data/demo-requests.json` (`demo:check` warms what they search). The trip dates are more than 16 days away, so weather shows **last year's actuals for the same dates**, labelled as such.

| # | Type into the search box | What should happen |
|---|---|---|
| 1 | `2 of us, Honolulu to Seattle Dec 11-15, $2,000` | Progress steps, then 3 to 5 Seattle packages within budget, best match first. Badges say Live or Cached. Open a trip: outbound legs, "Show return flights" (a cached search after `demo:check`), hotel with a straight-line airport distance, weather strip, cost breakdown that adds up, assumptions, and "How SmartTrip planned this". |
| 2 | `Just me, Honolulu to Las Vegas Dec 11-14, $900, nonstop please` | Nonstop Las Vegas packages under $900; the chips show the "nonstop" preference; a red-eye badge is likely. |
| 3 | `Honolulu to Portland Dec 11-14 for one person` | One question asking for the budget and no results. Answer `$900 total`: the same search continues to Portland packages. |
| 4 | On request 1's results: refine `cheaper hotel` | A new run with "← Previous results"; cheaper hotels; the flights are reused (no new flight search). The capped hotel search is 1 live search. |

Also worth showing: edit the Budget chip (a new run with the new budget), the theme toggle, and a phone-width window.

## 3. Talking points

- The agent never adds up prices: `presentTrips` computes every total on the server, and rejects reasons that mention prices.
- Every number on screen comes from a saved field; every piece of data says where it came from (Live, Cached, Saved search, Sample data, Open-Meteo).
- Live testing changed the agent: about half the tokens per run, no repeated searches on refines, and a lone city is treated as the destination (see the plan's demo notes).
- Weather beyond 16 days is never guessed: it's last year's actual weather, labelled.

## 4. When something fails

| Symptom | What to do |
|---|---|
| `demo:check` says `FIX LLM`, or a search ends with "Can't reach course LLM gateway" | VPN off; try a phone hotspot; restart the server. If it still fails, show the seeded runs (below) and the trace. |
| A search ends with "401" | `LLM_API_KEY` is wrong or was regenerated; fix `.env.local` and restart. |
| SerpApi errors, quota used up, or no internet for SerpApi | Set `DEMO_FALLBACK=offline` in `.env.local` and restart. The header shows "Offline demo data"; request 1 uses saved real searches, other routes use sample data (badged "Sample data"). Unset it afterwards. |
| Weather shows "Weather not found" | Open-Meteo didn't answer (or offline mode has no saved weather for that route). Everything else still works; say so. |
| "Return flight details unavailable" | Expected for sample flights; for live ones it means SerpApi failed or the search cap was hit. The fare in the total already covers a return. |
| The agent asks an unexpected question or picks odd trips | Answer it or use the refine box; or start a new search. Each run is saved, so nothing is lost. |
| The search stops before it finishes | Retry with one destination; the step limit is 20. |
| Disk full (commands fail with ENOSPC) | Free space (Trash, Downloads, `npm cache clean --force`, or delete `.next/` and rebuild). |
| Anything else during the demo | `npm run seed:runs` makes example runs offline (no model, no SerpApi); open http://localhost:3000/results/00000000-0000-4000-8000-000000000008 (fixture flights and hotels with saved return flights) or …0001 to …0007. |

## 5. After the demo

Unset `DEMO_FALLBACK` if it was set. Next steps to mention: activities and the map (issues 032 and 033), then deployment (issues 034 and 035).
