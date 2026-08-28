/**
 * Eén plek die weet waar de engine draait en hoe de app zich legitimeert.
 *
 * De app praat uitsluitend met de engine die zij zélf heeft gestart. Bij het
 * starten genereert ``engineProcess`` een geheim token, geeft dat mee aan het
 * kindproces, en registreert het hier. Alle bridges halen hun URL en headers
 * vervolgens hier op.
 *
 * Waarom dit nodig is: zonder token accepteert de app elk proces dat toevallig
 * op poort 8765 luistert als "de engine". Dat proces krijgt daarmee de
 * volledige inhoud van elk document dat de gebruiker erin sleept.
 *
 * In development spawnt de app niets — de ontwikkelaar start uvicorn zelf.
 * Dan is er geen token en werkt alles zoals voorheen. De override via
 * ``ANONIMISEER_ENGINE_URL`` geldt daarom óók alleen in development: in een
 * geïnstalleerde app zou een environment-variabele anders alle documenten naar
 * een externe host kunnen sturen.
 */

import { app } from 'electron';

const DEFAULT_URL = 'http://127.0.0.1:8765';

let managedUrl: string | null = null;
let authToken: string | null = null;

/** Aangeroepen door ``engineProcess`` zodra de eigen engine gezond is. */
export function setEngineEndpoint(url: string, token: string): void {
  managedUrl = url;
  authToken = token;
}

export function clearEngineEndpoint(): void {
  managedUrl = null;
  authToken = null;
}

export function engineUrl(): string {
  if (managedUrl !== null) return managedUrl;
  if (app.isPackaged) return DEFAULT_URL;
  return process.env.ANONIMISEER_ENGINE_URL ?? DEFAULT_URL;
}

/**
 * Headers voor een engine-aanroep, inclusief het token als we de engine zelf
 * beheren. ``extra`` wint niet van het token — dat is opzet.
 */
export function engineHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (authToken !== null) {
    headers['x-engine-token'] = authToken;
  }
  return headers;
}
