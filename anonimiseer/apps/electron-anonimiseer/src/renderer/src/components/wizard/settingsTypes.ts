/**
 * Wizard-instellingen voor stap 2.
 *
 * Het doel is dat een leek dit scherm zonder uitleg kan invullen.
 * Daarom praten we niet in "entity types" en "thresholds", maar in
 * categorieën en gevoeligheids-niveaus. De vertaalslag naar de
 * Presidio-termen gebeurt pas in ``resolveEntities`` /
 * ``resolveThreshold`` vlak voor de engine-call.
 */

export type AnonymizeMode = 'pseudonymize' | 'anonymize';

export type Sensitivity = 'voorzichtig' | 'standaard' | 'streng';

export const SENSITIVITY_THRESHOLDS: Record<Sensitivity, number> = {
  voorzichtig: 0.35,
  standaard: 0.5,
  streng: 0.7,
};

/**
 * Categorie zoals de gebruiker 'm ziet. ``entityTypes`` wijst naar de
 * Presidio-namen die de engine kent. Meerdere categorieën mogen
 * overlappen (bijv. "Postcodes en adressen" dekt zowel NL_POSTCODE
 * als LOCATION); de engine dedupliceert zelf op span-niveau.
 */
export interface EntityCategory {
  id: string;
  label: string;
  description: string;
  example: string;
  entityTypes: string[];
  defaultOn: boolean;
}

export const ENTITY_CATEGORIES: EntityCategory[] = [
  {
    id: 'personen',
    label: 'Namen van personen',
    description: 'Voor- en achternamen, inclusief tussenvoegsels.',
    example: 'Jan de Vries, mevrouw van den Broek',
    entityTypes: ['PERSON'],
    defaultOn: true,
  },
  {
    id: 'email',
    label: 'E-mailadressen',
    description: 'Alle gevonden e-mailadressen.',
    example: 'jan.devries@example.nl',
    entityTypes: ['EMAIL_ADDRESS'],
    defaultOn: true,
  },
  {
    id: 'telefoon',
    label: 'Telefoonnummers',
    description: 'Nederlandse en internationale nummers.',
    example: '06-12345678, +31 20 555 1234',
    entityTypes: ['NL_PHONE_NUMBER', 'PHONE_NUMBER'],
    defaultOn: true,
  },
  {
    id: 'bsn',
    label: 'BSN (burgerservicenummer)',
    description: 'Alleen nummers die de Elfproef doorstaan.',
    example: '111222333',
    entityTypes: ['NL_BSN'],
    defaultOn: true,
  },
  {
    id: 'adres',
    label: 'Postcodes en adressen',
    description: 'Nederlandse postcodes en geografische locaties.',
    example: '6827 AV, Arnhem',
    entityTypes: ['NL_POSTCODE', 'LOCATION'],
    defaultOn: true,
  },
  {
    id: 'ids',
    label: 'ID- en bedrijfsnummers',
    description:
      'Overheids- en zorgnummers: KvK, BTW, BIG, AGB, rijbewijs, polisnummer, studenten-/personeelsnummer, OV-chipkaart, Belgisch rijksregister.',
    example: 'KvK 34567890, BIG 19912345601, polisnummer 106543210',
    entityTypes: [
      'NL_STUDENT_ID',
      'NL_EMPLOYEE_ID',
      'NL_KVK',
      'NL_BIG',
      'NL_AGB',
      'NL_BTW',
      'NL_RIJBEWIJS',
      'NL_ID_CARD',
      'NL_POLICY_NUMBER',
      'NL_OV_CHIPKAART',
      'BE_RIJKSREGISTER',
    ],
    defaultOn: true,
  },
  {
    id: 'onderwijs',
    label: 'Onderwijscodes (HAN)',
    description:
      'HAN-/hogeschool-specifieke codes: klas- en groepsnamen, vak-/cursus- en CROHO-codes.',
    example: 'Klas HBO-ICT-1A, cursus OOABDK1, CROHO 34391',
    entityTypes: ['EDU_CLASS', 'EDU_COURSE_CODE', 'EDU_CROHO'],
    defaultOn: true,
  },
  {
    id: 'financieel',
    label: 'IBAN en creditcards',
    description: 'Bankrekeningen en kaartnummers.',
    example: 'NL91 ABNA 0417 1643 00',
    entityTypes: ['IBAN_CODE', 'CREDIT_CARD', 'BIC_CODE'],
    defaultOn: true,
  },
  {
    id: 'netwerk',
    label: 'Netwerk-adressen',
    description: 'IP- en MAC-adressen. Kunnen een apparaat/persoon herleidbaar maken.',
    example: '145.97.12.233, 00:1A:2B:3C:4D:5E',
    entityTypes: ['IP_ADDRESS', 'MAC_ADDRESS'],
    defaultOn: true,
  },
  {
    id: 'organisaties',
    label: 'Organisaties',
    description: 'Bedrijfs- en instellingsnamen.',
    example: 'ABN AMRO, Radboud Universiteit',
    entityTypes: ['ORGANIZATION'],
    defaultOn: false,
  },
  {
    id: 'url',
    label: 'Links (URLs)',
    description: 'Webadressen die context kunnen weggeven.',
    example: 'https://example.com/jansen',
    entityTypes: ['URL'],
    defaultOn: false,
  },
  {
    id: 'online',
    label: 'Online identifiers (handles, accounts, wachtwoorden)',
    description:
      'Social-media handles, gebruikersnamen achter een label en wachtwoorden in testdata. Wachtwoorden worden altijd gemaskeerd, óók als de tool denkt dat het een datum of naam is.',
    example: '@jeroenvdm, Gebruikersnaam: jvdmeulen85, Wachtwoord: Zomer2026',
    entityTypes: ['SOCIAL_HANDLE', 'USERNAME', 'PASSWORD'],
    defaultOn: true,
  },
  {
    id: 'datum',
    label: 'Datums en tijden',
    description: 'Datums kunnen mensen identificeerbaar maken.',
    example: '15 april 2026, 12:30',
    entityTypes: ['DATE_TIME'],
    defaultOn: false,
  },
];

export interface WizardSettings {
  mode: AnonymizeMode;
  sensitivity: Sensitivity;
  /** Handmatig gezet door de gebruiker in "Geavanceerd". Als ``null``
   *  wordt ``SENSITIVITY_THRESHOLDS[sensitivity]`` gebruikt. */
  thresholdOverride: number | null;
  /** Map van category-id → aan/uit. */
  enabledCategories: Record<string, boolean>;
}

export function defaultWizardSettings(): WizardSettings {
  const enabledCategories: Record<string, boolean> = {};
  for (const cat of ENTITY_CATEGORIES) {
    enabledCategories[cat.id] = cat.defaultOn;
  }
  return {
    mode: 'pseudonymize',
    sensitivity: 'standaard',
    thresholdOverride: null,
    enabledCategories,
  };
}

/**
 * Converteer gebruikerskeuze naar Presidio-entiteitnamen. Lege array
 * betekent "alles uit" — dat staat de UI niet toe dus moet je als
 * caller apart checken.
 */
export function resolveEntities(settings: WizardSettings): string[] {
  const out = new Set<string>();
  for (const cat of ENTITY_CATEGORIES) {
    if (settings.enabledCategories[cat.id]) {
      for (const ent of cat.entityTypes) out.add(ent);
    }
  }
  return Array.from(out);
}

export function resolveThreshold(settings: WizardSettings): number {
  return settings.thresholdOverride ?? SENSITIVITY_THRESHOLDS[settings.sensitivity];
}
