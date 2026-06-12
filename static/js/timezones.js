/**
 * Curated IANA timezone list grouped by region.
 * Returns an array of { group, zones: [{value, label}] }
 */
export function getTimezoneGroups() {
  // Build from Intl if available, then layer in display labels
  const raw = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : _fallback;

  // Group by continent prefix
  const map = {};
  for (const tz of raw) {
    const slash = tz.indexOf("/");
    const group = slash === -1 ? "Other" : tz.slice(0, slash).replace(/_/g, " ");
    if (!map[group]) map[group] = [];
    map[group].push({ value: tz, label: _label(tz) });
  }

  // Preferred order for groups
  const order = ["Europe", "America", "Asia", "Africa", "Pacific", "Australia", "Atlantic", "Indian", "Arctic", "Antarctica", "Etc", "Other"];
  return order
    .filter(g => map[g])
    .map(g => ({ group: g, zones: map[g] }));
}

function _label(tz) {
  // Show UTC offset + name, e.g. "(UTC+02:00) Vienna"
  try {
    const now = new Date();
    const offset = -now.getTimezoneOffset(); // browser local — not accurate for other zones
    // Get offset for this specific tz
    const fmt = new Intl.DateTimeFormat("en", {
      timeZone: tz, timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(now);
    const off = parts.find(p => p.type === "timeZoneName")?.value || "";
    const city = tz.split("/").pop().replace(/_/g, " ");
    return `${off}  ${city}`;
  } catch {
    return tz.split("/").pop().replace(/_/g, " ");
  }
}

// Minimal fallback for very old browsers
const _fallback = [
  "Europe/Vienna","Europe/London","Europe/Paris","Europe/Berlin",
  "Europe/Rome","Europe/Madrid","Europe/Amsterdam","Europe/Brussels",
  "Europe/Zurich","Europe/Stockholm","Europe/Oslo","Europe/Copenhagen",
  "Europe/Helsinki","Europe/Warsaw","Europe/Prague","Europe/Budapest",
  "Europe/Bucharest","Europe/Athens","Europe/Istanbul","Europe/Moscow",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Toronto","America/Vancouver","America/Sao_Paulo","America/Buenos_Aires",
  "America/Mexico_City","America/Bogota","America/Lima",
  "Asia/Tokyo","Asia/Shanghai","Asia/Hong_Kong","Asia/Singapore",
  "Asia/Seoul","Asia/Dubai","Asia/Kolkata","Asia/Bangkok","Asia/Jakarta",
  "Asia/Karachi","Asia/Tehran","Asia/Baghdad","Asia/Riyadh",
  "Africa/Cairo","Africa/Johannesburg","Africa/Lagos","Africa/Nairobi",
  "Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth",
  "Pacific/Auckland","Pacific/Fiji","Pacific/Honolulu",
  "UTC",
];
