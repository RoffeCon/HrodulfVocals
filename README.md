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

## Ljust och mörkt läge

Solen-ikonen (◐) i toppfältet växlar mellan mörkt scenläge och ett ljusare, varmare läge för
replokal eller dator i dagsljus. Valet sparas på enheten och gäller tills du växlar igen.

## Öva utantill (inlärningsläge)

Eftersom du lär dig texterna utantill och inte har någon app eller papper med dig på scen är
det här läget själva poängen med appen, inte scenvisningen. Öppna en låt och tryck
**"Öva utantill"**:

- Raderna kommer en i taget. Skriv det du minns av raden och tryck **Rätta** (eller Enter).
- Är den exakt rätt markeras den teal och du går vidare.
- Saknas ord eller är fel markeras vad som **fattas** (understruket i amber) och vad du skrev
  som **inte stämmer** (rött, genomstruket) — sedan går du vidare till nästa rad.
- Kör fast? **Visa rad** avslöjar den utan gissning, så du kan fortsätta framåt.
- I slutet får du en sammanfattning: hur många rader du fick rätt på första försöket. Perfekt
  att köra samma låt några gånger i rad och se förbättringen.

Bara sångtexten räknas in — ackord och scenanteckningar (`>`-rader) hoppas över, eftersom det
är orden du ska minnas, inte ackordgreppen.

## Skriva med knappar istället för markup

Ovanför textfältet i editorn finns tre knappar — **+ Rubrik**, **+ Ackord**, **+ Anteckning** —
som skriver in rätt syntax åt dig på markörens position (eller runt en markerad text, t.ex.
markera "Am" och tryck + Ackord för att få `[Am]`). Praktiskt på mobil där hakparenteser och
`##` är krångliga att hitta på tangentbordet.

## Zoom och långa rader

**Textstorlek A−/A+** i scenläget zoomar in eller ut. Rader med ackord håller alltid ackorden
rätt positionerade ovanför rätt stavelse — blir en rad för lång för skärmen vid hög zoom går
den att svepa i sidled istället för att radbryta och förstöra ackordplaceringen. Rena textrader
utan ackord radbryts som vanligt.

## Versioner av samma låt

Har du flera versioner av samma låt (studio, akustisk, liveversion, olika mixar du provar) —
tryck **+ Ny version** i editorn för en låt du redan sparat. Det skapar en kopia med samma
titel som utgångspunkt, döpt V2 (eller vad du vill kalla den i **Version**-fältet). Så fort en
låt har fler än en version dyker små flikar upp (V1 · V2 · Akustisk ...) både i editorn och i
scenläget, så du kan hoppa mellan dem direkt.

## Exportera

**Exportera**-knappen i editorn ger tre varianter som .txt-filer:
- **Text med ackord** — precis som du skrev den, ackord kvar inline.
- **Bara text** — ren sångtext utan ackord, bra för Word eller utskrift.
- **Suno-format** — avsnittsrubriker omvandlade till `[Verse]`, `[Chorus]` osv. som Suno
  förväntar sig, ackord borttagna.

## Biblioteket: mer kontroll i listläget

- **Snabbtitel** - skriv bara en titel i fältet ovanför listan och tryck Enter. Låten skapas
  direkt utan att öppna hela editorn; fyll i text och detaljer när du har tid.
- **Döp om / Radera** direkt på varje rad - ingen omväg via editorn krävs.
- **Visa anteckningar i listan** - kryssrutan ovanför listan visar (eller döljer) varje låts
  anteckningsfält som en rad under titeln.
- **Versioner fälls ihop automatiskt** - har en låt flera versioner visas bara en rad med en
  liten pil (▸) och antal versioner. Klicka pilen för att fälla ut och se/öppna varje version.

## Importera låtar

**Importera**-knappen i biblioteket öppnar ett textfält där du klistrar in text - oavsett om
den kommer från Word, Anteckningar, eller något annat, eftersom det bara är vanlig text du
klistrar in. Ska du importera flera låtar samtidigt, separera varje låt med en egen rad som
bara innehåller `---`. Första raden i varje block blir titeln, resten blir låtens text. En
förhandsvisning visar hur många låtar som hittas innan du bekräftar.

## Gruppera setlistan

I setlist-byggaren finns **+ Grupprubrik**, som lägger till en rubrikrad du kan döpa fritt
(t.ex. "Drop D" eller "Akustiskt set"). Rubriker går att flytta och ta bort precis som låtar
med samma ▲▼/✕-knappar, och gör setlistan lättare att läsa för resten av bandet - särskilt
praktiskt inför en framtida skärm i replokalen.

## Vidareutveckling (roadmap, egen session)

En större modul för utrustnings- och gigförberedelse är på gång: registrera vilken utrustning
du och bandet har, räkna ut vad som krävs (t.ex. antal kablar utifrån vald utrustning), bocka av
inför ett gig, skriva ut packlistor, och på sikt foton samt färdiga "uppsättningar" per gigtyp.
Det är en egen datamodell och ett eget gränssnitt, så det byggs som ett separat tillägg när det
är dags.

En annan idé för framtiden: casta aktuell setlista till en skärm i replokalen (t.ex. via en
Raspberry Pi), busshållplats-stil — "Nu spelar: Barren World (Drop D) · Nästa: Water Under My Bed"
— så hela bandet ser var man är i låtlistan utan att titta på telefonen.

## Rimlexikon

Pennikonen (✎) i toppfältet öppnar ett sidofält du kan ha uppe samtidigt som du skriver i
editorn. Där kan du:

- Lägga till rim som ordgrupper (kommaseparerat), taggade med **språk** (svenska/engelska/
  franska/annat) och **typ** (enkelt rim, flerstavigt, frasrim, assonans, allitteration) - typen
  fungerar också som filter i listan.
- Koppla ett rim till låtar du använt det i - antingen manuellt via **+ Koppla nuvarande låt**
  när du har en låt öppen i editorn, eller radera kopplingen igen med ✕ på chippen.
- **Sök rim i låtar** - skriv in två ord, appen letar igenom alla låtars sångtext (ackord och
  rubriker räknas inte) och visar var orden förekommer inom valt radavstånd (standard 4 rader) -
  det fångar både rim inom en vers och rim mellan t.ex. sista raden i vers 1 och vers 2.

## Autostart efter omstart av telefonen

Utan extra steg dör servern om telefonen startas om, eftersom Termux inte startar processer
automatiskt. Så här fixar du det:

1. Installera **Termux:Boot** från F-Droid: https://f-droid.org/packages/com.termux.boot/
   (en separat app, inte samma som Termux självt - Termux måste redan vara installerat).
2. Öppna Termux:Boot en gång (det räcker att öppna den, ingen inställning behövs) - det skapar
   mappen `~/.termux/boot/`.
3. I Termux:
   ```
   mkdir -p ~/.termux/boot
   cp ~/HrodulfVocals/termux-boot-start-songbook.sh ~/.termux/boot/start-songbook.sh
   chmod +x ~/.termux/boot/start-songbook.sh
   ```
4. Starta om telefonen. Servern ska starta automatiskt (kolla `~/songbook-boot.log` i Termux om
   den inte gör det).

Justera sökvägen i skriptet om ditt repo inte ligger i `~/HrodulfVocals`.

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
