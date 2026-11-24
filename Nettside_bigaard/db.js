/* Bigårdsjournal – lokal lagring med IndexedDB.
 * Alle skriveoperasjoner skjer i én transaksjon og blir enten fullført eller rullet tilbake.
 */
'use strict';

const DB = (() => {
  const NAME = 'bigardsjournal';
  const VERSION = 1;
  const DATA_STORES = ['hives', 'inspections', 'varroa'];
  const OPEN_TIMEOUT_MS = 10000;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self) || !self.indexedDB) {
        reject(new Error('Nettleseren gir ikke tilgang til lokal lagring (IndexedDB).'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Den lokale databasen svarte ikke. Lukk appen helt og åpne den igjen.'));
      }, OPEN_TIMEOUT_MS);

      let req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('hives')) db.createObjectStore('hives', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('inspections')) {
          db.createObjectStore('inspections', { keyPath: 'id' }).createIndex('hiveId', 'hiveId');
        }
        if (!db.objectStoreNames.contains('varroa')) {
          db.createObjectStore('varroa', { keyPath: 'id' }).createIndex('hiveId', 'hiveId');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        if (settled) return; // tidsavbrudd har allerede slått inn
        settled = true;
        resolve(db);
      };
      req.onerror = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(req.error || new Error('Kunne ikke åpne den lokale databasen.'));
      };
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  /* Kjører fn(stores) i en transaksjon. fn kan returnere en verdi eller en funksjon
   * som leser resultatet når transaksjonen er fullført. */
  async function tx(storeNames, mode, fn) {
    const db = await open();
    const names = [].concat(storeNames);
    return new Promise((resolve, reject) => {
      let t;
      let result;
      try {
        t = db.transaction(names, mode);
      } catch (err) {
        reject(err);
        return;
      }
      t.oncomplete = () => {
        try { resolve(typeof result === 'function' ? result() : result); } catch (err) { reject(err); }
      };
      t.onerror = (ev) => reject(t.error || (ev && ev.target && ev.target.error) || new Error('Lagringen feilet.'));
      t.onabort = () => reject(t.error || new Error('Lagringen ble avbrutt.'));
      try {
        const stores = {};
        names.forEach((n) => { stores[n] = t.objectStore(n); });
        result = fn(stores, t);
      } catch (err) {
        try { t.abort(); } catch (_) { /* allerede avbrutt */ }
        reject(err);
      }
    });
  }

  return {
    open,

    getAll(store) {
      return tx(store, 'readonly', (s) => { const r = s[store].getAll(); return () => r.result || []; });
    },

    get(store, id) {
      return tx(store, 'readonly', (s) => { const r = s[store].get(id); return () => r.result; });
    },

    byHive(store, hiveId) {
      return tx(store, 'readonly', (s) => {
        const r = s[store].index('hiveId').getAll(hiveId);
        return () => r.result || [];
      });
    },

    put(store, obj) {
      return tx(store, 'readwrite', (s) => { s[store].put(obj); return obj; });
    },

    delete(store, id) {
      return tx(store, 'readwrite', (s) => { s[store].delete(id); });
    },

    /* Sletter en varroa-registrering og fjerner koblinger fra tellinger som pekte på den. */
    deleteVarroa(id) {
      return tx('varroa', 'readwrite', (s) => {
        s.varroa.delete(id);
        const r = s.varroa.getAll();
        r.onsuccess = () => {
          (r.result || []).forEach((v) => {
            if (v.linkedTreatmentId === id) {
              v.linkedTreatmentId = null;
              s.varroa.put(v);
            }
          });
        };
      });
    },

    /* Sletter en kube med alle tilhørende registreringer. */
    deleteHive(hiveId) {
      return tx(['hives', 'inspections', 'varroa'], 'readwrite', (s) => {
        s.hives.delete(hiveId);
        ['inspections', 'varroa'].forEach((name) => {
          const r = s[name].index('hiveId').getAllKeys(hiveId);
          r.onsuccess = () => (r.result || []).forEach((key) => s[name].delete(key));
        });
      });
    },

    exportAll() {
      return tx(DATA_STORES, 'readonly', (s) => {
        const h = s.hives.getAll();
        const i = s.inspections.getAll();
        const v = s.varroa.getAll();
        return () => ({ hives: h.result || [], inspections: i.result || [], varroa: v.result || [] });
      });
    },

    /* Erstatter alle data i én transaksjon. Feiler noe, beholdes de gamle dataene uendret. */
    replaceAll(data) {
      return tx(DATA_STORES, 'readwrite', (s) => {
        DATA_STORES.forEach((name) => s[name].clear());
        DATA_STORES.forEach((name) => data[name].forEach((rec) => s[name].put(rec)));
      });
    },

    getMeta(key) {
      return tx('meta', 'readonly', (s) => { const r = s.meta.get(key); return () => (r.result ? r.result.value : undefined); });
    },

    setMeta(key, value) {
      return tx('meta', 'readwrite', (s) => { s.meta.put({ key, value }); });
    }
  };
})();
