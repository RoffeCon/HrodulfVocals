# Hrodulfus Songbook

En egen, fri sångtext- och setlisteapp. Ingen molntjänst, inget konto, inget App Store-godkännande
att vänta på — telefonen är servern, och du äger all kod och all data. *Memento Ridere.*

## Hur det hänger ihop

- **Telefonen kör en liten Node.js-server** (via Termux) som håller all data i två enkla
  JSON-filer (`data/songs.json`, `data/setlists.json`) och serverar själva appen.
- **Appen är en PWA** — du installerar den som en ikon på hemskärmen, precis som en vanlig app,
  och den fungerar offline eftersom servern kör lokalt på telefonen (den är alltså "offline" även
  utan wifi, så länge Termux-servern är igång).
- **Datorn ansluter till samma server över wifi** och du redigerar i webbläsaren — exakt samma
  app, bara i ett bläddrarfönster istället för installerad. Ingen separat "desktop-klient" att
  hålla i synk, det är samma kod och samma data.

```
[Telefon: Termux kör server.js] --- wifi (samma nätverk) --- [Dator: valfri webbläsare]
              |
      PWA installerad på telefonen pratar med servern via localhost
```

## Installation på telefonen (Android + Termux)

1. Installera **Termux** från F-Droid (rekommenderas, Play Store-versionen är föråldrad):
   https://f-droid.org/packages/com.termux/
2. Öppna Termux och kör:
   ```
   pkg update && pkg upgrade
   pkg install nodejs-lts git
   ```
3. Överför den här mappen till telefonen (t.ex. via `git clone` av ditt eget repo, eller
   `termux-setup-storage` + kopiera från Nedladdningar) och gå in i den:
   ```
   cd songbook
   npm install
   ```
4. Starta servern:
   ```
   npm start
   ```
   Du bör se något i stil med:
   ```
   ♪ Hrodulfus Songbook körs nu ♪
   På telefonen:      http://localhost:8420
   Från datorn (wifi): http://192.168.X.X:8420
   ```
5. Öppna **Chrome** på telefonen och gå till `http://localhost:8420`. Tryck på menyn (⋮) →
   **"Lägg till på startskärmen"** / **"Installera app"**. Nu har du en app-ikon som öppnar
   Songbook i eget fönster, utan adressfält.

### Håll servern igång i bakgrunden

Termux stänger lätt ner processer när appen inte är i fokus. Gör så här:

- Kör `termux-wake-lock` i Termux-sessionen innan du startar servern, så håller Android igång
  processen längre.
- Installera **Termux:Boot** (också från F-Droid) om du vill att servern ska starta automatiskt
  när telefonen startar om.
- Under en spelning: håll Termux-appen öppen i bakgrunden (svep inte bort den), eller kör servern
  i en `tmux`-session om du vill kunna stänga Termux-fönstret utan att döda processen:
  ```
  pkg install tmux
  tmux new -s songbook
  npm start
  # Ctrl+B, sedan D för att koppla loss (servern fortsätter köra)
  # tmux attach -t songbook för att komma tillbaka
  ```

## Använda från datorn

Så länge datorn är på **samma wifi-nätverk** som telefonen: öppna webbläsaren och gå till
`http://<telefonens-ip>:8420` (IP-adressen skrivs ut när servern startar). Där kan du skriva
och redigera låtar med tangentbord — ändringar dyker upp direkt på telefonen också, tack vare
en liten websocket-koppling som håller alla anslutna enheter i synk i realtid.

Vill du ha en fast adress istället för att leta upp IP:n varje gång? Sätt ett statiskt IP eller
en DHCP-reservation för telefonen i din router (du har ju redan Pi-hole i hemmalabbet — går
utmärkt att lägga till en DNS-post där, t.ex. `songbook.hem` → telefonens IP).

## Skriva låtar: textformatet

Enkelt, inga konstiga klamrar att komma ihåg:

```
## Vers 1
Det var en [Em]gång i [C]tiden

## Refräng
[G]Minns att [D]skratta[Em]
> spela mjukt här, dämpa gitarren
```

- **`## Namn`** på egen rad startar ett nytt avsnitt. Ord som "vers", "refräng"/"chorus",
  "stick"/"brygga"/"bridge" känns igen automatiskt och färgmarkeras (refräng = amber,
  vers = teal, stick = röd accent).
- **`[Ackord]`** skrivs rakt in i texten där det klingar. Ackorden hamnar automatiskt
  ovanför rätt stavelse när låten visas.
- **`> Text`** på egen rad blir en kursiv scenanteckning — transponeras inte, räknas inte som
  sångtext.

## Funktioner i scenläget

Öppna en låt (tryck på den i biblioteket) för att komma till scenläget:

- **Transponera** upp/ner utan att ändra originaltexten.
- **Dölj/visa ackord** — bara text när du vill sjunga utan att tänka på gitarren.
- **Textstorlek** för läsbarhet på avstånd.
- **Autoscroll** med justerbar hastighet — skärmen rullar åt dig.
- Skärmen hålls vaken automatiskt under scenläge (Wake Lock), så telefonen inte somnar
  mitt i ett set.
- Öppnar du scenläget från en **setlista** får du "Föregående/Nästa"-knappar för att bläddra
  genom hela spellistan utan att gå tillbaka till biblioteket.

## Backup

All din data ligger i `data/songs.json` och `data/setlists.json`. Två läsbara textfiler —
inget konstigt databasformat. Säkerhetskopiera dem som du vill: `git commit`, molnsynk av
mappen, eller helt enkelt en kopia då och då. Appen skriver aldrig direkt till filen utan
skriver till en temporär fil och byter namn atomärt, så en avbruten skrivning ska aldrig kunna
förstöra din data.

## Tekniken bakom, kort

- `server.js` — Express-server, REST-API för låtar och setlistor, websocket för livesynk.
- `lib/store.js` — enkel JSON-fillagring med atomära skrivningar (ingen native-kompilering,
  funkar problemfritt i Termux).
- `public/chordpro.js` — tolkar textformatet och renderar ackord/vers/refräng, samt
  transponerar ackord (delad logik, körs i webbläsaren).
- `public/app.js` — all appstyrning: bibliotek, editor, setlistor, scenläge, websocket-klient.
- `lib/transpose.js` — samma transponeringslogik som ett fristående Node-bibliotek, för
  framtida bruk om du vill bygga serversidesfunktioner (t.ex. export till PDF i annan tonart).

Fri kod, inget App Store-beroende, ingen prenumeration. Din stämma, din server.
