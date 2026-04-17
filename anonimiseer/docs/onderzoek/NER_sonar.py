from transformers import pipeline
import torch

pipe_sonar = pipeline("token-classification",
                      model="wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
                      aggregation_strategy="simple")


def is_full_word(ent, text):
    """
    Check of ent["word"] een volledig woord is in text
    """
    start, end = ent["start"], ent["end"]

    left_boundary = start == 0 or not text[start-1].isalnum()
    right_boundary = end == len(text) or not text[end].isalnum()
    return left_boundary and right_boundary

def vind_namen_transformers(pipeline, text):
    ents = pipeline(text)
    result = []
    for ent in ents:
        if ent["entity_group"].lower() != "per":
            continue
        
        # neem de originele slice uit de tekst
        word_in_text = text[ent["start"]:ent["end"]]
        
        # check of dit een volledig woord is
        if is_full_word({'start': ent['start'], 'end': ent['end']}, text):
            result.append(word_in_text.strip())  # strip spaties toegevoegd door aggregation
    return result

print(vind_namen_transformers(pipe_sonar, "Bushalte ontbreekt op de kaart."))
print(vind_namen_transformers(pipe_sonar, "Mark Rutte bezocht Amsterdam."))
print(vind_namen_transformers(pipe_sonar, "mvg Dhr. van Dijk"))