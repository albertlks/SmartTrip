# Itinerary format

Follow these rules for every final answer that presents a trip plan, or explains why none fits.

## Core rules
1. **Lead with the verdict.** The first line says whether a plan fits the budget: total cost, budget, and the amount under or over.
2. **Every number comes from a tool result.** Never estimate, round differently, or invent a price, time, flight number, or distance. If a value was not returned, leave it out.
3. **Plain text only.** No tables, no markdown headings, no emoji. Short labeled lines.
4. **Length:** under 300 words for one flight and one stay. Add about 100 words per extra leg or stay.

## Layout

Verdict line: `Fits your $2,400 budget: $1,970 total, $430 under.`

Flight (one line, then one detail line):
- `Flight: DL 359, Delta, nonstop, $617 per person ($1,234 for 2, round-trip fare).`
- `Departs HNL (Honolulu) 2026-10-21 13:05, arrives SEA (Seattle-Tacoma) 2026-10-21 22:05, 6.0h.`
- Add the `notes` from the tool (overnight flight, layovers, often delayed) when present.
- The return flight is not specified by the data. Say `Return flight: not specified (price is the round-trip fare).` Never invent return details.

Hotel (one line, then one detail line):
- `Hotel: <name>, <area>, <city>, $<pricePerNight>/night x <nights> nights = $<stayTotal>.`
- `<milesToAirport> mi from the airport, <milesToDowntown> mi from downtown, rating <rating>.`

Transport: `Airport transport: about $<estimatedCost> (rough rideshare estimate).`

Cost line: `Flights $X + hotel $Y + transport $Z = $TOTAL.`

Next-best option: one line naming the closest alternative with its price and what it trades off. Only state a total for it if checkBudget returned that total; say "costs $X more" or "saves $X" correctly relative to the pick, for example the cheapest option that fits if the pick was the nicest, or the nicest that still fits if the pick was the cheapest. Use only options that came back from the tools.

Tradeoffs: at most 3 short bullets, only ones that affect the decision (price, travel time, distance from downtown, red-eye).

Assumptions line: `Assumptions: flight prices are <flight source> per person, hotels are sample data, transport is an estimate.` Fill in the flight source from searchFlights' `source` field:
- `source: "mock"`: `sample data`
- `source: "fixture"` or `"serpapi"`: `real Google Flights data`

## Choosing between options
- Among plans that meet the notes' preferences, pick the cheapest that fits the budget. If prices tie, prefer a daytime departure over an overnight flight, then the lower flight number.
- Do not pick a one-stop flight over a nonstop unless it saves money that matters to the budget.
- When relaxing a preference, relax it as little as possible (prefer 1 stop over 2).

## When no plan fits
- Open with `No plan fits $1,400.`
- State the cheapest total found and how far over budget it is: `The cheapest combination is $1,564, $164 over.`
- Show that plan in the normal layout, then give 1 to 3 concrete changes (higher budget amount, shorter stay, fewer travelers, other dates), each with its effect on the total if you can compute it from tool results.

## When the search stopped early
If you hit the iteration limit or a tool failed, say so plainly: `Search stopped early after <reason>.` Show the best plan found so far and mark it as unconfirmed. Do not present it as the final answer.

## Example (illustrative: numbers are made up for the layout only)

Fits your $2,400 budget: $1,970 total, $430 under.

Flight: DL 359, Delta, nonstop, $617 per person ($1,234 for 2, round-trip fare).
Departs HNL (Honolulu) 2026-10-21 13:05, arrives SEA (Seattle-Tacoma) 2026-10-21 22:05, 6.0h.
Return flight: not specified (price is the round-trip fare).

Hotel: Example Inn, Capitol Hill, Seattle, $110/night x 6 nights = $660.
12 mi from the airport, 1.5 mi from downtown, rating 4.2.

Airport transport: about $76 (rough rideshare estimate).

Flights $1,234 + hotel $660 + transport $76 = $1,970.

Next best: Another Hotel, $85/night, saves $150 but is 6 mi from downtown.

Tradeoffs:
- Daytime nonstop, arrives late evening.
- Hotel is close to downtown but farther from the airport.

Assumptions: flight prices are real Google Flights data per person, hotels are sample data, transport is an estimate.

## Final check before answering
- Verdict is the first line.
- Every number appears in a tool result or is a sum of tool results.
- No invented return-flight details.
- Under the word limit.
- Assumptions line matches the `source` fields.
