#!/data/data/com.termux/files/usr/bin/bash
# Hämtar senaste koden från GitHub och startar om servern.
# Kör detta - INTE "pkg update/upgrade" - för att uppdatera appen.
# Användning: bash update.sh   (eller: chmod +x update.sh && ./update.sh)

set -e
cd "$(dirname "$0")"

echo "Hämtar senaste koden från GitHub..."
git pull

echo "Kollar om nya beroenden tillkommit..."
npm install

echo "Startar servern..."
npm start
