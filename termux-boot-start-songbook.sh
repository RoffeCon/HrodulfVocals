#!/data/data/com.termux/files/usr/bin/bash
# Termux:Boot-skript - startar Hrodulfus Songbook automatiskt när telefonen startar om.
#
# INSTALLATION:
# 1. Installera appen "Termux:Boot" från F-Droid (separat app, samma utvecklare som Termux).
# 2. Öppna Termux:Boot en gång så den skapar mappen ~/.termux/boot/
# 3. Kopiera den här filen dit:
#      mkdir -p ~/.termux/boot
#      cp HrodulfVocals/termux-boot-start-songbook.sh ~/.termux/boot/start-songbook.sh
#      chmod +x ~/.termux/boot/start-songbook.sh
# 4. Starta om telefonen en gång för att testa.
#
# OBS: justera sökvägen nedan om ditt repo inte heter HrodulfVocals eller ligger
# någon annanstans än home-mappen i Termux.

termux-wake-lock

cd ~/HrodulfVocals || exit 1
nohup npm start > ~/songbook-boot.log 2>&1 &
