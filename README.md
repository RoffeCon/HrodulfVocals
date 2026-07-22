# LyricsMaster

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
   ♪ LyricsMaster körs nu ♪
   På telefonen:      http://localhost:8420
   Från datorn (wifi): http://192.168.X.X:8420
   ```
5. Öppna **Chrome** på telefonen och gå till `http://localhost:8420`. Tryck på menyn (⋮) →
   **"Lägg till på startskärmen"** / **"Installera app"**. Nu har du en app-ikon som öppnar
   LyricsMaster i eget fönster, utan adressfält.

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

## Uppdatera appen (VIKTIGT - läs det här)

**`pkg update && pkg upgrade` uppdaterar INTE appen.** Det uppdaterar bara Termux egna
systemprogram (node, python, bash osv), helt orelaterat till din kod. Det du vill ha är
`git pull`, som hämtar dina egna filändringar från GitHub.

Enklast: kör uppdateringsskriptet, som gör allt i ett svep (hämtar kod, installerar ev. nya
beroenden, startar servern):
```
cd ~/HrodulfVocals
bash update.sh
```

Eller för hand:
```
cd ~/HrodulfVocals
git pull
npm start
```

Om du redan har servern igång i en `tmux`-session måste du avsluta den gamla processen först
(gå till sessionen med `tmux attach -t songbook`, tryck `Ctrl+C`, kör sedan `bash update.sh`).

## Använda från datorn

Så länge datorn är på **samma wifi-nätverk** som telefonen: öppna webbläsaren och gå till
`http://<telefonens-ip>:8420` (IP-adressen skrivs ut när servern startar, och syns även i appen
via ⓘ-knappen i toppfältet). Där kan du skriva och redigera låtar med tangentbord — ändringar
dyker upp direkt på telefonen också, tack vare en liten websocket-koppling som håller alla
anslutna enheter i synk i realtid.

Vill du ha en fast adress istället för att leta upp IP:n varje gång? Sätt ett statiskt IP eller
en DHCP-reservation för telefonen i din router.

### Chrome blockerar eller varnar för "osäker anslutning"

Nyare Chrome-versioner tvingar som standard fram HTTPS överallt ("Always use secure
connections"). En lokal server som den här kan inte ha ett riktigt certifikat (det kräver ett
publikt domännamn), så Chrome kan blockera eller varna hårt för adressen. Fixa det permanent,
en gång per enhet/dator:

1. Gå till `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Klistra in `http://<telefonens-ip>:8420` i fältet som visas
3. Sätt flaggan till **Enabled** och klicka **Relaunch**

Detta löser även att funktioner som kräver en "säker kontext" (t.ex. att skärmen hålls vaken
under autoscroll) fungerar även när du ansluter via IP-adress istället för `localhost`.

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
  franska/tyska/annat) och **typ** (enkelt rim, flerstavigt, frasrim, assonans, allitteration) -
  typen fungerar också som filter, och språket färgkodas i listan för snabb överblick.
- Lägga till **frasexempel** (t.ex. "petit noir", "petit café") och fria **taggar** (poetiskt,
  slang, metal osv.) per rim, samt markera som **⭐ favorit**.
- Ändra språk eller typ direkt i listan via rullgardinerna på varje rad - ingen omväg via
  redigeringsläget krävs för snabba justeringar.
- **Massmarkera** flera rim med kryssrutorna (eller "Markera alla filtrerade") för att radera,
  byta språk, eller lägga till en tagg på alla markerade på en gång.
- **Importera JSON** - klistra in en lista av objekt (`[{"words":["hus","mus"],"language":"sv"}]`).
  Saknar ett objekt språkfält används standardspråket du väljer i importrutan istället för att
  gissa fel.
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

## Två uppskjutna punkter, nu klara

- **Riktig radbrytning vid hög zoom.** Långa ackord+text-rader bryts nu vid ordgränser när de
  inte får plats, och ackorden följer med och hamnar kvar ovanför rätt stavelse i den nya
  radbrytningen - inte bara sidledsskroll längre. Räknar om automatiskt när du zoomar in/ut
  eller roterar skärmen.
- **Städat gränssnitt.** Editorn och setlist-vyn hade svällt till 7-9 knappar utspridda över
  hela raden. Sekundära funktioner (versioner, fält, helskärm, export, utskrift, radera, QR,
  energikurva) ligger nu i en samlad "⋯ Mer"-meny; bara den primära handlingen (Spara) syns
  direkt.

Kvar: versmått-uppslagsverket (större jobb, kommer i en egen leverans).

## Nytt i denna omgång (Önskelista 6)

- **Dashboard-fixar:** övningsläget har nu en egen platta (välj låt, hamna direkt i
  övningsläget), loggan/rubriken ska inte längre klippas på smala skärmar, och
  "andra skärmen"-adressen bor nu i ⓘ-panelen tillsammans med resten av anslutnings-
  och backup-informationen istället för att ligga separat på dashboarden.
- **Fält kan döljas i redigeringsläget** - 👁 Fält-knappen låter dig bocka ur vilka av
  Kompositör/Artist/Tonart/Kapo/Tempo/Taktart/Version/Taggar/Anteckningar som ska synas.
  Sparas per enhet.
- **Helskärms-skrivläge** - ⛶ Helskärm i editorn döljer alla fält och maximerar textfältet,
  för fokuserat skrivande.
- **Tap tempo** - 👆 Tap-knappen bredvid Tempo-fältet i editorn: knacka takten, får BPM
  automatiskt.
- **Rim-autokoppling** - när du lägger till ett nytt ord kan du ange "Rimmar på" (ett
  befintligt ord). Är rutan "Koppla även till de ord det ordet redan rimmar med" ikryssad
  (standard) kopplas det nya ordet automatiskt in i alla grupper det angivna ordet redan
  tillhör - lägg till "grace" och ange "rimmar på lace" så kopplas den automatiskt till
  hela place/lace/brace/ace/commonplace/disgrace-gänget också.
- **Energikurva** - 📈 Visa energikurva i setlist-byggaren ritar upp tempot låt för låt som
  ett stapeldiagram, så du ser om tre balladlåtar råkat hamna i rad.
- **QR-kod till bandet** - 📱 QR-kod till bandet i setlist-byggaren genererar en skannbar
  kod som länkar till en skrivskyddad vy (`/setlist-view.html`) - bandmedlemmar skannar med
  sin egen telefonkamera, ingen app eller inloggning behövs, och kan trycka på en låt för
  att se text och ackord.

**Kvar - väntar på nästa omgång:** versmått-uppslagsverk med mallgenerator (vill göra det
ordentligt och korrekt, inte hafsa ihop 20-30 poesiformer på slarv), radbrytning vid hög
zoom, samt översyn av ikoner/namngivning för konsekvens.

## Senaste smärre förbättringar

- **Rimsökningen kan filtreras per typ** - kryssrutor ovanför sökresultatet i Sök-läget.
  Söker du "sat" och bara kryssar i Allitteration får du bara "spat" (den enda kopplingen
  taggad så); kryssar du i Perfekt rim också får du hela gänget som rimmar perfekt.
- **Övningsläget rensar svarsrutan direkt** när du rättat en rad, istället för att din gamla
  text ligger kvar synlig tills du klickat "Nästa rad".

## Nytt i denna omgång (Önskelista 5, del 2)

- **Riktig bugg hittad och fixad: auto-advance till nästa låt.** En race condition - den
  visuella nedräkningen rensade av misstag bort själva bytes-timern precis innan den skulle
  utlösas. Bekräftat och verifierat med en isolerad test av timer-logiken (gammal kod: byte
  kunde utebli slumpmässigt; ny kod: byte sker alltid).
- **Manuell adress** - ⓘ-panelen har nu ett fält för att koppla upp mot en annan adress direkt
  (t.ex. om telefonen bytt wifi-band, eller du kör i replokalen på ett annat nätverk).
- **Skriv ut enstaka låt** direkt från redigeringsläget.
- **Setlista: två utskriftsvarianter** - "bara titlar" (kompakt numrerad lista) och "med text"
  (nu med sidbrytning så varje låt börjar på ett eget blad).
- **Artist eller kompositör i listan** - välj vilket som visas i bibliotekets undertext.
- **Gigläge** - ⛶-knappen i scenläget växlar till helskärm med minimala kontroller (av/på
  autoscroll, hastighet, inställningar, stäng). Helskärmsläget i webbläsaren döljer normalt
  även adressfältet, vilket som bonus kan dölja "Not secure"-varningen där.
- **Bättre touch-yta** på dra-handtaget i setlistan (redan i förra leveransen, nämns här för
  sammanhanget).

**Kvar - kräver mer omsorg, tar nästa runda:** radbrytning av långa textrader vid hög zoom när
ackord visas (kräver en riktig reflow-algoritm som inte förstör ackordens position ovanför
rätt stavelse - vill inte slarva ihop den), översyn av ikoner/namngivning för konsekvens,
visa/dölj-fält i redigeringsläget.

### Om nätverk och Termux

- **2,4GHz/5GHz-problemet** beror troligen på att Android slumpar MAC-adressen per nätverk
  (en integritetsfunktion). Sätt "Enhets-MAC" istället för "Slumpad MAC" på båda banden i
  telefonens wifi-inställningar, så täcker en enda DHCP-reservation i routern båda banden.
  Om routern visar dem som två separata nätverk oavsett, sätt en reservation per band - de
  får då olika IP, men appens nya "Anslut till annan adress"-fält gör det snabbt att växla.
- **Att slippa Termux helt** är i dagsläget inte realistiskt utan att bygga om hela appen till
  en native Android-app (stort projekt, osäker vinst). De få alternativ som finns (t.ex.
  fristående "Node för Android"-appar) är mindre pålitliga för en anpassad Express-server med
  websocket. Den riktiga friktionen - att behöva öppna Termux och starta manuellt - löses
  istället av **Termux:Boot** (redan i paketet, autostartar vid omstart) plus den nya
  **Termux:Widget**-genvägen (`termux-widget-start-songbook.sh`): installera Termux:Widget
  från F-Droid, lägg skriptet i `~/.shortcuts/`, och du får en hemskärmsgenväg som startar
  (eller startar om) servern med en knapptryckning - ingen terminal att öppna.

## Nytt i denna omgång (Önskelista 5, del 1)

- **Trolig grundorsak till flera "fortfarande trasigt"-buggar hittad:** service workern bytte
  strategi från cache-först till **nätverk-först**. Servern körs alltid lokalt på enheten när
  appen går att använda överhuvudtaget, så cache-först gav inget verkligt värde - bara
  förvirring när uppdateringar kändes fastna. Detta bör göra framtida uppdateringar
  mer självläkande.
- **Riktig bugg hittad och fixad:** när autoscroll (eller "Nästa"-knappen) bytte till nästa låt
  i en setlista återställdes aldrig skrollpositionen - nästa låt visades "redan nerskrollad",
  vilket kunde se ut som att den inte gick vidare alls, eller fastnade längst ner.
- **Starta scenläge från valfri låt** - klicka på en låts titel i setlist-byggaren för att
  börja scenläget just där, inte bara från toppen.
- **Backup - återställning.** Kunde bara ladda ner förut. Nu finns "Återställ från fil…" i
  ⓘ-panelen - välj en tidigare nedladdad backup-fil för att återställa allt.
- **Dubblettkontroll:** rimord med samma text+språk avvisas nu (både vid tillägg och import,
  där dubbletter i en importlista hoppas över och räknas i resultatet). Låttitlar varnar mjukt
  om en titel redan finns (blockerar inte, eftersom du medvetet vill kunna ha flera låtar med
  samma titel som versioner).
- **Bättre dra-handtag i setlistan** - betydligt större touch-yta, ska vara lättare att träffa
  rätt på mobil utan att råka markera siffran istället.
- **Egen ikon för rimlexikonet** - ersätter pennsymbolen, syns i toppfältet och på
  dashboard-plattan.

**Kvar till nästa omgång** (bekräftat, väntar på nästa session): skriva ut enstaka låt från
biblioteket, skriv ut "bara titlar"-variant av setlistan (separat från full text-utskrift, som
även ska få sidbrytning per låt), radbrytning istället för sidledsskroll vid hög zoom på smala
skärmar, städning av ikoner/namngivning i gränssnittet, växla artist/kompositör i listvyn,
visa/dölj-fält i redigeringsläget, helskärms-scenläge, samt "Not secure"-fältet i webbläsaren
(det styrs av webbläsaren, inte appen - men chrome://flags-fixen från tidigare bör ta bort
det också, om den är korrekt tillämpad).

## Nytt i denna omgång (Önskelista 4)

- **Buggfix: kunde inte växla mellan låtversioner.** Om du skapade två versioner som två
  separata låtar (istället för via "+ Ny version") delade de aldrig samma grupp-id, så det
  fanns ingen väg att koppla ihop dem. Ny knapp i editorn: **🔗 Länka som version av…** - välj
  vilken låt den ska bli en version av, så får båda gemensamma versionsflikar. Det går också
  att koppla loss igen om du länkat fel. En mindre bugg fixades på kuppen: artist-fältet
  kopierades inte med när en ny version skapades via "+ Ny version".
- **Rimlexikonet omarbetat i grunden.** Istället för ordgrupper med en gemensam typ hanteras nu
  varje ord som en egen post (med eget stavelseantal, taggar, favorit osv), och rim mellan ord
  uttrycks som separata **kopplingar** som kan ha flera typer samtidigt (t.ex. både perfekt rim
  OCH allitteration för "sat"/"spat"). Markera flera ord i listan → "🔗 Rimmar med varandra…" →
  kryssa i vilka typer det gäller. Sökläget grupperar nu resultat efter stavelseantal (alla
  enstaviga rim på "cat" överst, sen tvåstaviga, osv). Gammal data migreras automatiskt vid
  första starten efter uppdateringen.
- **`DEVELOPMENT.md`** - en teknisk sammanfattning av hela appens arkitektur och historik, så
  utvecklingen går att återuppta även om sammanhanget (t.ex. en Claude-konversation) skulle
  tappas bort. Uppdateras i slutet av varje större utvecklingsomgång.

## Nytt i denna omgång (Önskelista 3)

- **Dashboard** - appen öppnas nu i en startvy med stora plattor för varje modul (Bibliotek,
  Setlistor, Rimlexikon, och en gråmarkerad "Utrustning" för framtiden). 🏠-fliken i toppen tar
  dig tillbaka dit när du vill, men du behöver aldrig gå via den för att växla - flikarna
  Bibliotek/Setlistor och ✎-knappen för rimlexikonet fungerar som förut, från vilken vy som helst.
- **Rimlexikon som egen modul** - dashboardens ruta öppnar panelen direkt i **Hantera**-läget
  (den mer omfattande vyn), medan ✎-knappen i toppfältet fortfarande öppnar det snabba
  **Sök**-läget som standard när du bara vill slå upp ett rim medan du skriver.
- **Andra skärmen (`/display.html`)** - en helt egen, enkel sida byggd för en TV eller skärm
  kopplad till t.ex. en Raspberry Pi i replokalen. Visar "Nu spelas" och "Nästa" i stora
  bokstäver, med eventuell grupprubrik (t.ex. tonart/stämning) som en tagg. Uppdateras live via
  websocket så fort du bläddrar i scenläget på telefonen - ingen omladdning behövs. Adressen
  visas på dashboarden, eller gå till `http://<telefonens-ip>:8420/display.html` i vilken
  webbläsare som helst på samma nätverk.
  - Displayen är helt passiv (bara visning) - all styrning sker som förut från telefonens
    scenläge. Startar du en låt inom en setlista skickas det automatiskt till displayen; går
    du tillbaka till biblioteket utan setlista-koppling återgår displayen till vänteläge.

## Nytt i denna omgång (Önskelista 2)

- **Ny logotyp** - din egen L/M-emblem, både som appikon och i en fullständig banner
  (`public/icons/logo-banner.png`).
- **Artist-fält** - separat från kompositör (Elvis skrev sällan sina egna låtar). Filtrera
  biblioteket på artist med rullgardinen ovanför listan.
- **ⓘ Anslutning &amp; backup** - toppfältets info-knapp visar telefonens IP direkt i appen
  (ingen mer letande i Termux) och låter dig ladda ner en fullständig backup (låtar, setlistor,
  rim) som en JSON-fil.
- **Autoscroll, finjusterat**:
  - +/- -knappar istället för slidern, finare steg (1-20).
  - Knappen heter nu Pausad/Rullar - tydligare att det går att pausa och fortsätta.
  - ⚙ vid autoscroll-kontrollerna: ställ in vad som händer när låten scrollats klart -
    stanna kvar, hoppa till toppen, eller gå vidare till nästa låt i setlistan automatiskt
    efter valfri fördröjning (med en Avbryt-knapp under nedräkningen).
- **Tomrader i en refräng/vers** stör inte längre färgmarkeringen - en enstaka tomrad är bara
  en läsbarhetspaus. Det krävs numera **två** tomrader i rad för att avsluta en
  refräng/stick-färgning, så du kan dela upp en lång refräng i stycken utan att tänka på det.
- **Ackord-snabbval** - ackord du redan skrivit i låten dyker upp som klickbara chips ovanför
  textfältet, så du slipper skriva samma ackord för hand mer än en gång.
- **Rimlexikonet har nu två lägen**: **Sök** (standard när du öppnar panelen - bara ett sökfält,
  ingen lång lista i vägen) och **Hantera** (lägga till/redigera/massåtgärder/import/export).
  Sökläget har ett rent uppslag - skriv ett ord, se vad som rimmar - separat från
  radnärhetssökningen i låtar. Rim kan nu även ha ett **stavelseantal**, och exporteras som
  egen JSON-backup.
- **Dra-och-släpp** i setlist-byggaren - grepp i ⠿-handtaget och dra en rad till rätt plats
  (fungerar med både mus och touch). ▲▼-knapparna finns kvar om du föredrar dem.
- **🖨 Skriv ut setlista** - öppnar en utskriftsvänlig sida med hela spellistan (grupprubriker,
  låttexter och ackord inkluderade) - perfekt att skriva ut och ge till en gästmusiker.

## Backup

All din data ligger i `data/songs.json`, `data/setlists.json` och `data/rhymes.json`. Tre
läsbara textfiler — inget konstigt databasformat. Säkerhetskopiera dem som du vill:
`git commit`, molnsynk av mappen, en kopia då och då, eller enklast: **ⓘ-knappen i appen** →
**Ladda ner backup**, som ger dig en komplett JSON-fil med allt i ett svep. Appen skriver
aldrig direkt till filerna utan skriver till en temporär fil och byter namn atomärt, så en
avbruten skrivning ska aldrig kunna förstöra din data.

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
