// Underlined, so the links aren't told apart by color alone.
const linkClass = "text-accent underline underline-offset-2";

// Credit only the sources the app uses; later issues add OpenStreetMap and image credits.
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="sm:shrink-0">SmartTrip: plan trips that fit your budget.</p>
        <p>
          Flight and hotel data from Google Flights and Google Hotels via{" "}
          <a className={linkClass} href="https://serpapi.com" target="_blank" rel="noopener noreferrer">
            SerpApi
          </a>
          , or sample data when live search is off. Weather from{" "}
          <a className={linkClass} href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">
            Open-Meteo
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
