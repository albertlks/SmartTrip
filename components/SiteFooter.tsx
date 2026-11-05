const linkClass = "text-accent underline-offset-2 hover:underline";

// Credit only the sources the app uses; later issues add Open-Meteo, OpenStreetMap, and image credits.
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>SmartTrip: plan trips that fit your budget.</p>
        <p>
          Flight data from Google Flights via{" "}
          <a className={linkClass} href="https://serpapi.com" target="_blank" rel="noopener noreferrer">
            SerpApi
          </a>
          , or sample data when live search is off.
        </p>
      </div>
    </footer>
  );
}
