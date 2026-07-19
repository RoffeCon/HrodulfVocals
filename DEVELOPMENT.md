# LyricsMaster - utvecklingsdokumentation

Den här filen är till för att kunna återuppta utvecklingen om sammanhanget (t.ex. en
Claude-konversation) skulle gå förlorat. Den beskriver **vad appen är**, **hur den är byggd**,
och **vad som är gjort** - inte en fullständig commit-historik, utan en teknisk karta.

Uppdatera den här filen i slutet av varje större utvecklingsomgång.

## Vad är LyricsMaster?

En personlig sångtext-, setlist- och rimlexikonapp för Rolf (Hrodulfus), byggd för att köras
helt lokalt på hans Android-telefon via Termux. Ingen molntjänst, inget konto, fri kod.
Ursprungligen kallad "Hrodulfus Songbook", döpt om till **LyricsMaster**.

- **Repo:** github.com/RoffeCon/HrodulfVocals
- **Körs:** Node/Express-server i Termux på telefonen, PWA i webbläsaren
- **Data:** JSON-filer i `data/`, ingen databas
- **Andra enheter:** ansluter till telefonens IP över samma wifi; en separat kioskvy
  (`/display.html`) kan visas på en andra skärm (t.ex. Raspberry Pi i replokalen)

## Arkitektur

```
server.js              Express-app, alla REST-routes, websocket-broadcast
lib/store.js           Enkel JSON-fillagring med atomära skrivningar (ingen native-kompilering)
lib/lyricLines.js       Extraherar sångbara rader ur låttext (för rim-närhetssökning)
lib/transpose.js        Ackord-transponering (server-side variant, klienten har sin egen)
public/index.html       Hela appens UI - en enda sida, växlar mellan "views" via CSS-klasser
public/app.js            All klientlogik (stor fil - se sektionsrubriker i koden)
public/chordpro.js       Tolkning/rendering av låttext + ackord (delad logik, körs i webbläsaren)
public/style.css         Allt utseende - mörk scen-estetik, ljust läge via [data-theme="light"]
public/display.html/.js  Fristående kioskvy för en andra skärm - inte del av huvudappen
public/service-worker.js PWA-cache. VIKTIGT: cache-versionen (CACHE-konstanten) MÅSTE höjas
                          varje gång public/-filer ändras, annars serverar redan installerade
                          instanser gammal kod på obestämd tid.
```

Datafiler i `data/` (skapas automatiskt, säkerhetskopieras enklast via ⓘ-knappen i appen):
`songs.json`, `setlists.json`, `rhymeWords.json`, `rhymeLinks.json`.
(`rhymes.json` är den gamla rim-modellen, kvar bara för engångsmigrering vid uppstart.)

## Datamodeller (i korthet)

**Song:** id, title, composer, artist, key, capo, tempo, timeSignature, tags[], notes, text
(ChordPro-liknande markup - se "textformat" nedan), groupId + versionLabel (för versioner av
samma låt), createdAt/updatedAt.

**Setlist:** id, name, venue, date, notes, items[] - varje item är antingen
`{kind:'song', songId}` eller `{kind:'group', label}` (grupprubrik, t.ex. gitarrstämning).
`songIds[]` deriveras alltid från items för bakåtkompatibilitet.

**RhymeWord:** id, text, language, syllables, tags[], phrases[], favorite, notes,
songUsage[] (vilka låtar ordet använts i), createdAt/updatedAt.

**RhymeLink:** id, wordIds[] (≥2 ord som rimmar med varandra), types[] (perfect/near/
assonance/consonance/alliteration/other - en länk kan ha flera typer samtidigt), notes.
Denna modell ersatte en tidigare "ordgrupp med en typ"-modell eftersom ett ord (t.ex. "hat")
behöver kunna delta i flera olika rimrelationer med olika typer utan att dupliceras.

## Textformatet för låtar

```
## Vers 1
Det var en [C]gång i [G]tiden

## Refräng
[F]Minns att [C]skratta[G]

> scenanteckning, kursiv, transponeras inte
```
- `## Namn` startar ett avsnitt (vers/refräng/stick/annat, typ avgörs av nyckelord i namnet)
- En enstaka tomrad = läsbarhetspaus inom avsnittet. **Två** tomrader i rad avslutar
  refräng/stick-färgningen (så du kan dela upp en lång refräng utan att tänka på markup).
- `[Ackord]` inline, positioneras ovanför rätt stavelse vid rendering (monospace-kolumner)
- `>` = scenanteckning

## Funktionsöversikt (kronologisk, ungefärlig ordning de byggdes i)

1. **Grundapp:** bibliotek, editor, setlistor, scenläge (transponering, ljust/mörkt läge,
   autoscroll, textstorlek), inlärningsläge (öva utantill med ordvis diff)
2. **Markup-förbättringar:** knappar för rubrik/ackord/anteckning istället för att skriva
   markup för hand, ackord-snabbval (chips av redan använda ackord i låten)
3. **Versioner:** en låt kan ha flera versioner (V1/V2/Akustisk etc.) som delar `groupId`.
   "+ Ny version" skapar korrekt länkade versioner. "🔗 Länka som version av…" länkar
   retroaktivt ihop två redan skapade, oberoende låtar (löser ett buggscenario där två
   manuellt skapade låtar med samma titel aldrig delade groupId och därför inte gick att
   växla mellan).
4. **Export:** text med ackord / bara text / Suno-format (`[Verse]`/`[Chorus]`)
5. **Bibliotek:** versionsfällning (▸/▾), snabbtitel, döp om/radera i listläge, visa
   anteckningar (valbart), artist-fält separat från kompositör + filter
6. **Import:** klistra in text, separera flera låtar med `---`
7. **Setlistor:** grupprubriker, dra-och-släpp (pekhändelser, fungerar med touch), skriv ut
   (öppnar utskriftsvänlig sida)
8. **Rimlexikon v1 → v2:** startade som "ordgrupp + en typ", byggdes om till **ord + separata
   rimkopplingar** (se datamodell ovan) efter användarfeedback - detta är den nuvarande modellen.
   Sök-läge (uppslag "vad rimmar på X", grupperat efter stavelseantal) separat från
   Hantera-läge (CRUD, massåtgärder, import/export). Kopplat till låtar via songUsage.
   Separat närhetssökning (`/api/search/proximity`) hittar rim inom N rader i låttexter,
   oberoende av rimlexikonet.
9. **Dashboard:** startvy med modul-plattor (Bibliotek/Setlistor/Rimlexikon, + gråmarkerad
   "Utrustning" för framtiden). Flikarna fungerar som förut utan att gå via dashboard.
10. **Andra skärmen:** `/api/live` (flyktigt, i minnet) + websocket-broadcast + fristående
    `/display.html`-sida som visar "Nu spelas / Nästa" - tänkt för en Raspberry Pi-skärm i
    replokalen. Uppdateras automatiskt när scenläget navigerar i en setlista.
11. **Backup:** ⓘ-knapp visar telefonens IP direkt i appen + en-klicks nedladdning av all
    data (`/api/backup`) som JSON.

## Kända avvägningar / varför vissa saker är som de är

- **Ingen native-kompilering** i några beroenden (bara `express` + `ws`) - Termux på Android
  ARM kan annars få problem med native npm-paket. JSON-fillagring istället för SQLite av
  samma anledning.
- **Service worker cache-version måste höjas manuellt** vid varje ändring av public/-filer.
  Glömdes två gånger tidigt i projektet, vilket orsakade "varför fungerar inte fixen"-buggar.
  Om nåt liknande händer igen: kolla `CACHE`-konstanten i `service-worker.js` först.
- **Autoscroll** flyttar `scrollTop` manuellt via `requestAnimationFrame`, med en egen
  delpixel-ackumulator (webbläsare rundar `scrollTop` till heltal vid låg hastighet annars,
  vilket såg ut som att scrollningen frös helt vid låga hastigheter).
- **HTTPS/Chrome:** Chrome tvingar numera HTTPS som standard. Lokala servrar utan riktigt
  certifikat kan blockeras. Lösning: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
  per enhet, dokumenterat i README.
- **Versionering av låtar** bygger på ett delat `groupId` som sätts antingen vid skapande
  (via "+ Ny version") eller retroaktivt (via "🔗 Länka som version av…"). Fritt textfält
  för versionsnamn (`versionLabel`) skapar INTE någon koppling i sig - bara `groupId` gör det.

## Roadmap (inte byggt än)

- **Utrustnings-/gigförberedelsemodul:** registrera utrustning, packlistor per gig, avbockning,
  ev. foton, färdiga "uppsättningar" per gigtyp, ev. QR-läsning längre fram. Egen datamodell,
  eget UI - stor separat session.
- **Versmått-referens i rimlexikonet:** informationsfält med olika versmått (t.ex. alexandrin)
  med exempel, för inspiration. Nämnt som en framtida idé, inte specificerat i detalj än.
- Fler önskelistor kommer löpande - kolla senaste konversationen eller commit-historiken på
  GitHub för det senaste läget om den här filen känns inaktuell.
