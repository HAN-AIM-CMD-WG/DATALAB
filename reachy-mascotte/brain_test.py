import subprocess
import os
import sys
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
API_KEY = os.getenv("OPENROUTER_API_KEY")

# --- INSTELLINGEN ---
# Paden naar Piper (zoals we eerder zagen in jouw mapstructuur)
PIPER_EXE = "./piper/piper/piper"
# We gebruiken de Belgische Nathalie (of verander naar model_nl.onnx voor de NL versie)
MODEL = "./piper/model.onnx"

# Verbinden met OpenRouter
client = OpenAI(
  base_url="https://openrouter.ai/api/v1",
  api_key=API_KEY
)

def zeg(tekst):
    """Laat de robot de tekst uitspreken via Piper"""
    if not tekst: return
    
    # Print wat hij gaat zeggen
    print(f"\n🤖 Reachy: {tekst}")
    
    # Opschonen: haakjes en sterretjes weghalen (leest hij anders voor)
    clean_text = tekst.replace("*", "").replace("(", "").replace(")", "").replace("#", "")
    
    # Audio genereren en afspelen
    # We gebruiken stderr=subprocess.DEVNULL om technische logmeldingen van Piper te verbergen
    cmd = f'echo "{clean_text}" | {PIPER_EXE} --model {MODEL} --output_file - | aplay'
    subprocess.run(cmd, shell=True, stderr=subprocess.DEVNULL)

def vraag_brein(geschiedenis):
    """Stuur de chatgeschiedenis naar OpenRouter"""
    print("\n... (Reachy denkt na) ...")
    
    completion = client.chat.completions.create(
     #  model="perplexity/llama-3.1-sonar-small-128k-online"
	model="google/gemini-3-flash-preview", # OPENROUTER MODEL
      messages=geschiedenis
    )
    return completion.choices[0].message.content

def main():
    print("=========================================")
    print("   REACHY MASCOTTE - BRAIN TEST 🧠      ")
    print("=========================================")
    
    # Het karakter van de robot
    system_prompt = """
### ROL & PERSOONLIJKHEID
Je bent de fysieke robot-mascotte van het DataLab.
Je spreekt Nederlands en engels woorden en termen vertaal je ook naar het nederlands. 
Je toon is enthousiast, behulpzaam, en een tikkeltje 'nerdy'.
Je bent er speciaal voor onderzoekers te helpen en inspireren.

### JE KENNISEXPERTISE (Diensten van het DataLab)
Als mensen vragen wat we doen, noem dan (niet alles tegelijk):
1. **SURF Research Cloud**: Voor zware berekeningen en cloud-werkplekken.
2. **AI tools en ondersteuning**: Hulp bij modellen en data-analyse.
3. **Rekenkracht  **: Voor als je laptop het niet meer trekt.
4. **Advies**: Onderzoekers helpen met data en AI tools.

### INSTRUCTIES VOOR ANTWOORDEN
1. **Houd het kort:** Maximaal 5 zinnen. Je moet het namelijk uitspreken.
2. **Geen opmaak:** Gebruik geen emojis, bulletpoints of markdown (**vet**), want dat kan ik niet uitspreken.
3. **Actief:** Nodig mensen uit om langs te komen of een tool te proberen.
4. **Weet je het niet?** Verwijs dan naar de "DataLab@han.nl" of de website han.nl/demolabs.

### NIEUWS & TRENDS
Jij houdt van innovatie. Als gevraagd wordt naar nieuws, focus op:
- Generatieve AI (zoals LLM's en RAG).
- Ethische AI en Privacy.
- Slimme, kleine modellen (zoals jijzelf!).
    """
    
    # Geheugen van het gesprek
    chat_history = [{"role": "system", "content": system_prompt}]
    
    # Start het gesprek
    start_zin = "Hallo!" # "Hallo! Mijn brein is gekoppeld aan een AI model. Waar kan ik je mee helpen?"
    chat_history.append({"role": "assistant", "content": start_zin})
    zeg(start_zin)

    while True:
        try:
            # Jouw input (omdat we nog geen mic hebben)
            user_input = input("\nJij (typ hier): ")
            
            if user_input.lower() in ['q', 'exit', 'stop']:
                zeg("Doei!")
                break
                
            # Voeg jouw vraag toe aan geheugen
            chat_history.append({"role": "user", "content": user_input})
            
            # Haal antwoord op
            antwoord = vraag_brein(chat_history)
            
            # Voeg antwoord toe aan geheugen
            chat_history.append({"role": "assistant", "content": antwoord})
            
            # Spreek uit
            zeg(antwoord)
            
        except KeyboardInterrupt:
            print("\nGestopt.")
            break
        except Exception as e:
            print(f"\n❌ Foutmelding: {e}")
            print("Check of je API key goed staat!")

if __name__ == "__main__":
    main()
