// Reads public Telegram channel pages (t.me/s/<channel>) and returns the Zhytomyr air-raid state plus
// course / hit / air-defence reports. Used by scripts/collect.mjs (GitHub Actions) and as a Cloudflare Worker.
// Optional settings: CHANNELS, LOCAL_CHANNELS, PLACES (comma-separated), DISTRICT, HOURS.

export const DEFAULT_CHANNELS = 'Angry_Pol,blacklist_public,truexazhitomir,pzhytomyr,PpoUARadar,mon1tor_ua,eRadarrua,deraketaua,monitor_ukr';
// Channels that write only about Zhytomyr: every message counts, not only lines naming a place.
export const DEFAULT_LOCAL = 'Angry_Pol,blacklist_public,truexazhitomir,pzhytomyr';
export const DEFAULT_PLACES = 'Житомир,Бердич,Корост,Новоград-Волин,Звягел,Малин,Овруч,Радомишл,Баранівк,Андрушівк,Попільн,Чуднів,Черняхів,Брусилів,Ружин,Емільчин,Лугин,Полісс';

const PVO = /працю\S*\s+ппо|ппо\s+працю|робот\S*\s+ппо|сил\S*\s+ппо|збит(?!к)|збили|знищен|мобільн\S*\s+(вогнев\S*\s+)?груп/i;
const HIT = /приліт|прилет|влучан|вибух|удар(?!н)|уражен|пошкодж|руйнуван|пожеж|загинул|постражда/i;
const COURSE = /шахед|шахєд|бпла|дрон|ракет|курс|напрям|крилат|балістик|герань|гербера|калібр|реактив/i;
const SIGNATURE = /надіслати новину|підписати|підписатись|підписуйтесь|@\w{4,}|t\.me\//i;

const decode = s => s
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();

export function parseMessages(html) {
  const out = [];
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const post = /data-post="([^"]+)"/.exec(block)?.[1];
    const time = /<time[^>]*datetime="([^"]+)"/.exec(block)?.[1];
    const body = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    if (post && time && body) out.push({ post, ts: Date.parse(time), text: decode(body) });
  }
  return out;
}

const mentions = (text, places) => { const low = text.toLowerCase(); return places.some(p => low.includes(p)); };

// Drops channel signatures; for country-wide channels keeps only the lines / items about our places.
export function relevantText(text, places, local) {
  const lines = text.split(/\n+/).map(s => s.trim()).filter(s => s && !SIGNATURE.test(s));
  if (local) return lines.join('\n');
  return lines.flatMap(l => l.split(/;\s*/)).filter(s => mentions(s, places)).join('\n');
}

// Official alert reposts, e.g. "🟡 Житомирський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)",
// "🟢 Житомирський район — відбій повітряної тривоги ⚠️ ... повітряна тривога досі триває у: - Коростенський район".
// Returns [{ district, state: 'on'|'off', level?, threat?, still? }].
export function parseAlerts(text) {
  const out = [];
  const [main, rest = ''] = text.split(/досі\s+триває\s+у:?/i);
  for (const seg of main.split(/(?=[🟢🟡🟠🔴⚪])/u)) {
    const m = /^[🟢🟡🟠🔴⚪]\s*([А-ЯІЇЄҐ][^\s—–]*)\s+район\s*[—–-]\s*([\s\S]+)$/u.exec(seg.trim());
    if (!m) continue;
    const body = m[2];
    if (/відбій/i.test(body)) { out.push({ district: m[1], state: 'off' }); continue; }
    if (!/тривог/i.test(body)) continue;
    out.push({ district: m[1], state: 'on', level: /(\S+)\s+рівень/i.exec(body)?.[1]?.toLowerCase(), threat: /:\s*([^(⚠\n]+)/.exec(body)?.[1]?.trim() });
  }
  for (const m of rest.matchAll(/([А-ЯІЇЄҐ][^\s—–-]*)\s+район/gu)) out.push({ district: m[1], state: 'on', still: true });
  return out;
}

// Applies alert transitions (sorted by time) to per-district state { state, since, ts, level, threat, url }.
export function applyAlerts(districts, transitions) {
  const d = structuredClone(districts || {});
  for (const t of [...transitions].sort((a, b) => a.ts - b.ts)) {
    const cur = d[t.district];
    if (cur && t.ts <= cur.ts) continue;
    if (t.still && cur?.state === 'on') { cur.ts = t.ts; continue; }
    const same = cur && cur.state === t.state;
    d[t.district] = {
      state: t.state,
      since: same ? cur.since : new Date(t.ts).toISOString(),
      ts: t.ts,
      level: t.state === 'on' ? (t.level || (same ? cur.level : undefined)) : undefined,
      threat: t.state === 'on' ? (t.threat || (same ? cur.threat : undefined)) : undefined,
      url: t.url,
    };
  }
  return d;
}

// Relevant text -> 'pvo' | 'hit' | 'course' | null. Monitoring channels only post about targets, so they default to 'course'.
export function classify(text, local) {
  if (!text) return null;
  if (PVO.test(text)) return 'pvo';
  if (HIT.test(text)) return 'hit';
  if (COURSE.test(text) || !local) return 'course';
  return null;
}

export async function collect(env = {}, prevDistricts = {}) {
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const sources = list(env.CHANNELS || DEFAULT_CHANNELS).map(s => s.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, ''));
  const localChannels = list(env.LOCAL_CHANNELS || DEFAULT_LOCAL).map(s => s.toLowerCase());
  const places = list(env.PLACES || DEFAULT_PLACES).map(s => s.toLowerCase());
  const main = env.DISTRICT || 'Житомирський';
  const since = Date.now() - (+env.HOURS || 24) * 3600e3;
  const events = [], transitions = [], errors = [];
  await Promise.all(sources.map(async src => {
    const channel = src.split('?')[0];
    const local = localChannels.includes(channel.toLowerCase());
    try {
      const res = await fetch(`https://t.me/s/${src}`, { headers: { 'user-agent': 'Mozilla/5.0 (zhytomyr-dashboard)' } });
      if (!res.ok) { errors.push(`${src}: HTTP ${res.status}`); return; }
      const messages = parseMessages(await res.text());
      if (!messages.length) errors.push(`${src}: no messages on page`);
      for (const m of messages) {
        const url = `https://t.me/${m.post}`;
        if (local) {
          const alerts = parseAlerts(m.text);
          if (alerts.length) { for (const a of alerts) transitions.push({ ...a, ts: m.ts, url }); continue; }
        }
        if (m.ts < since) continue;
        const text = relevantText(m.text, places, local);
        const type = classify(text, local);
        if (type) events.push({ type, time: new Date(m.ts).toISOString(), channel, url, text: text.slice(0, 500) });
      }
    } catch (e) { errors.push(`${src}: ${e.message}`); }
  }));
  const districts = applyAlerts(prevDistricts, transitions);
  const seen = new Set();
  return {
    updated: new Date().toISOString(),
    district: main,
    alert: districts[main] || null,
    districts,
    events: events.sort((a, b) => b.time.localeCompare(a.time)).filter(e => {
      const k = e.text.replace(/\s+/g, ' ').toLowerCase();
      return !seen.has(k) && seen.add(k);
    }),
    errors,
  };
}

export default {
  async fetch(req, env) {
    return new Response(JSON.stringify(await collect(env)), {
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=15' },
    });
  },
};
