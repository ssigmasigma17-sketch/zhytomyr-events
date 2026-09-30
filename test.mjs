// Parser checks on real wording from the channels (September 2026). Run: node worker/test.mjs
import assert from 'node:assert';
import { parseMessages, processChannel, parseAlerts, applyAlerts, cityStatus, relevantText, classify, findPlaces, clean } from './index.js';

const type = (text, local) => {
  const r = processChannel('test', [{ post: 'c/1', ts: Date.now(), text }], { local, since: 0 });
  return r.events[0]?.type ?? (r.transitions.length ? 'alert' : null);
};

// [post text, local channel?, expected type]
const CASES = [
  // local channels: admins' short live posts
  ['Коростень уважно', true, 'warn'],
  ['Все ще маневрує над містом', true, 'course'],
  ['На Нову Борову/Іршанськ', true, 'course'],
  ['Дуже низько йдуть\nТому там де підвищена була і є\nУважно', true, 'course'],
  ['Немає в області жодного БПЛА', true, 'calm'],
  ['Північна частина міста і передмістям!\nБпЛА на/повз Черняхів у напрямку Жт ‼️', true, 'course'],
  ['Не висовуємося !', true, 'warn'],
  ['Крошня , уважно найближчим часом ‼️', true, 'warn'],
  ['На/повз Світин\nВереси', true, 'course'],
  ['Жт сховалися ‼️‼️‼️', true, 'warn'],
  ['Північно-східна частина передмістя', true, 'course'],
  ['+1 новий в напрямку Овруча ( реактивний)', true, 'course'],
  ['Марʼянівка', true, 'course'],
  ['Жт‼️', true, 'course'],
  ['Житомир уважно\nПре у напрямку міста', true, 'course'],
  ['До відбою уважно\nПроводиться дорозвідка', true, 'warn'],
  ['Малин увага\nЗ Київщини летить БПЛА', true, 'course'],
  ['З Попільні на ЖТ\nВ укриття пройдіть', true, 'course'],
  ['ЖТ сидимо', true, 'warn'],
  ['В області досі без фіксації', true, 'calm'],
  ['Станом на зараз в області без фіксацій БПЛА\nВ ППУ +-13 БПЛА\nНайближчий до нас в ЧЗВ', true, 'calm'],
  ['На Вінниччині в районі Козятина Реактивний\nМоже до нас тримати курс', true, 'course'],
  ['Крошня може бути гучно', true, 'warn'],
  ['Світин', true, 'course'],
  ['Реактивний підлітає до міста', true, 'course'],
  ['Гучно', true, 'hit'],
  ['Гучно було, ще сидимо і чекаємо', true, 'hit'],
  ['Буде гучно', true, 'warn'],
  ['Є час сховатися ще', true, 'warn'],
  ['Йде робота', true, 'pvo'],
  ['ППО ❤️', true, 'pvo'],
  ['Пишуть за збиття', true, 'pvo'],
  ['Черняхівська громада', true, 'course'],
  ['Бпла з Київщини до нас', true, 'course'],
  ['Радомишль', true, 'course'],
  ['1 на Малин та 1 на Овруч. Труха⚡️Житомир | Надіслати новину', true, 'course'],
  ['Попередньо, чисто. UPD 21:33: відбій. Труха⚡️Житомир | Надіслати новину', true, 'calm'],
  ['Гучно! Сидимо в укриттях! Труха⚡️Житомир | Надіслати новину', true, 'hit'],
  ['Вибух.\n▫️ Запустили карту руху БпЛА по районах. Усе оновлюється онлайн — перевіряйте обстановку в один клік:\n➡️ https://t.me/+Syr7t8oP32dmMjc0', true, 'hit'],
  ['Новий БпЛА з Київщини у наш бік. UPD 07:49: відбій. Труха⚡️Житомир | Надіслати новину', true, 'course'],
  ['Мопед над Житомиром! Вокзал та центр міста, сховалися.', true, 'course'],
  ['Попередньо, збили! До відбою в укриттях.', true, 'pvo'],
  ['Житомир найближчий час уважно!!! @zhytomyr412', true, 'warn'],
  ['Житловий будинок постраждав через атаку на Житомир 😱', true, 'hit'],
  // news, ads and city life: not in the feed
  ['Корбутівка , ДТП на мосту, є затор', true, null],
  ['Бігом на пошту за посилкою', true, null],
  ['Трохи затор на Корбутівці ❤️ Телеграм канал PZHYTOMYR | Підписатися | Надіслати новинуℹ️', true, null],
  ['🟡📣 Карта міста та області під час атаки — що відбувається в небі прямо зараз: Перевірити 😊 https://t.me/+_R_Qhm786MY3MzUy', true, null],
  ['⚠️😱 Зʼявились перші жахливі кадри з Житомира ⬇️ ❗️ https://t.me/+5anwYL93JApkYjM0 (Терміново до перегляду, це жах 🤯) #реклама', true, null],
  ['Онлайн-робота без досвіду: навчання від роботодавця безкоштовно 🎓 • Оператор call-центру — від 15 000 грн', true, null],
  ['росіяни вперше застосували реактивний БпЛА з боєзарядом кумулятивно-ріжучого спеціального навантаження (КРСН). Боєзаряд призначено для знищення високовольтних опор та залізних мостових конструкцій.', true, null],
  ['🇲🇩 Реактивний дрон летить у напрямку столиці Молдови, незабаром буде над Кишиневом\nЩо шо шо', true, null],
  ['Приблизна мапа руху ракет та дронів під час нічної атаки 🤯', true, null],
  ['🌲 8800 дерев — 33 млн грн збитків: на Житомирщині викрили «чорних» лісорубів', true, null],
  ['🍄 Грибний сезон уже з наслідками: на Житомирщині зафіксували перше отруєння', true, null],
  ['Сьогодні на Житомирщині тепло', true, null],
  // country-wide monitors: only our items
  ['‼️Житомирщина: • 1х реактивний шахед курсом на Житомир;  ‼️Київщина: • 2х реактивних шахеди курсом на Київ та Ворзель;', false, 'course'],
  ['❗️⚠️1 ракета Герань-5 з Житомирщини на Рівненщину, Сарненський район. Підписатись 👉 🚀ППО | РАДАР @mon1tor_ua', false, 'course'],
  ['⚠️Звичайний шахед на Житомир, 3 хвилини підліт.', false, 'course'],
  ['Друга поки в бік Житомирщини', false, 'course'],
  ['1 реактив на півночі Житомира.', false, 'course'],
  ['1 шахед з Київщини на Народичі', false, 'course'],
  ['БпЛА з Київщини курсом на Ємільчине', false, 'course'],
  ['💥Внаслідок влучання частина Києва, Житомира, Київської та Житомирської областей залишились без світла та водопостачання.', false, 'hit'],
  ['💡У Києві та на Житомирщині запроваджені екстрені відключення електроенергії, внаслідок атаки', false, null],
  ['2 шахеди з Чернігівщини на Київщину', false, null],
  ['ПУБЛІКАЦІЙ НА КАНАЛІ НЕ БУДЕ — АДМІНКА ІДЕ ЗА КУРТАЧКОЙ НА ХМЕЛЬНИЦЬКИЙ БАЗАР', false, null],
  ['Кияни та Київщина!\n\nНагадую про мій другий канал «КИЇВ СИГНАЛ — KYIV SIGNAL».', false, null],
];
let failed = 0;
for (const [text, local, want] of CASES) {
  const got = type(text, local);
  if (got !== want) { failed++; console.error(`✗ ${JSON.stringify(text.slice(0, 70))}: ${got} (want ${want})`); }
}
assert.equal(failed, 0, `${failed} of ${CASES.length} classification cases failed`);

// only our items are kept, with their section header
assert.equal(relevantText('⚠️4 реактивні шахеди на Київщині:\n2 на півночі Київщини на Житомирщину \n1 повз Сквиру на Житомирщину \n1 біля Бородянки\n\n⚠️1 реактивний шахед з Вінниччини на Хмельниччину в район Старокостянтинова', false),
  '⚠️4 реактивні шахеди на Київщині: 2 на півночі Київщини на Житомирщину\n1 повз Сквиру на Житомирщину');
assert.equal(relevantText('Сумщина: Реактивний БпЛА курсом на Білопілля Чернігівщина: 2х БпЛА курсом на Холми Житомирщина: Реактивний БпЛА курсом на Народичі', true),
  'Житомирщина: Реактивний БпЛА курсом на Народичі');
assert.equal(clean('Попередньо, збили.\nДякуємо силам ППО.\nТруха⚡️Житомир | Надіслати новину'), 'Попередньо, збили.\nДякуємо силам ППО.');

// places: inflections, suburbs, city vs oblast, words that only look like places
assert.deepEqual(findPlaces('Реактивний БпЛА на Марʼянівку, потім над Високою Піччю і на Чуднова').places, ['Марʼянівка', 'Висока Піч', 'Чуднів']);
assert.equal(findPlaces('шахед на Житомирщині').city, false);
assert.equal(findPlaces('шахед на Житомир').city, true);
assert.equal(findPlaces('Межа Вінницької та Жт областей').city, false);
assert.deepEqual(findPlaces('30 вересня купив малину на базарі').places, []);

// alerts: official reposts, the "still on" list, admins' own wording
assert.deepEqual(parseAlerts('🟡 Житомирський район — повітряна тривога, жовтий рівень: Дронова загроза (жовтий рівень)'),
  [{ area: 'Житомирський', state: 'on', level: 'жовтий', threat: 'Дронова загроза' }]);
assert.deepEqual(parseAlerts('🟢 Житомирський район — відбій повітряної тривоги\n⚠️ Зверніть увагу, повітряна тривога досі триває у:\n- Коростенський район'),
  [{ area: 'Житомирський', state: 'off' }, { area: 'Коростенський', state: 'on', still: true }]);
assert.deepEqual(parseAlerts('🔴 м. Житомир та Житомирська територіальна громада — повітряна тривога').map(a => a.area), ['Житомирська громада']);
assert.deepEqual(parseAlerts('✅✅Відбій\nБердичівський\nЖитомирський\nЗвягельський район\n🛑Тривога триває\nКоростенський район').map(a => `${a.area}:${a.state}`).sort(),
  ['Бердичівський:off', 'Житомирський:off', 'Звягельський:off', 'Коростенський:on']);
assert.deepEqual(parseAlerts('Житомирський Та Бердичівський Тривога 🚨').map(a => `${a.area}:${a.state}`), ['Житомирський:on', 'Бердичівський:on']);
assert.equal(parseAlerts('По всій області✅').every(a => a.state === 'off'), true);
assert.deepEqual(parseAlerts('До відбою уважно\nПроводиться дорозвідка'), []);
assert.deepEqual(parseAlerts('Реактивний БпЛА в бік Радомишля!'), []);

// state keeps the start of an alert across reposts and ignores older posts
const T = h => Date.parse(`2026-09-30T${h}:00Z`);
let d = applyAlerts({}, [
  { area: 'Житомирський', state: 'on', level: 'жовтий', threat: 'Дронова загроза', ts: T('15:45') },
  { area: 'Житомирський', state: 'on', level: 'жовтий', ts: T('15:46') },
  { area: 'Житомирський', state: 'off', ts: T('15:59') },
  { area: 'Житомирський', state: 'on', level: 'червоний', threat: 'Ракетна загроза', ts: T('17:01') },
], T('18:00'));
assert.equal(d.Житомирський.since, '2026-09-30T17:01:00.000Z');
assert.deepEqual(d.Житомирський.log.map(([, s]) => s), ['on', 'off', 'on']);
d = applyAlerts(d, [{ area: 'Житомирський', state: 'on', ts: T('17:10') }, { area: 'Житомирський', state: 'off', ts: T('16:00') }], T('18:00'));
assert.equal(d.Житомирський.since, '2026-09-30T17:01:00.000Z');
assert.equal(d.Житомирський.threat, 'Ракетна загроза');
// the city is under alert when its district or the oblast is
assert.equal(cityStatus({ 'Житомирська область': { state: 'on', since: '2026-09-30T17:05:00Z', ts: 1 }, Житомирський: { state: 'off', since: '2026-09-30T16:00:00Z', ts: 1 } }).state, 'on');
assert.equal(cityStatus({ Бердичівський: { state: 'on', since: '2026-09-30T17:05:00Z', ts: 1 } }), null);

// page parsing
const msg = (post, t, text) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="${post}"><div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div><a class="tgme_widget_message_date"><time datetime="${t}" class="time">x</time></a></div></div>`;
const m = parseMessages(msg('a/1', '2026-09-30T17:00:00+00:00', 'Раз<br/>два &amp; три') + msg('a/2', '2026-09-30T17:30:00+00:00', 'чотири'));
assert.deepEqual(m.map(x => [x.post, x.text]), [['a/1', 'Раз\nдва & три'], ['a/2', 'чотири']]);
assert.equal(classify('', true), null);

console.log(`ok (${CASES.length} real posts)`);
