// Turns concrete request paths into templates so that /orders/1042 and
// /orders/1043 are recognised as the same operation: /orders/{orderId}.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
// Mixed letters and digits of length 12+ with at least one digit, e.g. "INV2026000187".
const OPAQUE_ID = /^(?=.*\d)[A-Za-z0-9_-]{12,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIdentifierSegment(segment: string): boolean {
  return (
    INTEGER.test(segment) ||
    UUID.test(segment) ||
    LONG_HEX.test(segment) ||
    DATE.test(segment) ||
    OPAQUE_ID.test(segment)
  );
}

// "/api/v2/orders/1042/lines" -> "/api/v2/orders/{orderId}/lines"
// The parameter is named after the preceding collection segment, singularised.
export function templatePath(pathname: string): string {
  const segments = pathname.split("/");
  const used = new Map<string, number>();
  const out = segments.map((segment, i) => {
    if (i === 0 || segment === "" || !isIdentifierSegment(decodeURIComponent(segment))) {
      return segment;
    }
    let name = paramName(segments[i - 1]);
    const count = used.get(name) ?? 0;
    used.set(name, count + 1);
    if (count > 0) name = `${name}${count + 1}`;
    return `{${name}}`;
  });
  return out.join("/");
}

function paramName(previous: string | undefined): string {
  if (!previous || previous.startsWith("{") || isIdentifierSegment(previous)) return "id";
  const base = singular(previous.replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()));
  return `${base.charAt(0).toLowerCase()}${base.slice(1)}Id`;
}

export function singular(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(ss|us)$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}
