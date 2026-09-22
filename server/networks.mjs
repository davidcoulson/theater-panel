// Streaming brands, and how each one is recognized in Plex, Seerr and TMDB.
//
// Plex: TV libraries have a "network" field (Netflix, HBO, Max...) and movie libraries a
// "studio" field (Netflix, Amazon Studios, HBO Films...). `plex` lists the names, lower case,
// that count as this brand in either one.
// TMDB (through Seerr): `network` is the TMDB network id, used for its logo, and `provider` is
// the TMDB watch-provider id, used for "streaming on" discovery in the US region.

export const BRANDS = [
  { id: 'netflix', name: 'Netflix', short: 'Netflix', network: 213, provider: 8,
    plex: ['netflix'] },
  { id: 'prime', name: 'Prime Video', short: 'Prime', network: 1024, provider: 9,
    plex: ['prime video', 'amazon', 'amazon prime video', 'prime', 'amazon studios', 'amazon mgm studios', 'amazon freevee'] },
  { id: 'max', name: 'Max', short: 'Max', network: 3186, provider: 1899,
    plex: ['hbo', 'hbo max', 'max', 'hbo films', 'hbo documentary films', 'cinemax'] },
  { id: 'apple', name: 'Apple TV+', short: 'Apple TV+', network: 2552, provider: 350,
    plex: ['apple tv+', 'apple tv', 'apple studios', 'apple original films'] },
  { id: 'disney', name: 'Disney+', short: 'Disney+', network: 2739, provider: 337,
    plex: ['disney+', 'walt disney pictures', 'pixar', 'marvel studios', 'lucasfilm ltd.'] },
  { id: 'hulu', name: 'Hulu', short: 'Hulu', network: 453, provider: 15,
    plex: ['hulu'] },
  { id: 'peacock', name: 'Peacock', short: 'Peacock', network: 3353, provider: 386,
    plex: ['peacock'] },
  { id: 'paramount', name: 'Paramount+', short: 'Paramount+', network: 4330, provider: 531,
    plex: ['paramount+', 'paramount+ with showtime', 'showtime'] },
];

export const brandById = (id) => BRANDS.find((b) => b.id === id);

const byName = new Map(BRANDS.flatMap((b) => b.plex.map((n) => [n, b.id])));
// A Plex studio or network name -> brand id, or undefined.
export const brandForName = (name) => (name ? byName.get(String(name).toLowerCase()) : undefined);
