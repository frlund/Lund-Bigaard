/* Bigårdsjournal – applogikk (ren JavaScript, ingen rammeverk). */
'use strict';

(() => {
  const APP_VERSION = '1.1.0';
  const BRAND = 'Lund Bigaard';
  const LOGO_SRC = 'img/lund-bigaard-logo.png';
  const SCHEMA_VERSION = 1;
  const BACKUP_FORMAT = 'bigardsjournal-backup';
  const DRAFT_PREFIX = 'bigardsjournal-utkast:';
  const BACKUP_REMINDER_DAYS = 30;
  const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

  /* ===================== Valgalternativer ===================== */
  // Kodene lagres i databasen og i sikkerhetskopien. Tekstene kan endres uten å påvirke data.
  const OPT = {
    queen: [['sett', 'Sett'], ['ikke_observert', 'Ikke observert'], ['ikke_sjekket', 'Ikke sjekket']],
    eggs: [['sett', 'Sett'], ['ikke_observert', 'Ikke observert'], ['ikke_sjekket', 'Ikke sjekket']],
    brood: [['mye', 'Mye'], ['middels', 'Middels'], ['lite', 'Lite'], ['ikke_observert', 'Ikke observert'], ['ikke_sjekket', 'Ikke sjekket']],
    strength: [['sterk', 'Sterk'], ['middels', 'Middels'], ['svak', 'Svak'], ['ikke_sjekket', 'Ikke sjekket']],
    feed: [['rikelig', 'Rikelig'], ['tilstrekkelig', 'Tilstrekkelig'], ['lite', 'Lite'], ['ikke_sjekket', 'Ikke sjekket']],
    swarm: [['ikke_observert', 'Ikke observert'], ['spillkopper', 'Spillkopper'], ['dronningceller', 'Dronningceller'], ['svermet', 'Har svermet'], ['ikke_sjekket', 'Ikke sjekket']],
    actions: [
      ['foret', 'Fôret'], ['utvidet', 'Utvidet'], ['skattekasse_paa', 'Skattekasse på'], ['skattekasse_av', 'Skattekasse av'],
      ['svermekontroll', 'Svermekontroll'], ['avlegger', 'Laget avlegger'], ['rammer', 'Byttet rammer'],
      ['dronning', 'Dronningbytte'], ['varroabehandling', 'Varroabehandling']
    ],
    method: [
      ['oksalsyre_drypp', 'Oksalsyre, drypp'], ['oksalsyre_fordamping', 'Oksalsyre, fordamping'], ['maursyre', 'Maursyre'],
      ['melkesyre', 'Melkesyre'], ['tymol', 'Tymol'], ['droneramme', 'Droneramme / bioteknisk'], ['annet', 'Annet']
    ]
  };
  const OPT_MAP = {};
  Object.keys(OPT).forEach((k) => { OPT_MAP[k] = Object.fromEntries(OPT[k]); });
  const optLabel = (group, v) => (OPT_MAP[group] && OPT_MAP[group][v]) || String(v);

  const INSPECTION_FIELDS = [
    ['queen', 'Dronning'], ['eggs', 'Egg'], ['brood', 'Yngel'],
    ['strength', 'Bistyrke'], ['feed', 'Fôrstatus'], ['swarm', 'Svermetegn']
  ];
  const WARN_VALUES = { feed: ['lite'], swarm: ['dronningceller', 'svermet'], strength: ['svak'] };

  /* ===================== Hjelpefunksjoner ===================== */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const val = props[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') el.className = val;
        else if (key === 'text') el.textContent = val;
        else if (key === 'dataset') Object.assign(el.dataset, val);
        else if (key === 'value') el.value = val;
        else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
        else el.setAttribute(key, val === true ? '' : String(val));
      });
    }
    appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    children.forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) appendChildren(el, c);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  function uuid() {
    if (self.crypto && typeof self.crypto.randomUUID === 'function') return self.crypto.randomUUID();
    const b = new Uint8Array(16);
    self.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const x = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  const nowISO = () => new Date().toISOString();
  const pad = (n) => String(n).padStart(2, '0');
  const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISODate(new Date());
  function isValidISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function parseISODate(s) {
    if (!isValidISODate(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(iso, n) {
    const d = parseISODate(iso) || new Date();
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }
  const daysFromToday = (iso) => Math.round((parseISODate(iso) - parseISODate(todayISO())) / 86400000);

  const fmtWithYear = new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fmtNoYear = new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtShort = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtRate = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function fmtDate(iso) {
    const d = parseISODate(iso);
    if (!d) return iso || '';
    return d.getFullYear() === new Date().getFullYear() ? fmtNoYear.format(d) : fmtWithYear.format(d);
  }
  function relDays(iso) {
    const n = daysFromToday(iso);
    if (Number.isNaN(n)) return '';
    if (n === 0) return 'i dag';
    if (n === -1) return 'i går';
    if (n === 1) return 'i morgen';
    return n < 0 ? `for ${-n} dager siden` : `om ${n} dager`;
  }
  function fmtTimestamp(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : fmtDateTime.format(d);
  }

  const collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' });
  const byHiveName = (a, b) => collator.compare(a.name, b.name);
  const hiveLabel = (hive) => (hive ? (/^\d+$/.test(hive.name.trim()) ? `Kube ${hive.name.trim()}` : hive.name) : 'Ukjent kube');

  // Nyeste først: dato, deretter tidspunkt registreringen ble opprettet.
  function newestFirst(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
  }
  function latestPerHive(records) {
    const map = new Map();
    records.slice().sort(newestFirst).forEach((r) => { if (!map.has(r.hiveId)) map.set(r.hiveId, r); });
    return map;
  }
  const enc = encodeURIComponent;

  function describeError(err) {
    const name = err && err.name;
    if (name === 'QuotaExceededError') return 'Telefonen har ikke nok ledig lagringsplass for appen.';
    if (name === 'InvalidStateError') return 'Den lokale databasen er ikke tilgjengelig akkurat nå. Lukk appen helt og åpne den igjen.';
    if (name === 'UnknownError') return 'Nettleseren rapporterte en ukjent lagringsfeil.';
    const msg = err && err.message ? err.message : String(err);
    return `Teknisk feil: ${name ? name + ' – ' : ''}${msg}`;
  }

  function parseCount(str) {
    const s = String(str || '').trim().replace(/\s/g, '');
    if (s === '') return { empty: true };
    if (!/^\d+$/.test(s)) return { error: true };
    return { value: Number(s) };
  }
  function parseDays(str) {
    const s = String(str || '').trim().replace(',', '.');
    if (s === '') return { empty: true };
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: true };
    const v = Number(s);
    if (v <= 0 || v > 365) return { error: true };
    return { value: v };
  }
  const fmtNum = (n) => String(n).replace('.', ',');

  /* ===================== Meldinger og dialoger ===================== */
  let toastTimer = null;
  function showToast(message, type) {
    const el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.textContent = message;
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.hidden = false;
    el.onclick = () => { clearTimeout(toastTimer); el.hidden = true; el.classList.remove('hiding'); };
    toastTimer = setTimeout(() => {
      el.classList.add('hiding');
      toastTimer = setTimeout(() => { el.hidden = true; el.classList.remove('hiding'); }, 250);
    }, type === 'error' ? 6000 : 3500);
  }

  function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'Avbryt', danger = false }) {
    return new Promise((resolve) => {
      const messages = [].concat(message || []);
      const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, cancelText);
      const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}` }, confirmText);
      const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
        h('h2', { id: 'dlg-title' }, title),
        messages.map((m) => h('p', {}, m)),
        h('div', { class: 'dialog-actions' }, okBtn, cancelBtn));
      if (typeof dlg.showModal !== 'function') {
        resolve(window.confirm(`${title}\n\n${messages.join('\n')}`));
        return;
      }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        try { dlg.close(); } catch (_) { /* allerede lukket */ }
        dlg.remove();
        resolve(v);
      };
      okBtn.addEventListener('click', () => finish(true));
      cancelBtn.addEventListener('click', () => finish(false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
      document.body.append(dlg);
      dlg.showModal();
      cancelBtn.focus();
    });
  }

  function showAlert(box, title, items, kind) {
    box.className = `alert ${kind === 'info' ? 'alert-info' : 'alert-error'}`;
    box.setAttribute('role', 'alert');
    box.setAttribute('tabindex', '-1');
    box.replaceChildren(h('strong', {}, title), items && items.length ? h('ul', {}, items.map((t) => h('li', {}, t))) : null);
    box.hidden = false;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.focus({ preventScroll: true });
  }
  function hideAlert(box) { box.hidden = true; box.replaceChildren(); }

  /* ===================== Skjemautkast ===================== */
  // Skjemaet lagres fortløpende som utkast i localStorage, slik at ingenting går tapt
  // om appen lukkes, lagringen feiler eller brukeren navigerer bort ved et uhell.
  let currentForm = null;

  function makeFormState(key, initial, getValues, setValues) {
    const initialJSON = JSON.stringify(initial);
    let timer = null;
    const state = {
      key,
      isDirty: () => JSON.stringify(getValues()) !== initialJSON,
      saveDraftNow() {
        clearTimeout(timer);
        timer = null;
        try {
          if (state.isDirty()) localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ savedAt: nowISO(), values: getValues() }));
          else localStorage.removeItem(DRAFT_PREFIX + key);
        } catch (_) { /* utkast er en ekstra sikring – feil her skal ikke stoppe brukeren */ }
      },
      schedule() { clearTimeout(timer); timer = setTimeout(state.saveDraftNow, 400); },
      clearDraft() {
        clearTimeout(timer);
        timer = null;
        try { localStorage.removeItem(DRAFT_PREFIX + key); } catch (_) { /* ignorer */ }
      },
      loadDraft() {
        try {
          const d = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key));
          return d && d.values && typeof d.values === 'object' ? d : null;
        } catch (_) { return null; }
      },
      reset() { setValues(JSON.parse(initialJSON)); state.clearDraft(); }
    };
    return state;
  }

  function attachDraft(state, form, banner, setValues, initial) {
    const draft = state.loadDraft();
    if (draft && JSON.stringify(Object.assign({}, initial, draft.values)) !== JSON.stringify(initial)) {
      setValues(Object.assign({}, initial, draft.values));
      const when = new Date(draft.savedAt);
      banner.className = 'alert alert-info';
      banner.replaceChildren(
        h('strong', {}, 'Ulagret utkast hentet fram'),
        h('p', {}, `Det du skrev ${Number.isNaN(when.getTime()) ? '' : 'kl. ' + fmtTime.format(when) + ' '}er fylt inn igjen. Husk å lagre.`),
        h('button', {
          type: 'button', class: 'btn btn-secondary btn-small',
          onclick: () => { state.reset(); banner.hidden = true; showToast('Utkastet er forkastet'); }
        }, 'Forkast utkastet'));
      banner.hidden = false;
    }
    const onChange = () => state.schedule();
    form.addEventListener('input', onChange);
    form.addEventListener('change', onChange);
    form.addEventListener('click', (e) => { if (e.target.closest('button[type="button"]')) onChange(); });
    currentForm = state;
  }

  // Varsle før man forlater et skjema med ulagrede endringer via lenker i appen.
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !currentForm || !currentForm.isDirty()) return;
    e.preventDefault();
    const ok = await confirmDialog({
      title: 'Forlate skjemaet?',
      message: 'Du har endringer som ikke er lagret.',
      confirmText: 'Forkast endringene',
      cancelText: 'Fortsett å skrive',
      danger: true
    });
    if (ok && currentForm) {
      currentForm.clearDraft();
      currentForm = null;
      location.hash = a.getAttribute('href');
    }
  });
  const flushDraft = () => { if (currentForm) currentForm.saveDraftNow(); };
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });

  /* ===================== Skjemakomponenter ===================== */
  function choiceGroup({ id, legend, options, multi = false, hint, onChange }) {
    let value = multi ? [] : null;
    const buttons = options.map(([v, label]) => h('button', {
      type: 'button',
      class: 'choice',
      'aria-pressed': 'false',
      dataset: { v },
      onclick: () => {
        if (multi) value = value.includes(v) ? value.filter((x) => x !== v) : value.concat(v);
        else value = value === v ? null : v; // trykk igjen for å fjerne valget
        sync();
        if (onChange) onChange();
      }
    }, h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'), label));
    function sync() {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(multi ? value.includes(b.dataset.v) : value === b.dataset.v)));
    }
    const el = h('fieldset', { class: 'field', id },
      h('legend', {}, legend),
      hint ? h('p', { class: 'hint' }, hint) : null,
      h('div', { class: 'choices' }, buttons));
    return {
      el,
      get: () => (multi ? options.map((o) => o[0]).filter((x) => value.includes(x)) : value),
      set(v) {
        const valid = options.map((o) => o[0]);
        value = multi ? (Array.isArray(v) ? v.filter((x) => valid.includes(x)) : []) : (valid.includes(v) ? v : null);
        sync();
      }
    };
  }

  function textField({ id, label, hint, type = 'text', value = '', attrs = {} }) {
    const input = h('input', Object.assign({ id, name: id, type, value, autocomplete: 'off' }, attrs));
    const el = h('div', { class: 'field' },
      h('label', { class: 'label', for: id }, label),
      hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
      input);
    if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
    return { el, input };
  }

  function textArea({ id, label, hint, value = '', rows = 4 }) {
    const input = h('textarea', { id, name: id, rows, value });
    const el = h('div', { class: 'field' },
      h('label', { class: 'label', for: id }, label),
      hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
      input);
    if (hint) input.setAttribute('aria-describedby', `${id}-hint`);
    return { el, input };
  }

  /* ===================== Ruting ===================== */
  const $app = document.getElementById('app');
  let renderToken = 0;
  let flashId = null;
  let historyFilter = 'alle';

  function appHeader({ title, back, right }) {
    return h('header', { class: 'app-header' },
      back ? h('a', { class: 'back', href: back.href, 'aria-label': `Tilbake til ${back.label}` }, '‹ ', back.label) : null,
      h('div', { class: 'header-titles' },
        h('span', { class: 'brand' }, BRAND),
        h('h1', { id: 'page-title', tabindex: '-1' }, title)),
      h('span', { class: 'net-status' }, 'Frakoblet'),
      right || null);
  }

  function mount(token, ...nodes) {
    if (token !== renderToken) return false;
    $app.replaceChildren(...nodes);
    const title = document.getElementById('page-title');
    const text = title ? title.textContent : '';
    document.title = text && text !== 'Bigårdsjournal' ? `${text} – ${BRAND}` : `Bigårdsjournal – ${BRAND}`;
    if (title) title.focus({ preventScroll: true });
    return true;
  }

  async function render() {
    if (currentForm) currentForm.saveDraftNow();
    currentForm = null;
    const token = ++renderToken;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    window.scrollTo(0, 0);
    try {
      await DB.open();
      if (parts.length === 0) await viewHome(token);
      else if (parts[0] === 'ny-kube') await viewHiveForm(token, null);
      else if (parts[0] === 'kuber') await viewHives(token);
      else if (parts[0] === 'sikkerhetskopi') await viewBackup(token);
      else if (parts[0] === 'kube' && parts[1]) {
        const hiveId = parts[1];
        if (parts.length === 2) await viewHive(token, hiveId);
        else if (parts[2] === 'rediger') await viewHiveForm(token, hiveId);
        else if (parts[2] === 'inspeksjon' && parts[3]) await viewInspectionForm(token, hiveId, parts[3] === 'ny' ? null : parts[3]);
        else if (parts[2] === 'varroa' && parts[3]) await viewVarroaForm(token, hiveId, parts[3] === 'ny' ? null : parts[3]);
        else viewNotFound(token);
      } else viewNotFound(token);
    } catch (err) {
      console.error(err);
      viewError(token, err);
    }
  }

  function viewNotFound(token, message) {
    mount(token,
      appHeader({ title: 'Fant ikke siden', back: { href: '#/', label: 'Kuber' } }),
      h('main', {}, h('div', { class: 'card empty' },
        h('p', {}, message || 'Denne siden eller registreringen finnes ikke. Den kan være slettet.'),
        h('a', { class: 'btn btn-honey', href: '#/' }, 'Til forsiden'))));
  }

  function viewError(token, err) {
    mount(token,
      appHeader({ title: 'Bigårdsjournal' }),
      h('main', {}, h('div', { class: 'alert alert-error', role: 'alert' },
        h('strong', {}, 'Appen får ikke tilgang til journalen på denne enheten.'),
        h('p', {}, describeError(err)),
        h('p', {}, 'Mulige årsaker: privat nettlesing i Safari, for lite lagringsplass eller at nettleseren blokkerer lagring for nettsteder. Data du har lagret tidligere er ikke slettet av denne feilen.'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => location.reload() }, 'Prøv igjen'))));
  }

  /* ===================== Forside ===================== */
  async function viewHome(token) {
    const [data, lastBackup] = await Promise.all([DB.exportAll(), DB.getMeta('lastBackupAt')]);
    const active = data.hives.filter((x) => x.active !== false).sort(byHiveName);
    const inactiveCount = data.hives.length - active.length;
    const lastInsp = latestPerHive(data.inspections);
    const lastCount = latestPerHive(data.varroa.filter((v) => v.mites !== null && v.mites !== undefined));
    const totalEntries = data.inspections.length + data.varroa.length;

    let reminder = null;
    const backupAge = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : null;
    if (totalEntries > 0 && (backupAge === null || backupAge >= BACKUP_REMINDER_DAYS)) {
      reminder = h('div', { class: 'alert alert-info' },
        h('strong', {}, backupAge === null ? 'Du har ikke tatt sikkerhetskopi ennå' : `Det er ${backupAge} dager siden siste sikkerhetskopi`),
        h('p', {}, 'Journalen ligger bare på denne telefonen. Ta en sikkerhetskopi jevnlig.'),
        h('a', { class: 'btn btn-secondary btn-small', href: '#/sikkerhetskopi' }, 'Ta sikkerhetskopi'));
    }

    const cards = active.map((hive) => {
      const label = hiveLabel(hive);
      const li = lastInsp.get(hive.id);
      const lc = lastCount.get(hive.id);
      let follow = null;
      if (li && li.followUp) {
        const n = daysFromToday(li.followUp);
        follow = h('span', { class: `badge ${n < 0 ? 'badge-overdue' : n <= 3 ? 'badge-due' : ''}` },
          n < 0 ? '⚠ ' : '', `Oppfølging ${fmtDate(li.followUp)} (${relDays(li.followUp)})`);
      }
      return h('section', { class: 'card hive-card', 'aria-labelledby': `hn-${hive.id}` },
        h('h2', { class: 'hive-name', id: `hn-${hive.id}` }, label),
        h('p', { class: 'meta' }, li
          ? ['Siste inspeksjon: ', h('strong', {}, fmtDate(li.date)), ` (${relDays(li.date)})`]
          : 'Ingen inspeksjoner ennå'),
        lc ? h('p', { class: 'meta' }, `Siste varroatelling: ${varroaRateText(lc)} (${fmtDate(lc.date)})`) : null,
        follow,
        h('a', { class: 'btn btn-honey btn-big', href: `#/kube/${enc(hive.id)}/inspeksjon/ny`, 'aria-label': `Ny inspeksjon, ${label}` }, 'Ny inspeksjon'),
        h('div', { class: 'row' },
          h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hive.id)}`, 'aria-label': `Historikk, ${label}` }, 'Historikk'),
          h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hive.id)}/varroa/ny`, 'aria-label': `Ny varroa-registrering, ${label}` }, '+ Varroa')));
    });

    const empty = h('div', { class: 'card empty' },
      h('h2', {}, data.hives.length ? 'Ingen aktive kuber' : 'Velkommen!'),
      h('p', {}, data.hives.length
        ? 'Alle kubene dine er satt som inaktive. Opprett en ny kube eller aktiver en eksisterende.'
        : 'Start med å opprette kubene dine, for eksempel 1, 3 og 4.'),
      h('a', { class: 'btn btn-honey', href: '#/ny-kube' }, 'Opprett kube'));

    const hero = h('div', { class: 'hero' },
      h('img', { class: 'hero-logo', src: LOGO_SRC, alt: `${BRAND} – Naturligvis`, width: 360, height: 275, decoding: 'async' }));

    mount(token,
      appHeader({ title: 'Bigårdsjournal' }),
      h('main', {},
        hero,
        reminder,
        active.length ? cards : empty,
        h('nav', { class: 'stack', 'aria-label': 'Mer' },
          active.length ? h('a', { class: 'btn btn-secondary', href: '#/ny-kube' }, '+ Ny kube') : null,
          h('a', { class: 'btn btn-secondary', href: '#/kuber' }, inactiveCount ? `Alle kuber (${inactiveCount} inaktive)` : 'Administrer kuber'),
          h('a', { class: 'btn btn-secondary', href: '#/sikkerhetskopi' }, 'Sikkerhetskopi')),
        h('p', { class: 'small', style: 'text-align:center;margin-top:22px' }, `${BRAND} · Bigårdsjournal ${APP_VERSION} · lagres bare på denne enheten`)));
  }

  /* ===================== Administrer kuber ===================== */
  async function viewHives(token) {
    const data = await DB.exportAll();
    const hives = data.hives.slice().sort(byHiveName);
    const counts = new Map();
    data.inspections.concat(data.varroa).forEach((r) => counts.set(r.hiveId, (counts.get(r.hiveId) || 0) + 1));
    const row = (hive) => h('li', { class: 'card' },
      h('h2', { class: 'hive-name', style: 'font-size:1.3rem' }, hiveLabel(hive)),
      h('p', { class: 'meta' }, `${hive.active === false ? 'Inaktiv' : 'Aktiv'} · ${counts.get(hive.id) || 0} registreringer`),
      hive.note ? h('p', { class: 'notes' }, hive.note) : null,
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hive.id)}`, 'aria-label': `Historikk, ${hiveLabel(hive)}` }, 'Historikk'),
        h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hive.id)}/rediger`, 'aria-label': `Rediger, ${hiveLabel(hive)}` }, 'Rediger')));
    const activeList = hives.filter((x) => x.active !== false);
    const inactiveList = hives.filter((x) => x.active === false);
    mount(token,
      appHeader({ title: 'Kuber', back: { href: '#/', label: 'Forside' } }),
      h('main', {},
        h('a', { class: 'btn btn-honey', href: '#/ny-kube' }, '+ Ny kube'),
        h('h2', { class: 'section-title' }, `Aktive kuber (${activeList.length})`),
        activeList.length ? h('ul', { class: 'list-plain' }, activeList.map(row)) : h('p', { class: 'meta' }, 'Ingen aktive kuber.'),
        inactiveList.length ? [h('h2', { class: 'section-title' }, `Inaktive kuber (${inactiveList.length})`), h('ul', { class: 'list-plain' }, inactiveList.map(row))] : null));
  }

  /* ===================== Kube: opprett / rediger ===================== */
  async function viewHiveForm(token, hiveId) {
    const all = await DB.getAll('hives');
    const rec = hiveId ? all.find((x) => x.id === hiveId) : null;
    if (hiveId && !rec) return viewNotFound(token, 'Fant ikke kuben.');
    const isNew = !rec;
    const initial = rec ? { name: rec.name, note: rec.note || '', active: rec.active !== false ? 'aktiv' : 'inaktiv' } : { name: '', note: '', active: 'aktiv' };

    const alertBox = h('div', { hidden: true });
    const draftBanner = h('div', { hidden: true });
    const name = textField({ id: 'hive-name', label: 'Nummer eller navn', hint: 'For eksempel «3» eller «Hagekuben».', attrs: { required: true, autocapitalize: 'sentences', enterkeyhint: 'done' } });
    const note = textArea({ id: 'hive-note', label: 'Notat om kuben (valgfritt)', hint: 'For eksempel plassering, dronningens opprinnelse eller kassetype.', rows: 3 });
    const status = choiceGroup({ id: 'hive-active', legend: 'Status', options: [['aktiv', 'Aktiv'], ['inaktiv', 'Inaktiv']], hint: 'Inaktive kuber vises ikke på forsiden, men historikken beholdes.' });

    const getValues = () => ({ name: name.input.value, note: note.input.value, active: status.get() || 'aktiv' });
    const setValues = (v) => { name.input.value = v.name || ''; note.input.value = v.note || ''; status.set(v.active || 'aktiv'); };
    setValues(initial);

    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, isNew ? 'Lagre kube' : 'Lagre endringer');
    const saveMoreBtn = isNew ? h('button', { type: 'button', class: 'btn btn-secondary' }, 'Lagre og legg til en til') : null;
    const form = h('form', { novalidate: true },
      alertBox, draftBanner, name.el, note.el, isNew ? null : status.el,
      h('div', { class: 'savebar' }, saveBtn, saveMoreBtn ? h('div', { class: 'row' }, saveMoreBtn) : null));

    const state = makeFormState(`kube:${hiveId || 'ny'}`, initial, getValues, setValues);
    let saving = false;

    async function save(addAnother) {
      if (saving) return;
      hideAlert(alertBox);
      name.input.removeAttribute('aria-invalid');
      const v = getValues();
      const trimmed = v.name.trim();
      const errors = [];
      if (!trimmed) errors.push('Skriv inn nummer eller navn på kuben.');
      else if (trimmed.length > 60) errors.push('Navnet kan ikke være lengre enn 60 tegn.');
      const fresh = await DB.getAll('hives').catch(() => all);
      if (trimmed && fresh.some((x) => x.id !== hiveId && x.name.trim().toLowerCase() === trimmed.toLowerCase())) {
        errors.push(`Det finnes allerede en kube med navnet «${trimmed}».`);
      }
      if (errors.length) {
        name.input.setAttribute('aria-invalid', 'true');
        showAlert(alertBox, 'Kuben er ikke lagret', errors);
        return;
      }
      const now = nowISO();
      const obj = Object.assign({}, rec || { id: uuid(), createdAt: now }, {
        name: trimmed, note: v.note.trim(), active: v.active !== 'inaktiv', updatedAt: now
      });
      saving = true;
      saveBtn.disabled = true;
      if (saveMoreBtn) saveMoreBtn.disabled = true;
      try {
        await DB.put('hives', obj);
      } catch (err) {
        saving = false;
        saveBtn.disabled = false;
        if (saveMoreBtn) saveMoreBtn.disabled = false;
        state.saveDraftNow();
        showAlert(alertBox, 'Kuben ble ikke lagret', [describeError(err), 'Det du har skrevet ligger fortsatt i skjemaet. Prøv igjen.']);
        showToast('Lagring feilet – skjemaet er beholdt', 'error');
        return;
      }
      state.clearDraft();
      currentForm = null;
      requestPersistentStorage();
      showToast(`✓ ${hiveLabel(obj)} er ${isNew ? 'opprettet' : 'lagret'}`);
      if (addAnother) {
        if (location.hash === '#/ny-kube') render(); else location.replace('#/ny-kube');
      } else {
        location.replace(isNew ? '#/' : `#/kube/${enc(obj.id)}`);
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
    if (saveMoreBtn) saveMoreBtn.addEventListener('click', () => save(true));

    let danger = null;
    if (!isNew) {
      danger = h('div', { class: 'danger-zone' },
        h('h2', {}, 'Slett kube'),
        h('p', { class: 'meta' }, 'Vil du bare slutte å se kuben på forsiden, velg «Inaktiv» over i stedet.'),
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: async () => {
            const [ins, va] = await Promise.all([DB.byHive('inspections', rec.id), DB.byHive('varroa', rec.id)]);
            const ok = await confirmDialog({
              title: `Slette ${hiveLabel(rec)}?`,
              message: [`Kuben og ${ins.length} inspeksjoner og ${va.length} varroa-registreringer slettes for godt.`, 'Dette kan ikke angres.'],
              confirmText: 'Slett kuben', cancelText: 'Avbryt', danger: true
            });
            if (!ok) return;
            try {
              await DB.deleteHive(rec.id);
              state.clearDraft();
              currentForm = null;
              showToast(`${hiveLabel(rec)} er slettet`);
              location.replace('#/');
            } catch (err) {
              showAlert(alertBox, 'Kuben ble ikke slettet', [describeError(err)]);
            }
          }
        }, 'Slett kube og all historikk'));
    }

    if (!mount(token,
      appHeader({ title: isNew ? 'Ny kube' : `Rediger ${hiveLabel(rec)}`, back: isNew ? { href: '#/', label: 'Forside' } : { href: `#/kube/${enc(rec.id)}`, label: 'Historikk' } }),
      h('main', {}, form, danger))) return;
    attachDraft(state, form, draftBanner, setValues, initial);
    if (isNew && !name.input.value) name.input.focus();
  }

  /* ===================== Kubehistorikk ===================== */
  function inspectionFacts(r) {
    const facts = [];
    INSPECTION_FIELDS.forEach(([key, label]) => {
      if (!r[key]) return;
      const warn = (WARN_VALUES[key] || []).includes(r[key]);
      facts.push(h('li', { class: warn ? 'warn' : null }, warn ? '⚠ ' : '', `${label}: ${optLabel(key, r[key]).toLowerCase()}`));
    });
    return facts;
  }

  function treatmentText(v) {
    const method = v.method ? (v.method === 'annet' && v.methodOther ? v.methodOther : optLabel('method', v.method)) : 'Behandling';
    return v.treatmentDate ? `${method}, ${fmtShort.format(parseISODate(v.treatmentDate))}` : method;
  }
  const hasTreatment = (v) => !!(v && (v.method || v.treatmentDate));
  function varroaRateText(v) {
    if (v.mites === null || v.mites === undefined) return '';
    if (v.days) return `${v.mites} midd på ${fmtNum(v.days)} døgn (${fmtRate.format(v.mites / v.days)} per døgn)`;
    return `${v.mites} midd`;
  }

  function varroaFacts(v, allVarroa) {
    const facts = [];
    if (hasTreatment(v)) facts.push(h('li', {}, `Behandling: ${treatmentText(v)}`));
    if (v.mites !== null && v.mites !== undefined) {
      facts.push(h('li', {}, `Telling: ${varroaRateText(v)}`));
      if (v.linkedTreatmentId) {
        const t = v.linkedTreatmentId === v.id ? v : allVarroa.find((x) => x.id === v.linkedTreatmentId);
        facts.push(h('li', {}, t && hasTreatment(t)
          ? (t === v ? 'Knyttet til behandlingen i denne registreringen' : `Etter behandling: ${treatmentText(t)}`)
          : 'Tilknyttet behandling finnes ikke lenger'));
      } else {
        facts.push(h('li', {}, 'Uten tilknyttet behandling (naturlig nedfall)'));
      }
    }
    return facts;
  }

  async function viewHive(token, hiveId) {
    const hive = await DB.get('hives', hiveId);
    if (!hive) return viewNotFound(token, 'Fant ikke kuben. Den kan være slettet.');
    const [ins, va] = await Promise.all([DB.byHive('inspections', hiveId), DB.byHive('varroa', hiveId)]);
    const entries = ins.map((r) => ({ type: 'insp', r })).concat(va.map((r) => ({ type: 'varroa', r })))
      .sort((a, b) => newestFirst(a.r, b.r));
    const label = hiveLabel(hive);
    const list = h('ol', { class: 'list-plain', 'aria-label': 'Registreringer, nyeste først' });
    const justSaved = flashId;
    flashId = null;

    function entryCard({ type, r }) {
      const isInsp = type === 'insp';
      const href = `#/kube/${enc(hiveId)}/${isInsp ? 'inspeksjon' : 'varroa'}/${enc(r.id)}`;
      const facts = isInsp ? inspectionFacts(r) : varroaFacts(r, va);
      const actions = isInsp && r.actions && r.actions.length ? h('p', { class: 'meta' }, h('strong', {}, 'Tiltak: '), r.actions.map((a) => optLabel('actions', a)).join(', ')) : null;
      let follow = null;
      if (isInsp && r.followUp) {
        const n = daysFromToday(r.followUp);
        follow = h('span', { class: `badge ${n < 0 ? 'badge-overdue' : n <= 3 ? 'badge-due' : ''}` }, `Oppfølging ${fmtDate(r.followUp)} (${relDays(r.followUp)})`);
      }
      const notes = r.notes ? h('p', { class: 'notes' }, r.notes.length > 220 ? r.notes.slice(0, 220).trimEnd() + ' …' : r.notes) : null;
      const empty = !facts.length && !actions && !notes && !follow ? h('p', { class: 'meta' }, 'Kort registrering uten flere detaljer.') : null;
      const card = h('a', {
        class: `card entry${r.id === justSaved ? ' flash' : ''}`,
        href,
        id: `e-${r.id}`,
        'aria-label': `${isInsp ? 'Inspeksjon' : 'Varroa'} ${fmtDate(r.date)}. Åpne og rediger.`
      },
      h('span', { class: `tag ${isInsp ? '' : 'tag-varroa'}` }, isInsp ? 'Inspeksjon' : 'Varroa'),
      r.id === justSaved ? h('span', { class: 'tag saved-badge' }, '✓ Lagret nå') : null,
      h('div', { class: 'entry-head' },
        h('span', { class: 'entry-date' }, fmtDate(r.date)),
        h('span', { class: 'entry-rel' }, relDays(r.date))),
      facts.length ? h('ul', { class: 'facts' }, facts) : null,
      actions, notes, follow, empty,
      h('p', { class: 'entry-open', 'aria-hidden': 'true' }, 'Åpne / rediger ›'));
      return h('li', {}, card);
    }

    function renderList() {
      const shown = entries.filter((e) => historyFilter === 'alle' || (historyFilter === 'inspeksjoner' ? e.type === 'insp' : e.type === 'varroa'));
      list.replaceChildren(...(shown.length
        ? shown.map(entryCard)
        : [h('li', { class: 'card empty' }, h('p', {}, entries.length ? 'Ingen registreringer av denne typen.' : 'Ingen registreringer ennå.'))]));
    }

    const filter = choiceGroup({
      id: 'history-filter',
      legend: `Historikk (${entries.length})`,
      options: [['alle', 'Alle'], ['inspeksjoner', `Inspeksjoner (${ins.length})`], ['varroa', `Varroa (${va.length})`]],
      onChange: () => { historyFilter = filter.get() || 'alle'; filter.set(historyFilter); renderList(); }
    });
    filter.el.classList.add('filter');
    filter.set(historyFilter);
    renderList();

    const mounted = mount(token,
      appHeader({
        title: label,
        back: { href: '#/', label: 'Kuber' },
        right: h('a', { class: 'header-link', href: `#/kube/${enc(hiveId)}/rediger` }, 'Rediger')
      }),
      h('main', {},
        hive.active === false ? h('div', { class: 'alert alert-info' }, h('strong', {}, 'Denne kuben er inaktiv.'), h('p', {}, 'Den vises ikke på forsiden. Endre status under «Rediger».')) : null,
        h('a', { class: 'btn btn-honey btn-big', href: `#/kube/${enc(hiveId)}/inspeksjon/ny` }, 'Ny inspeksjon'),
        h('div', { class: 'row' }, h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hiveId)}/varroa/ny` }, 'Ny varroa-registrering')),
        filter.el,
        list));
    if (mounted && justSaved) {
      const el = document.getElementById(`e-${justSaved}`);
      if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    }
  }

  /* ===================== Inspeksjonsskjema ===================== */
  async function viewInspectionForm(token, hiveId, inspId) {
    const hive = await DB.get('hives', hiveId);
    if (!hive) return viewNotFound(token, 'Fant ikke kuben.');
    const rec = inspId ? await DB.get('inspections', inspId) : null;
    if (inspId && (!rec || rec.hiveId !== hiveId)) return viewNotFound(token, 'Fant ikke inspeksjonen. Den kan være slettet.');
    const isNew = !rec;
    const label = hiveLabel(hive);

    const blank = { date: todayISO(), queen: null, eggs: null, brood: null, strength: null, feed: null, swarm: null, actions: [], notes: '', followUp: '' };
    const initial = rec ? {
      date: rec.date, queen: rec.queen || null, eggs: rec.eggs || null, brood: rec.brood || null, strength: rec.strength || null,
      feed: rec.feed || null, swarm: rec.swarm || null, actions: (rec.actions || []).slice(), notes: rec.notes || '', followUp: rec.followUp || ''
    } : blank;

    const alertBox = h('div', { hidden: true });
    const draftBanner = h('div', { hidden: true });
    const date = textField({ id: 'insp-date', label: 'Dato', type: 'date', attrs: { required: true } });
    const groups = {
      queen: choiceGroup({ id: 'f-queen', legend: 'Dronning', options: OPT.queen }),
      eggs: choiceGroup({ id: 'f-eggs', legend: 'Egg', options: OPT.eggs }),
      brood: choiceGroup({ id: 'f-brood', legend: 'Yngel', options: OPT.brood }),
      strength: choiceGroup({ id: 'f-strength', legend: 'Bistyrke', options: OPT.strength }),
      feed: choiceGroup({ id: 'f-feed', legend: 'Fôrstatus', options: OPT.feed }),
      swarm: choiceGroup({ id: 'f-swarm', legend: 'Svermetegn', options: OPT.swarm }),
      actions: choiceGroup({ id: 'f-actions', legend: 'Tiltak', options: OPT.actions, multi: true, hint: 'Velg alt som passer. Beskriv andre tiltak i notatet.' })
    };
    const notes = textArea({ id: 'insp-notes', label: 'Notater', rows: 4 });
    const followUp = textField({ id: 'insp-follow', label: 'Oppfølging (valgfritt)', type: 'date', hint: 'Dato for neste kontroll eller noe du må huske.' });
    const quick = h('div', { class: 'quick' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { followUp.input.value = addDays(date.input.value, 7); state.schedule(); } }, 'Om 1 uke'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { followUp.input.value = addDays(date.input.value, 14); state.schedule(); } }, 'Om 2 uker'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { followUp.input.value = ''; state.schedule(); } }, 'Fjern dato'));
    followUp.el.append(quick);

    const getValues = () => ({
      date: date.input.value,
      queen: groups.queen.get(), eggs: groups.eggs.get(), brood: groups.brood.get(),
      strength: groups.strength.get(), feed: groups.feed.get(), swarm: groups.swarm.get(),
      actions: groups.actions.get(), notes: notes.input.value, followUp: followUp.input.value
    });
    const setValues = (v) => {
      date.input.value = v.date || '';
      ['queen', 'eggs', 'brood', 'strength', 'feed', 'swarm', 'actions'].forEach((k) => groups[k].set(v[k]));
      notes.input.value = v.notes || '';
      followUp.input.value = v.followUp || '';
    };
    setValues(initial);

    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, isNew ? 'Lagre inspeksjon' : 'Lagre endringer');
    const cancelBtn = h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hiveId)}` }, 'Avbryt');
    const form = h('form', { novalidate: true, 'aria-label': `Inspeksjon for ${label}` },
      alertBox, draftBanner,
      h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Bare dato er påkrevd. Trykk på et valgt alternativ igjen for å fjerne det.'),
      date.el,
      groups.queen.el, groups.eggs.el, groups.brood.el, groups.strength.el, groups.feed.el, groups.swarm.el,
      groups.actions.el, notes.el, followUp.el,
      h('div', { class: 'savebar' }, saveBtn, h('div', { class: 'row' }, cancelBtn)));

    const state = makeFormState(`inspeksjon:${hiveId}:${inspId || 'ny'}`, initial, getValues, setValues);
    let saving = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      hideAlert(alertBox);
      date.input.removeAttribute('aria-invalid');
      followUp.input.removeAttribute('aria-invalid');
      const v = getValues();
      const errors = [];
      if (!isValidISODate(v.date)) { errors.push('Velg en gyldig dato for inspeksjonen.'); date.input.setAttribute('aria-invalid', 'true'); }
      if (v.followUp && !isValidISODate(v.followUp)) { errors.push('Oppfølgingsdatoen er ugyldig.'); followUp.input.setAttribute('aria-invalid', 'true'); }
      else if (v.followUp && isValidISODate(v.date) && v.followUp < v.date) { errors.push('Oppfølgingsdatoen kan ikke være før inspeksjonsdatoen.'); followUp.input.setAttribute('aria-invalid', 'true'); }
      if (errors.length) { showAlert(alertBox, 'Inspeksjonen er ikke lagret ennå', errors); return; }

      const now = nowISO();
      const obj = Object.assign({}, rec || { id: uuid(), hiveId, createdAt: now }, {
        date: v.date, queen: v.queen, eggs: v.eggs, brood: v.brood, strength: v.strength, feed: v.feed, swarm: v.swarm,
        actions: v.actions, notes: v.notes.trim(), followUp: v.followUp || null, updatedAt: now
      });
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Lagrer …';
      try {
        await DB.put('inspections', obj);
      } catch (err) {
        console.error(err);
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? 'Lagre inspeksjon' : 'Lagre endringer';
        state.saveDraftNow();
        showAlert(alertBox, 'Inspeksjonen ble IKKE lagret', [describeError(err), 'Det du har registrert ligger fortsatt i skjemaet. Trykk «Lagre» for å prøve igjen.']);
        showToast('Lagring feilet – skjemaet er beholdt', 'error');
        return;
      }
      state.clearDraft();
      currentForm = null;
      flashId = obj.id;
      requestPersistentStorage();
      showToast(isNew ? `✓ Inspeksjon lagret for ${label}` : `✓ Endringer lagret for ${label}`);
      location.replace(`#/kube/${enc(hiveId)}`);
    });

    let danger = null;
    if (!isNew) {
      danger = h('div', { class: 'danger-zone' },
        h('p', { class: 'meta' }, `Opprettet ${fmtTimestamp(rec.createdAt)}${rec.updatedAt && rec.updatedAt !== rec.createdAt ? ` · sist endret ${fmtTimestamp(rec.updatedAt)}` : ''}`),
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Slette inspeksjonen?', message: `Inspeksjonen ${fmtDate(rec.date)} for ${label} slettes for godt.`, confirmText: 'Slett inspeksjonen', danger: true });
            if (!ok) return;
            try {
              await DB.delete('inspections', rec.id);
              state.clearDraft();
              currentForm = null;
              showToast('Inspeksjonen er slettet');
              location.replace(`#/kube/${enc(hiveId)}`);
            } catch (err) { showAlert(alertBox, 'Inspeksjonen ble ikke slettet', [describeError(err)]); }
          }
        }, 'Slett inspeksjonen'));
    }

    if (!mount(token,
      appHeader({ title: `${isNew ? 'Ny inspeksjon' : 'Inspeksjon'} · ${label}`, back: { href: `#/kube/${enc(hiveId)}`, label: 'Historikk' } }),
      h('main', {}, form, danger))) return;
    attachDraft(state, form, draftBanner, setValues, initial);
  }

  /* ===================== Varroaskjema ===================== */
  async function viewVarroaForm(token, hiveId, varroaId) {
    const hive = await DB.get('hives', hiveId);
    if (!hive) return viewNotFound(token, 'Fant ikke kuben.');
    const all = await DB.byHive('varroa', hiveId);
    const rec = varroaId ? all.find((x) => x.id === varroaId) : null;
    if (varroaId && !rec) return viewNotFound(token, 'Fant ikke varroa-registreringen. Den kan være slettet.');
    const isNew = !rec;
    const label = hiveLabel(hive);
    const otherTreatments = all.filter((x) => hasTreatment(x) && (!rec || x.id !== rec.id)).sort(newestFirst);

    const blank = { date: todayISO(), treatmentDate: '', method: null, methodOther: '', mites: '', days: '', link: '', notes: '' };
    const initial = rec ? {
      date: rec.date, treatmentDate: rec.treatmentDate || '', method: rec.method || null, methodOther: rec.methodOther || '',
      mites: rec.mites === null || rec.mites === undefined ? '' : String(rec.mites),
      days: rec.days === null || rec.days === undefined ? '' : fmtNum(rec.days),
      link: rec.linkedTreatmentId ? (rec.linkedTreatmentId === rec.id ? 'self' : rec.linkedTreatmentId) : '',
      notes: rec.notes || ''
    } : blank;

    const alertBox = h('div', { hidden: true });
    const draftBanner = h('div', { hidden: true });
    const date = textField({ id: 'v-date', label: 'Dato', type: 'date', hint: 'Dagen du registrerer, for eksempel da du tok ut bunnbrettet.', attrs: { required: true } });

    const treatmentDate = textField({ id: 'v-tdate', label: 'Behandlingsdato', type: 'date' });
    const methodOther = textField({ id: 'v-mother', label: 'Beskriv metoden', attrs: { maxlength: 80 } });
    const method = choiceGroup({
      id: 'v-method', legend: 'Behandlingsmetode', options: OPT.method,
      onChange: () => {
        if (method.get() && !treatmentDate.input.value) treatmentDate.input.value = date.input.value;
        syncDynamic();
      }
    });

    const mites = textField({ id: 'v-mites', label: 'Antall midd på bunnbrettet', attrs: { inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'next' } });
    const days = textField({ id: 'v-days', label: 'Døgn brettet lå inne', attrs: { inputmode: 'decimal', enterkeyhint: 'done' } });
    const quickDays = h('div', { class: 'quick' }, [1, 2, 3, 7].map((n) => h('button', {
      type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': `${n} døgn`,
      onclick: () => { days.input.value = String(n); syncDynamic(); state.schedule(); }
    }, `${n} d`)));
    days.el.append(quickDays);
    const calc = h('p', { class: 'calc', 'aria-live': 'polite' });

    const linkSelect = h('select', { id: 'v-link', name: 'v-link' });
    const linkField = h('div', { class: 'field' },
      h('label', { class: 'label', for: 'v-link' }, 'Tilknyttet behandling'),
      h('p', { class: 'hint', id: 'v-link-hint' }, 'Velg «Ingen» for naturlig nedfall, eller knytt tellingen til en behandling.'),
      linkSelect);
    linkSelect.setAttribute('aria-describedby', 'v-link-hint');
    const notes = textArea({ id: 'v-notes', label: 'Notat', rows: 3 });

    function rebuildLinkOptions(selected) {
      const opts = [['', 'Ingen – naturlig nedfall']];
      if (method.get() || treatmentDate.input.value) opts.push(['self', 'Behandlingen i denne registreringen']);
      otherTreatments.forEach((t) => opts.push([t.id, `Etter: ${treatmentText(t)}`]));
      // Bevar en kobling til en behandling som ikke lenger finnes, slik at den ikke forsvinner stille
      if (selected && !opts.some((o) => o[0] === selected)) opts.push([selected, 'Behandling som ikke finnes lenger']);
      linkSelect.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
      linkSelect.value = opts.some((o) => o[0] === selected) ? selected : '';
    }
    function syncDynamic() {
      methodOther.el.hidden = method.get() !== 'annet';
      rebuildLinkOptions(linkSelect.value);
      const m = parseCount(mites.input.value);
      const d = parseDays(days.input.value);
      if (m.value !== undefined && d.value !== undefined) calc.textContent = `≈ ${fmtRate.format(m.value / d.value)} midd per døgn`;
      else if (m.value !== undefined) calc.textContent = 'Fyll inn antall døgn for å se midd per døgn.';
      else calc.textContent = '';
    }

    const getValues = () => ({
      date: date.input.value, treatmentDate: treatmentDate.input.value, method: method.get(), methodOther: methodOther.input.value,
      mites: mites.input.value, days: days.input.value, link: linkSelect.value, notes: notes.input.value
    });
    const setValues = (v) => {
      date.input.value = v.date || '';
      treatmentDate.input.value = v.treatmentDate || '';
      method.set(v.method);
      methodOther.input.value = v.methodOther || '';
      mites.input.value = v.mites || '';
      days.input.value = v.days || '';
      rebuildLinkOptions(v.link || '');
      notes.input.value = v.notes || '';
      syncDynamic();
    };
    setValues(initial);
    [mites.input, days.input, treatmentDate.input].forEach((i) => i.addEventListener('input', syncDynamic));

    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, isNew ? 'Lagre varroa-registrering' : 'Lagre endringer');
    const form = h('form', { novalidate: true, 'aria-label': `Varroa for ${label}` },
      alertBox, draftBanner,
      date.el,
      h('section', { class: 'form-section', 'aria-labelledby': 'sec-treat' },
        h('h2', { id: 'sec-treat' }, 'Behandling'),
        h('p', { class: 'hint' }, 'Fyll ut hvis kuben ble behandlet. Hopp over ved ren telling.'),
        method.el, methodOther.el, treatmentDate.el),
      h('section', { class: 'form-section', 'aria-labelledby': 'sec-count' },
        h('h2', { id: 'sec-count' }, 'Telling på bunnbrett'),
        h('p', { class: 'hint' }, 'Fyll ut hvis du har telt midd.'),
        mites.el, days.el, calc, linkField),
      notes.el,
      h('div', { class: 'savebar' }, saveBtn, h('div', { class: 'row' }, h('a', { class: 'btn btn-secondary', href: `#/kube/${enc(hiveId)}` }, 'Avbryt'))));

    const state = makeFormState(`varroa:${hiveId}:${varroaId || 'ny'}`, initial, getValues, setValues);
    let saving = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      hideAlert(alertBox);
      [date.input, treatmentDate.input, mites.input, days.input].forEach((i) => i.removeAttribute('aria-invalid'));
      const v = getValues();
      const errors = [];
      const m = parseCount(v.mites);
      const d = parseDays(v.days);
      if (!isValidISODate(v.date)) { errors.push('Velg en gyldig dato.'); date.input.setAttribute('aria-invalid', 'true'); }
      if (v.treatmentDate && !isValidISODate(v.treatmentDate)) { errors.push('Behandlingsdatoen er ugyldig.'); treatmentDate.input.setAttribute('aria-invalid', 'true'); }
      if (m.error) { errors.push('Antall midd må være et helt tall (0 eller mer).'); mites.input.setAttribute('aria-invalid', 'true'); }
      if (d.error) { errors.push('Antall døgn må være et tall større enn 0, for eksempel 3.'); days.input.setAttribute('aria-invalid', 'true'); }
      if (!m.error && !d.error && m.empty && !d.empty) { errors.push('Du har fylt inn døgn, men ikke antall midd.'); mites.input.setAttribute('aria-invalid', 'true'); }
      const treated = !!(v.method || v.treatmentDate);
      if (!treated && m.empty && !v.notes.trim() && !errors.length) errors.push('Fyll inn en behandling, en telling eller et notat før du lagrer.');
      if (errors.length) { showAlert(alertBox, 'Registreringen er ikke lagret ennå', errors); return; }

      const now = nowISO();
      const id = rec ? rec.id : uuid();
      let linked = null;
      if (!m.empty) {
        if (v.link === 'self') linked = treated ? id : null;
        else if (v.link) linked = v.link;
      }
      const obj = Object.assign({}, rec || { id, hiveId, createdAt: now }, {
        date: v.date,
        treatmentDate: v.treatmentDate || null,
        method: v.method || null,
        methodOther: v.method === 'annet' ? v.methodOther.trim() : '',
        mites: m.empty ? null : m.value,
        days: d.empty ? null : d.value,
        linkedTreatmentId: linked,
        notes: v.notes.trim(),
        updatedAt: now
      });
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Lagrer …';
      try {
        await DB.put('varroa', obj);
      } catch (err) {
        console.error(err);
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? 'Lagre varroa-registrering' : 'Lagre endringer';
        state.saveDraftNow();
        showAlert(alertBox, 'Registreringen ble IKKE lagret', [describeError(err), 'Det du har registrert ligger fortsatt i skjemaet. Trykk «Lagre» for å prøve igjen.']);
        showToast('Lagring feilet – skjemaet er beholdt', 'error');
        return;
      }
      state.clearDraft();
      currentForm = null;
      flashId = obj.id;
      requestPersistentStorage();
      showToast(`✓ Varroa-registrering lagret for ${label}`);
      location.replace(`#/kube/${enc(hiveId)}`);
    });

    let danger = null;
    if (!isNew) {
      const dependents = all.filter((x) => x.linkedTreatmentId === rec.id && x.id !== rec.id).length;
      danger = h('div', { class: 'danger-zone' },
        h('p', { class: 'meta' }, `Opprettet ${fmtTimestamp(rec.createdAt)}${rec.updatedAt && rec.updatedAt !== rec.createdAt ? ` · sist endret ${fmtTimestamp(rec.updatedAt)}` : ''}`),
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: async () => {
            const msg = [`Registreringen ${fmtDate(rec.date)} for ${label} slettes for godt.`];
            if (dependents) msg.push(`${dependents} telling(er) er knyttet til denne behandlingen. De beholdes, men mister koblingen.`);
            const ok = await confirmDialog({ title: 'Slette varroa-registreringen?', message: msg, confirmText: 'Slett registreringen', danger: true });
            if (!ok) return;
            try {
              await DB.deleteVarroa(rec.id);
              state.clearDraft();
              currentForm = null;
              showToast('Varroa-registreringen er slettet');
              location.replace(`#/kube/${enc(hiveId)}`);
            } catch (err) { showAlert(alertBox, 'Registreringen ble ikke slettet', [describeError(err)]); }
          }
        }, 'Slett registreringen'));
    }

    if (!mount(token,
      appHeader({ title: `${isNew ? 'Ny varroa' : 'Varroa'} · ${label}`, back: { href: `#/kube/${enc(hiveId)}`, label: 'Historikk' } }),
      h('main', {}, form, danger))) return;
    attachDraft(state, form, draftBanner, setValues, initial);
    syncDynamic();
  }

  /* ===================== Sikkerhetskopi ===================== */
  function buildBackup(data) {
    return {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: nowISO(),
      counts: { hives: data.hives.length, inspections: data.inspections.length, varroa: data.varroa.length },
      data
    };
  }

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const isId = (x) => typeof x === 'string' && x.length > 0 && x.length <= 100;
  const optOrNull = (group, v) => v === null || v === undefined || v === '' || OPT_MAP[group][v] !== undefined;
  const tsOr = (v, fallback) => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : fallback);

  /* Kontrollerer en sikkerhetskopi og returnerer rensede data. Ingenting skrives før alt er godkjent. */
  function validateBackup(obj) {
    const errors = [];
    const warnings = [];
    const err = (m) => { if (errors.length < 25) errors.push(m); };
    if (!isObj(obj)) return { errors: ['Filen inneholder ikke en sikkerhetskopi fra Bigårdsjournal.'] };
    if (obj.format !== BACKUP_FORMAT) err('Filen er ikke en sikkerhetskopi fra Bigårdsjournal (feltet «format» mangler eller er feil).');
    if (!Number.isInteger(obj.schemaVersion)) err('Filen mangler versjonsnummer («schemaVersion»).');
    else if (obj.schemaVersion > SCHEMA_VERSION) err(`Filen er laget av en nyere versjon av appen (versjon ${obj.schemaVersion}). Oppdater appen før du gjenoppretter.`);
    const d = obj.data;
    if (!isObj(d) || !Array.isArray(d.hives) || !Array.isArray(d.inspections) || !Array.isArray(d.varroa)) {
      err('Filen mangler datadelen med kuber, inspeksjoner og varroa-registreringer.');
    }
    if (errors.length) return { errors };

    const now = nowISO();
    const hiveIds = new Set();
    const hiveNames = new Set();
    const hives = [];
    d.hives.forEach((x, i) => {
      const where = `Kube nr. ${i + 1} i filen`;
      if (!isObj(x)) return err(`${where} har feil format.`);
      if (!isId(x.id)) return err(`${where} mangler gyldig id.`);
      if (hiveIds.has(x.id)) return err(`${where} har en id som finnes flere ganger.`);
      if (typeof x.name !== 'string' || !x.name.trim()) return err(`${where} mangler navn.`);
      if (x.active !== undefined && typeof x.active !== 'boolean') return err(`${where} har ugyldig status.`);
      const key = x.name.trim().toLowerCase();
      if (hiveNames.has(key)) warnings.push(`Navnet «${x.name.trim()}» brukes av flere kuber.`);
      hiveNames.add(key);
      hiveIds.add(x.id);
      hives.push({
        id: x.id, name: x.name.trim().slice(0, 60), note: typeof x.note === 'string' ? x.note : '',
        active: x.active !== false, createdAt: tsOr(x.createdAt, now), updatedAt: tsOr(x.updatedAt, now)
      });
    });

    const recIds = new Set();
    const inspections = [];
    d.inspections.forEach((x, i) => {
      const where = `Inspeksjon nr. ${i + 1} i filen`;
      if (!isObj(x)) return err(`${where} har feil format.`);
      if (!isId(x.id) || recIds.has(x.id)) return err(`${where} mangler gyldig, unik id.`);
      if (!hiveIds.has(x.hiveId)) return err(`${where} hører til en kube som ikke finnes i filen.`);
      if (!isValidISODate(x.date)) return err(`${where} har ugyldig dato.`);
      for (const [key] of INSPECTION_FIELDS) {
        if (!optOrNull(key, x[key])) return err(`${where} har ukjent verdi i feltet «${key}».`);
      }
      if (x.actions !== undefined && (!Array.isArray(x.actions) || x.actions.some((a) => OPT_MAP.actions[a] === undefined))) return err(`${where} har ukjente tiltak.`);
      if (x.notes !== undefined && x.notes !== null && typeof x.notes !== 'string') return err(`${where} har ugyldig notat.`);
      if (x.followUp && !isValidISODate(x.followUp)) return err(`${where} har ugyldig oppfølgingsdato.`);
      recIds.add(x.id);
      const clean = { id: x.id, hiveId: x.hiveId, date: x.date };
      INSPECTION_FIELDS.forEach(([key]) => { clean[key] = x[key] || null; });
      Object.assign(clean, {
        actions: Array.isArray(x.actions) ? x.actions.slice() : [], notes: x.notes || '', followUp: x.followUp || null,
        createdAt: tsOr(x.createdAt, now), updatedAt: tsOr(x.updatedAt, now)
      });
      inspections.push(clean);
    });

    const varroa = [];
    const varroaIds = new Set(d.varroa.filter(isObj).map((x) => x.id));
    d.varroa.forEach((x, i) => {
      const where = `Varroa-registrering nr. ${i + 1} i filen`;
      if (!isObj(x)) return err(`${where} har feil format.`);
      if (!isId(x.id) || recIds.has(x.id)) return err(`${where} mangler gyldig, unik id.`);
      if (!hiveIds.has(x.hiveId)) return err(`${where} hører til en kube som ikke finnes i filen.`);
      if (!isValidISODate(x.date)) return err(`${where} har ugyldig dato.`);
      if (x.treatmentDate && !isValidISODate(x.treatmentDate)) return err(`${where} har ugyldig behandlingsdato.`);
      if (!optOrNull('method', x.method)) return err(`${where} har ukjent behandlingsmetode.`);
      if (x.mites !== null && x.mites !== undefined && !(Number.isInteger(x.mites) && x.mites >= 0)) return err(`${where} har ugyldig antall midd.`);
      if (x.days !== null && x.days !== undefined && !(typeof x.days === 'number' && x.days > 0 && x.days <= 365)) return err(`${where} har ugyldig antall døgn.`);
      let linked = x.linkedTreatmentId || null;
      if (linked && !varroaIds.has(linked)) {
        warnings.push(`${where} pekte på en behandling som ikke finnes i filen. Koblingen fjernes.`);
        linked = null;
      }
      recIds.add(x.id);
      varroa.push({
        id: x.id, hiveId: x.hiveId, date: x.date, treatmentDate: x.treatmentDate || null, method: x.method || null,
        methodOther: typeof x.methodOther === 'string' ? x.methodOther : '',
        mites: x.mites === undefined ? null : x.mites, days: x.days === undefined ? null : x.days,
        linkedTreatmentId: linked, notes: typeof x.notes === 'string' ? x.notes : '',
        createdAt: tsOr(x.createdAt, now), updatedAt: tsOr(x.updatedAt, now)
      });
    });

    if (isObj(obj.counts)) {
      const c = obj.counts;
      if (c.hives !== d.hives.length || c.inspections !== d.inspections.length || c.varroa !== d.varroa.length) {
        err('Antall registreringer i filen stemmer ikke med oppsummeringen i filen. Filen kan være skadet eller ufullstendig.');
      }
    }
    if (errors.length) return { errors };
    return { errors: [], warnings, data: { hives, inspections, varroa }, exportedAt: obj.exportedAt, appVersion: obj.appVersion };
  }

  async function viewBackup(token) {
    const [data, lastBackup] = await Promise.all([DB.exportAll(), DB.getMeta('lastBackupAt')]);
    const total = data.hives.length + data.inspections.length + data.varroa.length;
    // Filen bygges på forhånd slik at deling kan starte direkte i trykket (krav i Safari).
    const json = JSON.stringify(buildBackup(data), null, 2);
    const filename = `bigardsjournal-sikkerhetskopi-${todayISO()}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    let file = null;
    try { file = new File([blob], filename, { type: 'application/json' }); } catch (_) { file = null; }
    const canShare = !!(file && navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [file] }); } catch (_) { return false; } })());

    const exportStatus = h('div', { hidden: true });
    async function markBackedUp() {
      try { await DB.setMeta('lastBackupAt', nowISO()); } catch (_) { /* ikke kritisk */ }
    }
    function download() {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename, style: 'display:none' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      markBackedUp();
      exportStatus.className = 'alert alert-ok';
      exportStatus.setAttribute('role', 'status');
      exportStatus.replaceChildren(h('strong', {}, '✓ Sikkerhetskopien er lastet ned'), h('p', {}, `Filnavn: ${filename}. På iPhone havner den vanligvis i Filer → Nedlastinger.`));
      exportStatus.hidden = false;
    }
    async function share() {
      try {
        await navigator.share({ files: [file], title: 'Bigårdsjournal – sikkerhetskopi' });
        markBackedUp();
        exportStatus.className = 'alert alert-ok';
        exportStatus.setAttribute('role', 'status');
        exportStatus.replaceChildren(h('strong', {}, '✓ Sikkerhetskopien er delt'), h('p', {}, `Filnavn: ${filename}. Kontroller at den ligger der du valgte å lagre den.`));
        exportStatus.hidden = false;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // brukeren avbrøt
        download();
      }
    }

    const importArea = h('div', {});
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', id: 'import-file', 'aria-label': 'Velg sikkerhetskopifil' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      importArea.replaceChildren(h('p', { class: 'meta' }, 'Kontrollerer filen …'));
      let result;
      try {
        if (f.size > MAX_IMPORT_BYTES) throw new Error('Filen er for stor til å være en sikkerhetskopi fra Bigårdsjournal.');
        const text = await f.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { throw new Error('Filen er ikke gyldig JSON. Velg filen du eksporterte fra Bigårdsjournal.'); }
        result = validateBackup(parsed);
      } catch (e2) {
        result = { errors: [e2.message] };
      }
      if (result.errors.length) {
        const box = h('div', {});
        importArea.replaceChildren(box);
        showAlert(box, `Filen «${f.name}» kan ikke gjenopprettes`, result.errors.concat('Ingen data er endret.'));
        return;
      }
      const c = result.data;
      const restoreBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big' }, 'Gjenopprett fra denne filen');
      importArea.replaceChildren(h('div', { class: 'alert alert-ok', role: 'status' },
        h('strong', {}, `✓ Filen «${f.name}» er kontrollert`),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Eksportert'), h('dd', {}, result.exportedAt ? fmtTimestamp(result.exportedAt) || 'ukjent' : 'ukjent'),
          h('dt', {}, 'Kuber'), h('dd', {}, String(c.hives.length)),
          h('dt', {}, 'Inspeksjoner'), h('dd', {}, String(c.inspections.length)),
          h('dt', {}, 'Varroa'), h('dd', {}, String(c.varroa.length))),
        result.warnings.length ? h('ul', {}, result.warnings.slice(0, 10).map((w) => h('li', {}, w))) : null),
      restoreBtn);
      restoreBtn.addEventListener('click', async () => {
        const current = await DB.exportAll();
        const curTotal = current.hives.length + current.inspections.length + current.varroa.length;
        if (curTotal > 0) {
          const ok = await confirmDialog({
            title: 'Erstatte all eksisterende data?',
            message: [
              `Journalen på denne enheten (${current.hives.length} kuber, ${current.inspections.length} inspeksjoner, ${current.varroa.length} varroa-registreringer) blir slettet og erstattet med innholdet i filen.`,
              'Dette kan ikke angres. Ta gjerne en sikkerhetskopi av dagens data først.'
            ],
            confirmText: 'Ja, erstatt dataene', cancelText: 'Avbryt', danger: true
          });
          if (!ok) { showToast('Gjenoppretting avbrutt – ingen data er endret'); return; }
        }
        restoreBtn.disabled = true;
        restoreBtn.textContent = 'Gjenoppretter …';
        try {
          await DB.replaceAll(c);
        } catch (err) {
          restoreBtn.disabled = false;
          restoreBtn.textContent = 'Gjenopprett fra denne filen';
          const box = h('div', {});
          importArea.prepend(box);
          showAlert(box, 'Gjenopprettingen feilet', [describeError(err), 'De tidligere dataene er beholdt uendret.']);
          return;
        }
        showToast(`✓ Gjenopprettet: ${c.hives.length} kuber, ${c.inspections.length} inspeksjoner, ${c.varroa.length} varroa`);
        location.replace('#/');
      });
    });

    const storageInfo = h('dl', { class: 'kv' });
    (async () => {
      const rows = [];
      try {
        if (navigator.storage && navigator.storage.persisted) {
          rows.push(['Beskyttet lagring', (await navigator.storage.persisted()) ? 'Ja' : 'Nei / ukjent']);
        }
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          if (est && typeof est.usage === 'number') rows.push(['Brukt plass', `${(est.usage / 1024).toFixed(0)} kB`]);
        }
      } catch (_) { /* ikke kritisk */ }
      rows.push(['Kjører som app', window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'Ja (hjemskjerm)' : 'Nei (i nettleser)']);
      storageInfo.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    })();

    mount(token,
      appHeader({ title: 'Sikkerhetskopi', back: { href: '#/', label: 'Forside' } }),
      h('main', {},
        h('div', { class: 'alert alert-info' },
          h('strong', {}, 'Journalen ligger bare på denne enheten.'),
          h('p', {}, 'Sletter du appen eller nettstedsdata i Safari, forsvinner journalen. Ta sikkerhetskopi jevnlig og lagre filen i Filer, iCloud Drive eller e-post.')),
        h('section', { class: 'card', 'aria-labelledby': 'sec-export' },
          h('h2', { id: 'sec-export', style: 'margin-top:0' }, 'Ta sikkerhetskopi'),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Kuber'), h('dd', {}, String(data.hives.length)),
            h('dt', {}, 'Inspeksjoner'), h('dd', {}, String(data.inspections.length)),
            h('dt', {}, 'Varroa'), h('dd', {}, String(data.varroa.length)),
            h('dt', {}, 'Siste kopi'), h('dd', {}, lastBackup ? fmtTimestamp(lastBackup) : 'Aldri')),
          h('div', { class: 'stack' },
            canShare ? h('button', { type: 'button', class: 'btn btn-honey btn-big', onclick: share, disabled: total === 0 }, 'Del / lagre i Filer') : null,
            h('button', { type: 'button', class: `btn ${canShare ? 'btn-secondary' : 'btn-honey btn-big'}`, onclick: download, disabled: total === 0 }, 'Last ned JSON-fil')),
          total === 0 ? h('p', { class: 'meta' }, 'Det er ingen data å ta kopi av ennå.') : null,
          exportStatus),
        h('section', { class: 'card', 'aria-labelledby': 'sec-import' },
          h('h2', { id: 'sec-import', style: 'margin-top:0' }, 'Gjenopprett fra sikkerhetskopi'),
          h('p', { class: 'meta' }, 'Velg en JSON-fil du har eksportert fra Bigårdsjournal. Filen kontrolleres før noe endres, og du må bekrefte før eksisterende data erstattes.'),
          h('label', { class: 'btn btn-secondary file-label', for: 'import-file' }, 'Velg fil …', fileInput),
          importArea),
        h('section', { class: 'card', 'aria-labelledby': 'sec-storage' },
          h('h2', { id: 'sec-storage', style: 'margin-top:0' }, 'Lagring på denne enheten'),
          storageInfo,
          h('p', { class: 'small' }, `Appversjon ${APP_VERSION} · dataformat ${SCHEMA_VERSION}`))));
  }

  /* ===================== Lagring, nett og oppdateringer ===================== */
  let persistRequested = false;
  function requestPersistentStorage() {
    if (persistRequested) return;
    persistRequested = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (_) { /* ikke støttet */ }
  }

  function updateOnlineState() { document.body.classList.toggle('is-offline', !navigator.onLine); }
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const banner = document.getElementById('update-banner');
    const btn = document.getElementById('update-btn');
    let reloading = false;
    let userAccepted = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!userAccepted || reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const offer = (worker) => {
        if (!worker || !navigator.serviceWorker.controller) return;
        banner.hidden = false;
        btn.onclick = async () => {
          if (currentForm && currentForm.isDirty()) {
            const ok = await confirmDialog({ title: 'Oppdatere nå?', message: 'Skjemaet du holder på med lagres som utkast og hentes fram igjen etter oppdateringen.', confirmText: 'Oppdater', cancelText: 'Vent' });
            if (!ok) return;
            currentForm.saveDraftNow();
          }
          userAccepted = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
      };
      // Fang opp ny versjon uansett om den allerede venter, er under installasjon eller dukker opp senere
      const track = (w) => {
        if (!w) return;
        if (w.state === 'installed') offer(w);
        else w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      };
      if (reg.waiting) offer(reg.waiting);
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
      });
    }).catch((err) => console.warn('Service worker ble ikke registrert:', err));
  }

  /* ===================== Oppstart ===================== */
  window.addEventListener('hashchange', render);
  updateOnlineState();
  setupServiceWorker();
  render();

  // Eksponert for automatiserte tester (ingen funksjon i vanlig bruk).
  window.Bigardsjournal = { validateBackup, version: APP_VERSION };
})();
