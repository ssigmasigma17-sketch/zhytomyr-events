import assert from 'node:assert';
import { parseMessages, classify, parseAlerts, applyAlerts, relevantText, DEFAULT_PLACES } from './index.js';
const places = DEFAULT_PLACES.split(',').map(s => s.toLowerCase());
const msg = (post, t, text) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="${post}"><div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div><a class="tgme_widget_message_date"><time datetime="${t}" class="time">x</time></a></div></div>`;
const m = parseMessages(msg('a/1', '2026-09-30T17:00:00+00:00', 'Раз<br/>два') + msg('a/2', '2026-09-30T17:30:00+00:00', 'три'));
assert.equal(m.length, 2); assert.equal(m[0].text, 'Раз\nдва'); assert.equal(m[1].ts, Date.parse('2026-09-30T17:30:00Z'));

// district alerts, wording taken from the channels
assert.deepEqual(parseAlerts('🟡 Житомирський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)'),
  [{ district: 'Житомирський', state: 'on', level: 'жовтий', threat: 'Дронова загроза' }]);
assert.deepEqual(parseAlerts('🟡 Житомирський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)\n🟡 Бердичівський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)').map(a => a.district), ['Житомирський', 'Бердичівський']);
assert.deepEqual(parseAlerts('🟢 Житомирський район — відбій повітряної тривоги\n⚠️ Зверніть увагу, повітряна тривога досі триває у:\n- Коростенський район'),
  [{ district: 'Житомирський', state: 'off' }, { district: 'Коростенський', state: 'on', still: true }]);
assert.deepEqual(parseAlerts('Реактивний БпЛА в бік Радомишля!'), []);

const T = h => Date.parse(`2026-09-30T${h}:00Z`);
let d = applyAlerts({}, [
  { district: 'Житомирський', state: 'on', level: 'жовтий', threat: 'Дронова загроза', ts: T('15:45') },
  { district: 'Житомирський', state: 'on', level: 'жовтий', ts: T('15:46') }, // repost by another channel
  { district: 'Житомирський', state: 'off', ts: T('15:59') },
  { district: 'Житомирський', state: 'on', level: 'червоний', threat: 'Ракетна загроза', ts: T('17:01') },
]);
assert.equal(d.Житомирський.state, 'on'); assert.equal(d.Житомирський.since, '2026-09-30T17:01:00.000Z'); assert.equal(d.Житомирський.level, 'червоний');
d = applyAlerts(d, [{ district: 'Житомирський', state: 'on', ts: T('17:10') }]);
assert.equal(d.Житомирський.since, '2026-09-30T17:01:00.000Z'); assert.equal(d.Житомирський.threat, 'Ракетна загроза');
d = applyAlerts(d, [{ district: 'Житомирський', state: 'off', ts: T('16:00') }]); // older than known state: ignored
assert.equal(d.Житомирський.state, 'on');

// country-wide monitor: keep only our lines, signature does not count as air defence
const mon = relevantText('📡Реактивні шахеди:\n⚠️2 реактивні шахеди з Чернігівщини на Київщину; ⚠️1 реактивний шахед з Київщини на Житомирщину\nПідписатись 👉 🚀ППО | РАДАР @mon1tor_ua', places, false);
assert.equal(mon, '⚠️1 реактивний шахед з Київщини на Житомирщину'); assert.equal(classify(mon, false), 'course');
assert.equal(relevantText('Шахеди на Київ', places, false), '');

// local channel
const t = relevantText('Попередньо, збили. Дякуємо силам ППО.\nТруха⚡️Житомир | Надіслати новину', places, true);
assert.equal(t, 'Попередньо, збили. Дякуємо силам ППО.'); assert.equal(classify(t, true), 'pvo');
assert.equal(classify('Вибухи! Сидимо в укриттях.', true), 'hit');
assert.equal(classify('Реактивний БпЛА в бік Радомишля!', true), 'course');
assert.equal(classify('8800 дерев — 33 млн грн збитків: на Житомирщині викрили лісорубів', true), null);
assert.equal(classify('Ударні БпЛА курсом на Житомир', true), 'course');
// local channel posts about other places
assert.equal(relevantText('🇲🇩 Реактивний дрон летить у напрямку столиці Молдови, незабаром буде над Кишиневом', places, true), '');
assert.equal(relevantText('На Вінниччині в районі Козятина Реактивний\nМоже до нас тримати курс', places, true), 'На Вінниччині в районі Козятина Реактивний\nМоже до нас тримати курс');
assert.equal(classify('Такий боєзаряд створено спеціально для знищення високовольтних опор', true), null);
assert.equal(classify('Знищено 2 шахеди над Житомирщиною', true), 'pvo');
console.log('ok');
