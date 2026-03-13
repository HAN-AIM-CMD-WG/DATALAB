#!/bin/bash

# 1. Ga naar de juiste map
cd /home/medialab/reachy_project

# 2. Activeer de virtuele omgeving
source venv/bin/activate

# 3. Start de robot (ALSA warnings onderdrukt)
echo "Reachy Mascotte wordt gestart..."
python3 mascotte.py 2>/dev/null

# 4. Wacht op Enter voordat het scherm sluit (handig bij errors)
echo ""
echo "------------------------------------------------"
read -p "Druk op Enter om dit venster te sluiten..."
