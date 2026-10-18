import {DateTime, IANAZone} from 'luxon';
export const DEFAULT_ZONE = 'America/New_York';
export function zone(value) {if (!IANAZone.isValidZone(value)) throw Error('Use an IANA timezone, such as America/New_York or Asia/Seoul.'); return value;}
export function parseTime(text, timezone) {
  zone(timezone);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) throw Error('Use YYYY-MM-DDTHH:mm, optionally with a timezone offset.');
  const t = DateTime.fromISO(text, {zone: timezone, setZone: true});
  if (!t.isValid) throw Error('Invalid date or time.');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    if (t.toFormat("yyyy-MM-dd'T'HH:mm") !== text.slice(0,16)) throw Error('That local time does not exist because of daylight saving. Choose another time.');
    if (t.getPossibleOffsets().length > 1) throw Error('That time occurs twice because of daylight saving. Include an offset, such as -04:00 or -05:00.');
  }
  return t.toMillis();
}
export function advance(event, now = Date.now()) {
  return rollForward(event,now)?.start ?? null;
}
export function rollForward(event, now = Date.now()) {
  if (event.repeat === 'none') return null;
  let next = DateTime.fromMillis(event.start, {zone: event.zone});
  const step = event.repeat === 'daily' ? {days: 1} : {weeks: 1};
  let count=0;
  do {next = next.plus(step);count++;} while (next.toMillis() <= now);
  return {start:next.toMillis(),count};
}
export function webUrl(value) {const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Error('Use an HTTP or HTTPS URL without credentials.'); return u.href;}
export function validateEmbed(draft) {
  const e = draft.embed;
  if (!e.title && !e.description && !e.image && !e.fields?.length) throw Error('Add a title, description, image, or field first.');
  const limits = [[e.title,256],[e.description,4096],[e.footer?.text,2048],[e.author?.name,256]];
  for (const field of e.fields || []) limits.push([field.name,256],[field.value,1024]);
  if ((e.fields?.length || 0) > 25) throw Error('An embed can have at most 25 fields.');
  if (limits.some(([s,n]) => s && s.length > n) || limits.reduce((n,[s]) => n+(s?.length || 0),0) > 6000) throw Error('This embed exceeds Discord’s text limits. Shorten its text.');
  if ((draft.content?.length || 0) > 1800) throw Error('Accompanying message must be 1,800 characters or fewer.');
  return draft;
}
export function rotationMember(event) {return event.assignees?.length ? event.assignees[(event.rotationIndex || 0) % event.assignees.length] : null;}
