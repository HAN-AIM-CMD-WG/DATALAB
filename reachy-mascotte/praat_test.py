import subprocess
import os
import sys

# --- INSTELLINGEN ---
# Uitleg pad: ./piper (jouw map) / piper (de uitgepakte map) / piper (het programma)
PIPER_EXE = "./piper/piper/piper" 
# De stem staat in de eerste 'piper' map
MODEL = "./piper/model.onnx"

def zeg_iets(tekst):
    if not tekst: return

    print(f"🤖 Reachy zegt: {tekst}")
    
    # Check of de bestanden bestaan (handig voor debugging)
    if not os.path.exists(PIPER_EXE):
        print(f"FOUT: Kan piper niet vinden op: {PIPER_EXE}")
        return
    if not os.path.exists(MODEL):
        print(f"FOUT: Kan stemmodel niet vinden op: {MODEL}")
        return

    # Commando: tekst -> piper -> aplay
    cmd = f'echo "{tekst}" | {PIPER_EXE} --model {MODEL} --output_file - | aplay'
    
    try:
        subprocess.run(cmd, shell=True, check=True)
    except Exception as e:
        print(f"Fout bij afspelen: {e}")

if __name__ == "__main__":
    print("=========================================")
    print("   REACHY STEM TEST (Nathalie - NL)      ")
    print("=========================================")
    print("Typ een zin en druk op Enter.")
    print("Typ 'q' om te stoppen.")
    print("-----------------------------------------")
    
    zeg_iets("Hallo DataLab! Mijn stem systeem is nu actief.")
    
    while True:
        try:
            zin = input("\nTyp iets: ")
            if zin.lower() in ['q', 'exit']:
                break
            zeg_iets(zin)
        except KeyboardInterrupt:
            break
    
    print("\nDoei!")
