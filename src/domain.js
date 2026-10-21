import {UserError} from './user-error.js';
import {DateTime, IANAZone} from 'luxon';
export const DEFAULT_ZONE = 'America/New_York';
export function zone(value) {if (!IANAZone.isValidZone(value)) throw new UserError('Choose a timezone from the city suggestions, such as New York or Seoul.'); return value;}
export function parseTime(text, timezone) {
  zone(timezone);
  text=text.trim().replace(/^(\d{4}-\d{2}-\d{2}) /,'$1T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) throw new UserError('Enter the date and time as YYYY-MM-DD HH:mm, using a 24-hour clock. For example, December 1 at 7 p.m. is 2026-12-01 19:00.');
  const t = DateTime.fromISO(text, {zone: timezone, setZone: true});
  if (!t.isValid) throw new UserError('That date or time is not valid. Check the day, month, and time, then try again.');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    if (t.toFormat("yyyy-MM-dd'T'HH:mm") !== text.slice(0,16)) throw new UserError('That local time does not exist because of daylight saving. Choose another time.');
    if (t.getPossibleOffsets().length > 1) throw new UserError('That time occurs twice when the clocks change. Choose a time outside the repeated hour, or add -04:00 or -05:00 to choose which one.');
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
export function webUrl(value) {let u;try{u=new URL(value);}catch{throw new UserError('Paste a full web link starting with https://.');}if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new UserError('Use a web link starting with https://, without a username or password in it.'); return u.href;}
export function parseColor(value) {
  const colors={pink:0xe5a1b3,purple:0x9b59b6,blue:0x3498db,green:0x2ecc71,gold:0xf1c40f,red:0xe74c3c,orange:0xe67e22,white:0xffffff,black:0x000000};
  const input=value.toLowerCase().replace(/^#/,'');
  if(Object.hasOwn(colors,input))return colors[input];
  if(/^[\da-f]{6}$/i.test(input))return parseInt(input,16);
  throw new UserError('Choose a color such as pink, blue, or purple, or enter a six-character color code such as E5A1B3.');
}
export function validateEmbed(draft) {
  const e = draft.embed;
  if (!e.title && !e.description && !e.image && !e.fields?.length) throw new UserError('Add a title, some text, a picture, or a section first.');
  const limits = [[e.title,256],[e.description,4096],[e.footer?.text,2048],[e.author?.name,256]];
  for (const field of e.fields || []) limits.push([field.name,256],[field.value,1024]);
  if ((e.fields?.length || 0) > 25) throw new UserError('A message can have at most 25 sections. Remove one before adding another.');
  if (limits.some(([s,n]) => s && s.length > n) || limits.reduce((n,[s]) => n+(s?.length || 0),0) > 6000) throw new UserError('This message exceeds Discord’s text limits. Shorten the text or remove a section, then save again.');
  if ((draft.content?.length || 0) > 1800) throw new UserError('The optional message above your announcement is too long. Keep it under 1,800 characters.');
  return draft;
}
export function rotationMember(event) {return event.assignees?.length ? event.assignees[(event.rotationIndex || 0) % event.assignees.length] : null;}
