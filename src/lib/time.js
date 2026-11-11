/* "الثلاثاء ٣ نوفمبر · ١٠:٣٤ ص": day, date, hour and minute only (never seconds) */
export function stamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const day = d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });
    const time = d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
    return `${day} · ${time}`;
  } catch (e) { return ""; }
}
export function stampShort(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" })} · ${d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" })}`;
  } catch (e) { return ""; }
}
