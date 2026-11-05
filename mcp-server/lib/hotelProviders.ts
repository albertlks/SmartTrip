import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, getAirport, loadHotels, type Airport, type HotelRecord } from "./data";
import { haversineMiles } from "./geo";
import { providerFor, type Source } from "./providers";
import { daysBetween, roundMoney, ToolFailure } from "./results";
import type { RunContext } from "./runContext";
import { serpapiSearch } from "./serpapi";

export class HotelSearchError extends ToolFailure {}

export type HotelSort = "price" | "rating";
export type HotelSearch = {
  destination: string;
  checkIn: string;
  checkOut: string;
  /** Sent to SerpApi as adults; prices stay per room. */
  travelers: number;
  sort: HotelSort;
  maxPricePerNight?: number;
};

const MAX_RESULTS = 8;
const FIXTURE_DIR = path.join(DATA_DIR, "fixtures");

/** The google_hotels parameters for a search. The capture script uses these too, so its search is the app's cache entry. */
export function hotelParams(search: HotelSearch, city: string): Record<string, string> {
  return {
    q: `hotels in ${city}`,
    check_in_date: search.checkIn,
    check_out_date: search.checkOut,
    adults: String(search.travelers),
    currency: "USD",
    sort_by: search.sort === "rating" ? "8" : "3",
    ...(search.maxPricePerNight ? { max_price: String(Math.floor(search.maxPricePerNight)) } : {}),
  };
}

export const hotelFixtureName = (s: Pick<HotelSearch, "destination" | "checkIn" | "checkOut" | "travelers">) =>
  `serpapi-hotels-${s.destination}-${s.checkIn}-${s.checkOut}-${s.travelers}.json`;

/** The airport for a destination code, with coordinates for distances. */
export async function destinationAirport(code: string): Promise<Airport> {
  const airport = await getAirport(code);
  if (!airport) throw new HotelSearchError(`Unknown airport code "${code}". Look it up with lookupAirport first.`);
  return airport;
}

/** Every field is optional, so anything missing from a response is left out rather than guessed. */
type GoogleHotel = {
  type?: string;
  name?: string;
  property_token?: string;
  rate_per_night?: { extracted_lowest?: number };
  overall_rating?: number;
  reviews?: number;
  extracted_hotel_class?: number;
  gps_coordinates?: { latitude?: number; longitude?: number };
  amenities?: string[];
  nearby_places?: { name?: string; transportations?: { type?: string; duration?: string }[] }[];
};
export type GoogleHotelsResponse = { properties?: GoogleHotel[] };

// One-off listings ("Palpatine Sith Lord Suite", 3 reviews) crowd out real hotels in cheap searches.
const MIN_REVIEWS = 10;

const tierOf = (stars?: number): HotelRecord["tier"] | undefined =>
  stars === undefined ? undefined : stars <= 2 ? "budget" : stars === 3 ? "mid" : stars === 4 ? "upscale" : "luxury";

/** A few amenities, then how far the airport is when Google lists it nearby ("Seattle-Tacoma International Airport: 17 min by taxi"). */
function hotelNotes(h: GoogleHotel): string | undefined {
  const airport = h.nearby_places?.find((p) => /airport/i.test(p.name ?? ""));
  const ride = airport?.transportations?.[0];
  const parts = [
    ...(h.amenities ?? []).slice(0, 3),
    airport?.name && ride?.duration ? `${airport.name}: ${ride.duration} by ${(ride.type ?? "car").toLowerCase()}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** Ids look like "h-3a9c-01": a fingerprint of the search, then the rank, like flight ids. */
const idPrefix = (s: HotelSearch) =>
  `h-${createHash("sha1")
    .update(`${s.destination}|${s.checkIn}|${s.checkOut}|${s.travelers}|${s.sort}|${s.maxPricePerNight ?? ""}`)
    .digest("hex")
    .slice(0, 4)}`;

export function mapGoogleHotels(response: GoogleHotelsResponse, search: HotelSearch, airport: Airport, source: Source): HotelRecord[] {
  const nights = daysBetween(search.checkIn, search.checkOut);
  const prefix = idPrefix(search);
  return (response.properties ?? [])
    .filter((h): h is GoogleHotel & { name: string; rate_per_night: { extracted_lowest: number } } =>
      Boolean(h.name) && typeof h.rate_per_night?.extracted_lowest === "number",
    )
    .filter((h) => (h.reviews ?? 0) >= MIN_REVIEWS)
    // Without coordinates there's no airport distance, so no ride estimate for the total.
    .filter((h) => typeof h.gps_coordinates?.latitude === "number" && typeof h.gps_coordinates?.longitude === "number")
    // The live search applies max_price itself; this keeps fixture results honest too.
    .filter((h) => search.maxPricePerNight === undefined || h.rate_per_night.extracted_lowest <= search.maxPricePerNight)
    .sort((a, b) =>
      search.sort === "rating"
        ? (b.overall_rating ?? 0) - (a.overall_rating ?? 0)
        : a.rate_per_night.extracted_lowest - b.rate_per_night.extracted_lowest,
    )
    .slice(0, MAX_RESULTS)
    .map((h, i) => {
      const latitude = h.gps_coordinates!.latitude!;
      const longitude = h.gps_coordinates!.longitude!;
      const pricePerNight = h.rate_per_night.extracted_lowest;
      return compact({
        kind: "hotel" as const,
        id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
        source,
        destination: search.destination,
        name: h.name,
        city: airport.city,
        tier: tierOf(h.extracted_hotel_class),
        pricePerNight,
        rating: h.overall_rating,
        reviews: h.reviews,
        milesToAirport: haversineMiles({ latitude, longitude }, airport),
        latitude,
        longitude,
        notes: hotelNotes(h),
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        nights,
        stayTotal: roundMoney(pricePerNight * nights),
      });
    });
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

async function fromMock(search: HotelSearch): Promise<HotelRecord[]> {
  const hotels = await loadHotels();
  const nights = daysBetween(search.checkIn, search.checkOut);
  const results = hotels
    .filter((h) => h.destination === search.destination)
    .filter((h) => search.maxPricePerNight === undefined || h.pricePerNight <= search.maxPricePerNight)
    .sort((a, b) => (search.sort === "rating" ? b.rating - a.rating : a.pricePerNight - b.pricePerNight))
    .map((h): HotelRecord => ({
      ...h,
      kind: "hotel",
      source: "mock",
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      nights,
      stayTotal: roundMoney(h.pricePerNight * nights),
    }));
  if (results.length === 0) {
    const destinations = [...new Set(hotels.map((h) => h.destination))].sort().join(", ");
    const why = hotels.some((h) => h.destination === search.destination)
      ? `No ${search.destination} hotels at or under $${search.maxPricePerNight}/night. Raise or drop maxPricePerNight.`
      : `No hotels in ${search.destination}.`;
    throw new HotelSearchError(`${why} Destinations with hotels: ${destinations}.`);
  }
  return results;
}

async function readFixture(search: HotelSearch): Promise<GoogleHotelsResponse> {
  const name = hotelFixtureName(search);
  const text = await readFile(path.join(FIXTURE_DIR, name), "utf8").catch(() => null);
  if (text) return JSON.parse(text) as GoogleHotelsResponse;
  const saved = (await readdir(FIXTURE_DIR).catch(() => [] as string[])).filter((f) => f.startsWith("serpapi-hotels-"));
  throw new HotelSearchError(
    `No saved hotel fixture for ${search.destination} ${search.checkIn} to ${search.checkOut}, ${search.travelers} traveler(s) ` +
      `(expected data/fixtures/${name}). ` +
      (saved.length ? `Saved hotel fixtures: ${saved.join(", ")}.` : "No hotel fixtures are saved yet.") +
      " Search one of those, or use HOTEL_PROVIDER=mock.",
  );
}

/** Hotels for a stay from HOTEL_PROVIDER (mock, fixture, or serpapi). Throws a ToolFailure with a readable reason. */
export async function findHotels(search: HotelSearch, ctx: RunContext): Promise<{ source: Source; results: HotelRecord[] }> {
  const source = providerFor("HOTEL");
  if (source === "mock") return { source, results: await fromMock(search) };

  const airport = await destinationAirport(search.destination);
  if (source === "fixture") return { source, results: mapGoogleHotels(await readFixture(search), search, airport, source) };

  const { response, cache, fetchedAt } = await serpapiSearch<GoogleHotelsResponse>("google_hotels", hotelParams(search, airport.city), ctx);
  const results = mapGoogleHotels(response, search, airport, source).map((r) => ({ ...r, cache, fetchedAt }));
  return { source, results };
}
