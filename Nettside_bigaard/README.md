# Bigårdsjournal – Lund Bigaard

Bigårdsjournal er en enkel nettapp (PWA) for å føre inspeksjoner og varroa per kube. Den virker uten nett etter første oppstart. Journalen lagres bare på telefonen (IndexedDB). Den har ingen konto, ingen serverdatabase og ingen skysynkronisering.

## Filene

| Fil | Innhold |
|---|---|
| `index.html` | Appskallet |
| `styles.css` | Utseende (store trykkflater, høy kontrast) |
| `app.js` | Skjermbilder, skjemaer, historikk, sikkerhetskopi |
| `db.js` | Lokal lagring i IndexedDB |
| `sw.js` | Service worker som gjør at appen åpnes uten nett |
| `manifest.webmanifest` | Navn, farger og ikoner for hjemskjermen |
| `icons/` | Appikoner (180, 192, 512 px og maskerbart ikon) |
| `img/lund-bigaard-logo.png` | Logoen til Lund Bigaard (vises på forsiden og ved oppstart) |

Alle filene må ligge i samme mappe på webserveren, med `icons/` som undermappe. Appen virker også i en undermappe, for eksempel `https://eksempel.no/bigard/`.

## 1. Legg appen og veiledningen på GitHub (gratis)

GitHub kan gjøre to ting samtidig:
- **Hoste appen** med HTTPS via GitHub Pages. HTTPS er påkrevd for at appen skal virke uten nett.
- **Vise denne veiledningen.** README-filen vises automatisk på forsiden av repoet og kan leses på iPhone.

GitHub Pages er gratis for **offentlige** repoer. Alle kan dermed se programfilene og veiledningen. Journalen din havner aldri på GitHub, den ligger bare på telefonen.

**Første gang (fra Mac, ingen programmering nødvendig):**
1. Lag en gratis konto på <https://github.com>.
2. Trykk **+** øverst til høyre → **New repository**. Gi det et navn, for eksempel `bigardsjournal`, velg **Public** og trykk **Create repository**.
3. Trykk på lenken **uploading an existing file**.
4. Åpne mappen `Nettside_bigaard` i Finder, merk **alt innholdet** (alle filene og mappene `icons` og `img`) og dra det inn i nettleservinduet. Trykk **Commit changes**.
5. Gå til **Settings → Pages**. Under *Build and deployment* velger du *Deploy from a branch*, grenen **main** og mappen **/ (root)**. Trykk **Save**.
6. Etter et par minutter får du en adresse som `https://<brukernavn>.github.io/bigardsjournal/`. Det er adressen du åpner i Safari på iPhone.

**Lese veiledningen på iPhone:** Åpne `https://github.com/<brukernavn>/bigardsjournal` i Safari. Veiledningen vises under fillisten. Legg gjerne siden til som bokmerke.

**Oppdatere senere:** Endre `CACHE_VERSION` i `sw.js` først (se punkt 4). Åpne så repoet → **Add file → Upload files**, dra inn de endrede filene og trykk **Commit changes**. Filer med samme navn blir erstattet.

**Andre alternativer:**
- *iCloud Drive:* Mappen ligger under Dokumenter. Har du slått på «Skrivebord og Dokumenter» i iCloud på Mac-en, finner du `README.md` i Filer-appen på iPhone. Det gjelder bare veiledningen. Appen kan ikke kjøres fra iCloud.
- *Netlify Drop* (<https://app.netlify.com/drop>): Dra mappen inn og få en `netlify.app`-adresse. Opprett konto og «claim» nettstedet med en gang, ellers slettes det.

## 2. Legg appen på hjemskjermen (iPhone)

1. Åpne adressen i **Safari** mens du har nett.
2. Trykk på **Del**-knappen. På iOS 26 kan den ligge under **⋯** ved adresselinjen, avhengig av fanevisningen.
3. Velg **Legg til på Hjem-skjerm**.
4. Sjekk at **Åpne som nettapp** er slått på (standard i iOS 26). Trykk **Legg til**.
5. Åpne appen fra ikonet **én gang mens du har nett**. Da lagres appfilene for bruk uten nett.

**Viktig:** Bruk alltid ikonet på hjemskjermen. På iPhone har hjemskjerm-appen normalt sin egen lagring, atskilt fra Safari. Det du registrerer i en vanlig Safari-fane, vises derfor ikke i appen, og omvendt. Vil du flytte data mellom dem, bruker du sikkerhetskopi og gjenoppretting.

## 3. Ta sikkerhetskopi

Journalen finnes bare på telefonen. Sletter du appen, eller nettstedsdata i Safari, forsvinner den. Appen minner deg på det hvis det har gått mer enn 30 dager siden siste kopi.

**Ta kopi:** Forsiden → **Sikkerhetskopi** → **Del / lagre i Filer** → velg **Arkiver i Filer** (f.eks. iCloud Drive) eller send den med e-post. Du kan også trykke **Last ned JSON-fil**. Da havner filen i Filer → Nedlastinger.

**Gjenopprett:** **Sikkerhetskopi** → **Velg fil …** → velg JSON-filen. Appen kontrollerer filen og viser hva den inneholder, før noe endres. Finnes det data fra før, må du bekrefte at de skal erstattes. Gjenopprettingen skjer i én operasjon: Feiler den, beholdes de gamle dataene uendret. Gjenoppretting virker også uten nett.

Filen er vanlig JSON (`format: "bigardsjournal-backup"`, `schemaVersion: 1`) og kan leses i hvilken som helst teksteditor.

## 4. Oppdatere appen senere

Endrer du noen av filene, må du også endre `CACHE_VERSION` i `sw.js` (nå `bigardsjournal-v1.1.0`, neste f.eks. `bigardsjournal-v1.1.1`). Bytter du logoen, beholder du filnavnet `img/lund-bigaard-logo.png` og laste opp på nytt. Neste gang appen åpnes med nett, vises «En ny versjon av appen er klar» med knappen **Oppdater**. Journalen påvirkes ikke av oppdateringer.

## 5. Dette bør du kontrollere på iPhone

Appen er testet automatisk i Chromium med iPhone-skjermstørrelse, men ikke i Safari på en ekte iPhone. Gå gjennom dette én gang:

- [ ] Ikonet og navnet «Bigårdsjournal» ser riktige ut på hjemskjermen, og appen åpnes uten Safari-verktøylinje.
- [ ] Topplinjen ligger under statuslinjen (klokke/batteri) uten å bli dekket, og lagreknappen ligger over hjem-streken nederst.
- [ ] Datovelgeren viser norsk format, og dagens dato er fylt inn.
- [ ] Skjermen zoomer ikke inn når du trykker i tekstfelt.
- [ ] **Flymodus-test:** Lukk appen helt (sveip den bort), slå på flymodus, åpne appen fra ikonet. Historikken skal vises, og en ny inspeksjon skal kunne lagres.
- [ ] **Del / lagre i Filer** åpner delingsarket, og filen kan lagres i Filer.
- [ ] Gjenoppretting fra den lagrede filen virker (test gjerne på en annen enhet eller i Safari).
- [ ] Under Sikkerhetskopi → «Lagring på denne enheten» står «Kjører som app: Ja (hjemskjerm)».
- [ ] Lesbarhet i sollys utendørs.
