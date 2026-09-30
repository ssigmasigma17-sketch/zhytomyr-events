// Reads public Telegram channel pages (t.me/s/<channel>) and returns the Zhytomyr air-raid state plus
// course / warning / explosion / air-defence / all-clear reports. Used by scripts/collect.mjs (GitHub Actions,
// keeps state and history between runs) and as a Cloudflare Worker (live, stateless).
// Optional settings: CHANNELS, LOCAL_CHANNELS (comma-separated), HOURS, PAGES_LOCAL.
//
// Regexes run on lower-cased text with explicit letter classes instead of the i/u flags and \p{L}: they compile
// several times faster, which keeps a cold Cloudflare Worker within its CPU limit.

export const DEFAULT_CHANNELS = 'Angry_Pol,blacklist_public,truexazhitomir,pzhytomyr,zhytomyr412,PpoUARadar,mon1tor_ua,eRadarrua,deraketaua,monitor_ukr';
// Channels that write only about Zhytomyr: short posts count even without a place name, and their
// alert / all-clear posts drive the state.
export const DEFAULT_LOCAL = 'Angry_Pol,blacklist_public,truexazhitomir,pzhytomyr,zhytomyr412';

const LET = 'a-zA-Zа-яА-ЯёЁіІїЇєЄґҐ', UP = 'A-ZА-ЯЁІЇЄҐ', AP = "ʼ'’`";
// <L> letters, <U> capitals, <A> apostrophes.
const re = (src, flags = '') => new RegExp(src.replaceAll('<L>', LET).replaceAll('<U>', UP).replaceAll('<A>', AP), flags);

// ---------- places ----------
// [name, pattern, cityArea]. Patterns match from the start of a word; lower-case ones ignore case, capitalised ones
// (the same as an ordinary word) must be capitalised in the text. cityArea marks Zhytomyr itself and its suburbs.
const GAZETTEER = [
  ['Житомир', 'житомир(?!щин|ськ)', true], ['Житомир', 'жт(?![<L>])(?!\\s+област)', true], ['Житомирщина', 'житомирщин|житомирськ'],
  ['Бердичів', 'бердич'], ['Коростень', 'коростен'], ['Коростишів', 'коростиш'], ['Звягель', 'звягел|новоград'],
  ['Малин', 'Малин(?!ов)'], ['Овруч', 'овруч'], ['Радомишль', 'радомишл'], ['Баранівка', 'баранівк'],
  ['Андрушівка', 'андрушівк'], ['Попільня', 'попільн'], ['Чуднів', 'чуднів|чуднов'], ['Черняхів', 'черняхів|черняхов'],
  ['Брусилів', 'брусилів|брусилов'], ['Ружин', 'ружин'], ['Ємільчине', '[єе]мільчин'], ['Лугини', 'лугин'],
  ['Олевськ', 'олевськ'], ['Народичі', 'народич'], ['Хорошів', 'хорошів|хорошев|володарськ'], ['Пулини', 'пулин|червоноармійськ'],
  ['Іршанськ', 'іршанськ'], ['Любар', 'любар'], ['Романів', 'Романів|Романов'], ['Потіївка', 'поті[єї]вк'],
  ['Вільськ', 'вільськ'], ['Довбиш', 'довбиш'], ['Ушомир', 'ушомир'], ['Словечне', 'словечн'], ['Чоповичі', 'чопович'],
  ['Городниця', 'городниц'], ['Ярунь', 'ярун[ьяюі](?![<L>])'], ['Рогачів', 'рогачів|рогачев'], ['Миропіль', 'миропол|миропіл'],
  ['Вчорайше', 'вчорайш'], ['Райгородок', 'райгород'], ['Колодяжне', 'колодяжн'], ['Оліївка', 'оліївк', true],
  ['Гранітне', 'Гранітн'], ['Головине', 'Головин'], ['Смоківка', 'смоківк'], ['Нова Борова', 'Боров(а|у|ій|ою)(?![<L>])'],
  ['Висока Піч', 'Висок[<L>]*\\s+П[іе]ч'], ['Тетерів', 'тетерів|тетерев', true], ['Озерне', 'Озерн', true],
  ['Гуйва', 'гуйв|новогуйвин', true], ['Станишівка', 'станишівк', true], ['Глибочиця', 'глибочиц', true],
  ['Кодня', 'кодн(я|і|ю|ею)(?![<L>])'], ['Зарічани', 'зарічан', true], ['Довжик', 'довжик', true], ['Левків', 'Левків|Левков', true],
  ['Пряжів', 'пряжів|пряжев', true], ['Туровець', 'туровц|туровец', true], ['Слобода-Селець', 'слобода-сел', true],
  ['Гадзинка', 'гадзинк', true], ['Світин', 'світин', true], ['Вереси', 'верес(и|ів|ах|ам|ами)(?![<L>])', true],
  ['Крошня', 'крошн', true], ['Марʼянівка', 'мар[<A>]?янівк', true], ['Сонячне', 'Сонячн(е|ому)(?![<L>])', true],
  ['Корбутівка', 'корбутівк', true], ['Смолянка', 'смолянк', true], ['Богунія', 'богуні', true], ['Путятинка', 'путятинк', true],
  ['Мальованка', 'мальованк', true], ['Пашківка', 'пашківк', true],
];
const START = '(?<![<L><A>])', TAIL = '[<L><A>-]*';
const compiled = GAZETTEER.map(([name, src, city]) => ({ name, city: !!city, src, cs: re('^[<U>]').test(src), whole: re(`^(?:${src})`) }));
// All places in two passes: lower-case patterns over the lower-cased text, capitalised ones over the original.
// The single patterns only name the words found.
const ANY = [false, true].map(cs => ({ cs, re: re(START + '(?:' + compiled.filter(p => p.cs === cs).map(p => `(?:${p.src})`).join('|') + ')' + TAIL, 'g') }));
// "до нас", "у наш бік": local channels saying it comes our way without naming a place.
const OURS = /до нас|на нас|у наш бік|в наш бік|по нас|нашої області|наша область/;
const CITY_WORDS = /над містом|до міста|на місто|у місті|в місті|по місту|центр міста|частин\S* міста|передмісті/;

// -> { places: canonical names in text order, hl: matched words, city: mentions Zhytomyr or its suburbs }
const placeCache = new Map();
export function findPlaces(text) {
  let r = placeCache.get(text);
  if (r) return r;
  const low = text.toLowerCase(), hits = [];
  for (const { cs, re: any } of ANY) {
    for (const m of (cs ? text : low).matchAll(any)) {
      const p = compiled.find(p => p.cs === cs && p.whole.test(m[0]));
      if (p) hits.push({ i: m.index, word: text.slice(m.index, m.index + m[0].length), name: p.name, city: p.city });
    }
  }
  hits.sort((a, b) => a.i - b.i);
  r = { places: [...new Set(hits.map(h => h.name))], hl: [...new Set(hits.map(h => h.word))], city: hits.some(h => h.city) };
  if (placeCache.size > 5000) placeCache.clear();
  placeCache.set(text, r);
  return r;
}
const mentions = text => findPlaces(text).places.length > 0;

// ---------- text cleanup (patterns over lower-cased text unless noted) ----------
const ADS = /#реклама|реклам|вакансі|робота без досвіду|грн на місяць|бізнес|знижк|перекуп|перші кадри|жахливі кадри|терміново до перегляду|другий канал/;
// Promo lines inside real posts ("Запустили карту руху…", invite links) are cut out, the rest of the post stays.
const PROMO_LINE = /t\.me\/\+|перевір(яйте|ити)|запустили карту|карта міста та області|підписуйтесь|переходьте|за посиланням/;
const CIVIL = /дтп|затор|аварі[яї]|перекинул|світлофор|електроенерг|електропостач|відключен|графік|водопостач|водоканал|генератор|напруг|погод|замороз|синоптик|гриб|донат|підтрима|оренд|самокат|марафон|весілл|інста|посилк|суші|флікер|трамва|тролейбус|поліцейськ|набір кандидат/;
const STRONG = /приліт|прильот|влучан|вибух|удар(?!н)|атак|шахед|бпла|дрон|ракет|ппо|збит|збил/;
// Over the original text; the non-unicode i flag folds Cyrillic case too.
const SIGNATURES = [
  re(String.raw`❤️?\s*телеграм канал[^\n]*`, 'gi'),
  re(String.raw`труха\S*\s*житомир\s*(\|\s*надіслати новину\S*)?`, 'gi'),
  re(String.raw`\|\s*(підписатися|підписатись|надіслати новину)\S*`, 'gi'),
  re(String.raw`підпис\S*\s*👉[^\n]*`, 'gi'),
  re(String.raw`(?<![<L>])(підписатися|підписатись|надіслати новину)\S*`, 'gi'),
  re(String.raw`монітор:\s*@\w+`, 'gi'),
  re(String.raw`злі полісяни\s*(💛|💚)*`, 'gi'),
  /(https?:\/\/|t\.me\/)\S+/gi,
  /@\w{4,}/g,
  /#\S+/g,
];
const HAS_TEXT = re('[<L>\\d]');
export function clean(text) {
  let t = text.split('\n').filter(l => !PROMO_LINE.test(l.toLowerCase())).join('\n');
  for (const s of SIGNATURES) t = t.replace(s, ' ');
  return t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(l => HAS_TEXT.test(l)).join('\n');
}

// Splits a post into items: lines, "⚠️ …" bullets, "; " lists and "<Region>щина:" sections. Each item keeps the
// section header it belongs to, so "‼️Житомирщина:\n• 1х шахед курсом на …" stays ours.
const BULLET = /(?=[⚠‼❗🔴🟡🟢💥•▫➡✈🚀🛵])/u;
const TOP_BULLET = /^[⚠‼❗🔴🟡🟢💥➡✈🚀🛵]/u;
const HEADER = re(String.raw`^[^<L>]*([<U>][<L><A>-]*(щин[аіи]|ччин[аіи])|[<U>][<L>]+ська область|[<U>][<L>]+ський район|[^:]{0,60}\s(на|у|в)\s[<U>][<L>]*(щин[аіи]|ччин[аіи]))\s*:`);
const REGION_INLINE = re(String.raw`(?=(?<![<L>])[<U>][<L>]+(?:щина|ччина):)`);
function items(text) {
  const out = [];
  let header = null;
  for (const line of text.split('\n')) {
    for (const part of line.split(BULLET).flatMap(p => p.split(REGION_INLINE)).flatMap(p => p.split(/;\s+/))) {
      const s = part.trim();
      if (!HAS_TEXT.test(s)) continue;
      if (TOP_BULLET.test(s)) header = null; // a new top-level item; "•" / "▫" stay in the section
      const h = HEADER.exec(s);
      if (h) {
        header = h[0];
        const rest = s.slice(h[0].length).trim();
        if (rest) out.push({ header, text: rest });
        continue;
      }
      out.push({ header, text: s });
    }
  }
  return out;
}

const ELSEWHERE = /київщин|вінниччин|хмельниччин|рівненщин|чернігівщин|волин|молдов|кишин|польщ|білорус|харків|одес|дніпр|запоріж|львів/;
const TARGET_WORDS = /шахед|бпла|ракет|реактив|дрон|ціл/;
// Part of a post about our area. Local channels keep the whole post unless it is clearly about another region;
// country-wide channels keep only the items naming our places (with their "4 шахеди на Київщині:" header).
export function relevantText(text, local) {
  const t = clean(text);
  const list = items(t);
  const sectioned = list.some(i => i.header);
  if (local && !sectioned) {
    const low = t.toLowerCase();
    return ELSEWHERE.test(low) && !mentions(t) && !OURS.test(low) ? '' : t;
  }
  const kept = [];
  let lastHeader = null;
  for (const i of list) {
    const ours = mentions(i.text) || (i.header && mentions(i.header)) || (local && OURS.test(i.text.toLowerCase()));
    if (!ours) continue;
    const prefix = i.header && i.header !== lastHeader && !mentions(i.header) && TARGET_WORDS.test(i.header.toLowerCase()) ? i.header + ' ' : '';
    const withHeader = i.header && mentions(i.header) && i.header !== lastHeader ? i.header + ' ' : prefix;
    kept.push(withHeader + i.text);
    lastHeader = i.header;
  }
  return kept.join('\n');
}

// ---------- classification (over lower-cased text, except TOWARDS) ----------
const PVO = re(String.raw`(?<![<L>])(ппо|пво|мвг)(?![<L>])|мобільн\S*\s+(вогнев\S*\s+)?груп|збит(?!к)|збил|збиття|(?<![<L>])мінус(?![<L>])|мінусанул|знешкод|приземлил|приземлен|знищен\S*\s+(\d|ціл|шахед|бпла|дрон|ракет)|(?<![<L>])[ій]?де робота|працю\S*\s+(ппо|мвг|по ціл)`);
const HIT = re(String.raw`приліт|прильот|влучан|вибух|(?<!буде\s|може\s+бути\s)гучно|(?<!загроз\S*\s)удар(?!н)|уражен|пошкодж|руйнуван|загинул|загибл|постражда|поранен|уламк|детонац|наслідк\S*\s+(\S+\s+)?атак|після\s+атак|ворог\s+атаку|атакува\S*\s+(\S+\s+)?(житомир|громад|підприємств|об.єкт|інфраструктур|місто)`);
const CALM = re(String.raw`без\s+(бпла|фіксац|загроз|цілей)|(?<![<L>])чисто|немає\s+(в\s+області\s+)?(жодного\s+)?(бпла|цілей)|нема\s+(в\s+області|бпла)|по\s+(всій\s+)?області\s*(✅|💚|🟢)|відбій\s+(по|в)\s+(всій\s+)?області`);
const COURSE = re(String.raw`шахед|шахєд|мопед|бпла|дрон|ракет|реактив|крилат|балістик|герань|гербера|калібр|іскандер|кинджал|(?<![<L>])х-\d|(?<![<L>])кр(?![<L>])|ту-\d|міг-31|авіац|розвідн|орлан|zala|supercam|(?<![<L>])ціл[ьі](?![<L>])|курс|напрям|в бік|у бік|повз|(?<![<L>])над\s|залітає|залітают|заходит|підліт|підлітає|летить|летять|летит|(?<![<L>])суне|(?<![<L>])пре(?![<L>])|(?<![<L>])[ій]де(?![<L>])|[ій]дуть|рухаєт|маневру|кружля|перелітає|перелетів|з\s+(півночі|півдня|заходу)|зі\s+сходу|(?<![<L>])меж[аіу](?![<L>])|(північ|півден|схід|захід|північно|південно)\S*[\s-]+(\S+\s+)?(частин|сторон|околиц|напрям|передміст)`);
const SUMMARY = re(String.raw`^[^<L>]*(приблизна\s+)?(мапа|карта)\s+(руху|шахед|ракет)`);
// Over the original text: "З Київщини на Народичі", "На/повз Світин" — direction to a capitalised place.
const TOWARDS = re(String.raw`(^|[\s,.:—-])(з|З|із|Із|зі|Зі|від|Від)\s+\S+(\s+\S+)?\s+(на|до|в бік|у бік)\s+[<U>]|^[^<L>]*(на|На|повз|Повз)\s*(\/\s*повз\s*)?[<U>]`);
const WARN = re(String.raw`уважно|увага|укритт|сховал|сховат|сховай|ховайт|ховайся|сидимо|не висову|не виходимо|бігом|актуальн|перекур закінч|дорозвідк|може\s+бути\s+гучно|буде\s+гучно|небезпек`);
const COUNTED = re(String.raw`(?<![<L>\d])\d+\s*[хx]?\s+(на|в|у|повз|з|до|біля)\s`);
const FILLER = re(String.raw`(?<![<L>])(громад[<L>]*|район[<L>]*|р-н|також|актуальн[<L>]*|ну|та|і|й|а|біля|околиц[<L>]*)(?![<L>])`, 'g');
const LETTER = re('[<L>]', 'g');

// Only place names (and "громада", "також", "/"): local admins' way of saying where the target is right now.
function isBarePlace(text) {
  const { hl } = findPlaces(text);
  if (!hl.length) return false;
  let rest = text;
  for (const w of hl) rest = rest.split(w).join(' ');
  return (rest.toLowerCase().replace(FILLER, ' ').match(LETTER) || []).length <= 3;
}

// Relevant text -> 'pvo' | 'hit' | 'calm' | 'course' | 'warn' | null
export function classify(text, local) {
  if (!text) return null;
  const low = text.toLowerCase();
  if (text.length > 260) {
    // Long posts are news: they count only as explosions / air defence in our area.
    if (!mentions(text)) return null;
    if (PVO.test(low)) return 'pvo';
    if (HIT.test(low)) return 'hit';
    return null;
  }
  if (SUMMARY.test(low)) return null; // after-the-fact maps of the night
  if (PVO.test(low)) return 'pvo';
  if (HIT.test(low)) return 'hit';
  if (CALM.test(low)) return 'calm';
  const placed = mentions(text) || OURS.test(low) || CITY_WORDS.test(low);
  // Without a place, only short posts are live reports; longer ones are news about new weapons etc.
  if ((COURSE.test(low) || TOWARDS.test(text)) && (!local || placed || text.length <= 120)) return 'course';
  if (WARN.test(low)) return 'warn';
  if (!local) return COUNTED.test(low) ? 'course' : null; // "1 на Малин"
  if (text.length <= 60 && isBarePlace(text)) return 'course'; // "Світин", "Черняхівська громада": where the target is now
  return null;
}

// ---------- alerts ----------
export const DISTRICTS = ['Житомирський', 'Бердичівський', 'Коростенський', 'Звягельський'];
export const CITY_AREAS = ['Житомирська громада', 'Житомирський', 'Житомирська область'];
const DISTRICT_WORDS = [
  ['Житомирський', re(String.raw`житомирськ(ий|ого|ому)(?![<L>])`)], ['Бердичівський', re(String.raw`бердичівськ(ий|ого|ому)(?![<L>])`)],
  ['Коростенський', re(String.raw`коростенськ(ий|ого|ому)(?![<L>])`)], ['Звягельський', re(String.raw`(звягельськ|новоград-волинськ)(ий|ого|ому)(?![<L>])`)],
];

// "Житомирський район" -> 'Житомирський', "м. Житомир та Житомирська територіальна громада" -> 'Житомирська громада'.
export function areaKey(name) {
  const n = name.replace(/\s+/g, ' ').trim(), low = n.toLowerCase();
  if (/област/.test(low)) return /житомир/.test(low) ? 'Житомирська область' : null;
  if (/громад|^м\.|місто/.test(low)) {
    if (/житомирськ\S*\s+(міськ\S*\s+)?територіальн|м\.\s*житомир|місто\s+житомир/.test(low)) return 'Житомирська громада';
    return mentions(n) ? n : null;
  }
  for (const [key, r] of DISTRICT_WORDS) if (r.test(low)) return key;
  return null;
}

const LEVEL = /(жовт|помаранчев|червон)\S*\s+рів/;
const ALL_CLEAR = /по\s+(всій\s+)?області\s*(✅|💚|🟢)|відбій\s+(по|в)\s+(всій\s+)?області/;
// Official alert reposts, e.g. "🟡 Житомирський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)",
// "🟢 Житомирський район — відбій повітряної тривоги ⚠️ … повітряна тривога досі триває у: - Коростенський район",
// and the admins' own "✅✅Відбій Бердичівський Житомирський район 🛑Тривога триває Коростенський район".
// Returns [{ area, state: 'on'|'off', level?, threat?, still? }].
export function parseAlerts(text) {
  const out = [];
  const [main, rest = ''] = text.split(/досі\s+триває\s+у:?/i);
  for (const seg of main.split(/(?=[🟢🟡🟠🔴⚪])/u)) {
    const m = /^[🟢🟡🟠🔴⚪]\s*(.+?)\s+[—–]\s+([\s\S]+)$/u.exec(seg.trim());
    if (!m) continue;
    const area = areaKey(m[1]);
    if (!area) continue;
    const body = m[2], low = body.toLowerCase();
    if (/відбій/.test(low)) { out.push({ area, state: 'off' }); continue; }
    if (!/тривог/.test(low)) continue;
    const level = LEVEL.exec(low)?.[1];
    out.push({
      area, state: 'on',
      level: level && { жовт: 'жовтий', помаранчев: 'помаранчевий', червон: 'червоний' }[level],
      threat: /:\s*([^(⚠\n]+)/.exec(body)?.[1]?.trim(),
    });
  }
  for (const line of rest.split(/\n|(?=\s-\s)/)) {
    const area = /\S/.test(line) ? areaKey(line.replace(/^[\s-]+/, '')) : null;
    if (area) out.push({ area, state: 'on', still: true });
  }
  return out.length ? out : parseInformal(text);
}

function parseInformal(text) {
  if (text.length > 140) return [];
  const low = text.toLowerCase();
  if (ALL_CLEAR.test(low)) return [...DISTRICTS, 'Житомирська область'].map(area => ({ area, state: 'off' }));
  const keys = [...low.matchAll(/відбій|тривога\s+(триває|досі)|тривог[аи]/g)];
  if (!keys.length) return [];
  const out = [];
  keys.forEach((k, i) => {
    const chunk = low.slice(i === 0 ? 0 : k.index, keys[i + 1]?.index ?? low.length);
    const state = /відбій/.test(k[0]) ? 'off' : 'on';
    for (const [area, r] of DISTRICT_WORDS) if (r.test(chunk)) out.push({ area, state, still: /триває|досі/.test(k[0]) || undefined });
  });
  return out;
}

const LEVEL_RANK = { жовтий: 1, помаранчевий: 2, червоний: 3 };
const HISTORY_MS = 48 * 3600e3;
// Applies alert transitions (sorted by time) to per-area state { state, since, ts, level, threat, url, log }.
// log holds [time, 'on'|'off'] state changes for the last 48 hours.
export function applyAlerts(areas, transitions, now = Date.now()) {
  const d = structuredClone(areas || {});
  for (const t of [...transitions].sort((a, b) => a.ts - b.ts)) {
    const cur = d[t.area];
    if (cur && t.ts <= cur.ts) continue;
    if (t.still && cur?.state === 'on') { cur.ts = t.ts; continue; }
    const same = cur && cur.state === t.state;
    const log = (cur?.log || []).slice();
    if (!same) log.push([new Date(t.ts).toISOString(), t.state]);
    d[t.area] = {
      state: t.state,
      since: same ? cur.since : new Date(t.ts).toISOString(),
      ts: t.ts,
      level: t.state === 'on' ? (t.level || (same ? cur.level : undefined)) : undefined,
      threat: t.state === 'on' ? (t.threat || (same ? cur.threat : undefined)) : undefined,
      url: t.url,
      log,
    };
  }
  for (const a of Object.values(d)) if (a.log) a.log = a.log.filter(([t], i, l) => now - Date.parse(t) < HISTORY_MS || i === l.length - 1);
  return d;
}

// The city is under alert when its community, its district or the whole oblast is.
export function cityStatus(areas) {
  const known = CITY_AREAS.map(k => areas?.[k]).filter(Boolean);
  if (!known.length) return null;
  const on = known.filter(a => a.state === 'on');
  if (on.length) {
    const first = [...on].sort((a, b) => a.since.localeCompare(b.since))[0];
    const top = [...on].sort((a, b) => (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0))[0];
    return { state: 'on', since: first.since, ts: Math.max(...on.map(a => a.ts)), level: top.level, threat: on.find(a => a.threat)?.threat, url: top.url };
  }
  const last = [...known].sort((a, b) => b.since.localeCompare(a.since))[0];
  return { state: 'off', since: last.since, ts: last.ts, url: last.url };
}

// ---------- fetching ----------
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
function decode(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
}

async function fetchChannel(src, pages) {
  const [name, query] = src.split('?');
  let before = '', all = [];
  for (let p = 0; p < pages; p++) {
    const qs = [query, before && `before=${before}`].filter(Boolean).join('&');
    const res = await fetch(`https://t.me/s/${name}${qs ? '?' + qs : ''}`, { headers: { 'user-agent': 'Mozilla/5.0 (zhytomyr-dashboard)' } });
    if (!res.ok) { if (p === 0) throw new Error(`HTTP ${res.status}`); break; }
    const ms = parseMessages(await res.text());
    if (!ms.length) break;
    all = [...ms, ...all];
    before = ms[0].post.split('/')[1];
  }
  return all;
}

// Turns posts of one channel into alert transitions and feed events.
export function processChannel(channel, messages, { local, since }) {
  const transitions = [], events = [];
  for (const m of messages) {
    const url = `https://t.me/${m.post}`;
    const low = m.text.toLowerCase();
    if (ADS.test(low)) continue;
    if (local) {
      const alerts = parseAlerts(clean(m.text));
      if (alerts.length) {
        for (const a of alerts) transitions.push({ ...a, ts: m.ts, url });
        if (!ALL_CLEAR.test(low)) continue; // "По всій області✅" is also news for the feed
      }
    }
    if (m.ts < since) continue;
    if (CIVIL.test(low) && !STRONG.test(low)) continue;
    const text = relevantText(m.text, local);
    const type = classify(text, local);
    if (!type) continue;
    const { places, hl, city } = findPlaces(text);
    events.push({ type, time: new Date(m.ts).toISOString(), channel, url, text: text.slice(0, 500), places, hl, city: city || (local && CITY_WORDS.test(text.toLowerCase())) });
  }
  return { transitions, events };
}

export async function collect(env = {}, prevAreas = {}) {
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const sources = list(env.CHANNELS || DEFAULT_CHANNELS).map(s => s.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, ''));
  const localChannels = list(env.LOCAL_CHANNELS || DEFAULT_LOCAL).map(s => s.toLowerCase());
  const since = Date.now() - (+env.HOURS || 24) * 3600e3;
  const events = [], transitions = [], errors = [];
  await Promise.all(sources.map(async src => {
    const channel = src.split('?')[0];
    const local = localChannels.includes(channel.toLowerCase());
    try {
      const messages = await fetchChannel(src, local ? (+env.PAGES_LOCAL || 1) : 1);
      if (!messages.length) errors.push(`${channel}: no messages on page`);
      const r = processChannel(channel, messages, { local, since });
      transitions.push(...r.transitions);
      events.push(...r.events);
    } catch (e) { errors.push(`${channel}: ${e.message}`); }
  }));
  const districts = applyAlerts(prevAreas, transitions);
  const seen = new Set();
  return {
    updated: new Date().toISOString(),
    district: 'Житомирський',
    alert: cityStatus(districts),
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
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=10' },
    });
  },
};
