#!/data/data/com.termux/files/usr/bin/bash
# Termux:Widget-skript - lägg en genväg på hemskärmen som startar/startar om
# servern med EN knapptryckning, utan att du behöver öppna Termux-terminalen alls.
#
# INSTALLATION:
# 1. Installera appen "Termux:Widget" från F-Droid (separat app, samma utvecklare).
# 2. I Termux: mkdir -p ~/.shortcuts
# 3. Kopiera den här filen dit:
#      cp HrodulfVocals/termux-widget-start-songbook.sh ~/.shortcuts/Starta\ LyricsMaster.sh
#      chmod +x ~/.shortcuts/Starta\ LyricsMaster.sh
# 4. Lägg till Termux:Widget-widgeten på hemskärmen (långtryck på hemskärmen -> Widgets).
#    Genvägen "Starta LyricsMaster" dyker upp där, redo att tryckas på.
#
# Filnamnet (efter cp-kommandot ovan) blir texten som visas i widgeten.

pkill -f "node server.js" 2>/dev/null
sleep 1
cd ~/HrodulfVocals || exit 1
termux-wake-lock
nohup npm start > ~/songbook-boot.log 2>&1 &
termux-toast "LyricsMaster startar…"
