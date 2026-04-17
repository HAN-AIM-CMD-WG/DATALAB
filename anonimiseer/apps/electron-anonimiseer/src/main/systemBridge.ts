/**
 * Best-effort detectie van CPU/RAM/GPU.
 *
 * Doel: in de Model Manager kunnen tonen of een model comfortabel op
 * deze machine past. Dit is *adviserend*; we blokkeren niets.
 *
 * Cross-platform GPU-detectie is gevoelig — we doen alleen lichte
 * subprocess-aanroepen die op een gemiddelde install al beschikbaar
 * zijn (system_profiler, nvidia-smi, wmic). Geen extra dependencies.
 */

import { ipcMain } from 'electron';
import { exec } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { SystemInfo } from '@shared/api';

const execAsync = promisify(exec);

const MB = 1024 * 1024;

async function detectGpuMac(): Promise<SystemInfo['gpu']> {
  // Apple Silicon: unified memory; we melden RAM als VRAM.
  // Intel: meestal Intel Iris/AMD discrete; we proberen system_profiler.
  try {
    const { stdout } = await execAsync(
      'system_profiler SPDisplaysDataType -json',
      { timeout: 4000 }
    );
    const parsed = JSON.parse(stdout) as {
      SPDisplaysDataType?: Array<{
        sppci_model?: string;
        spdisplays_vram?: string;
        spdisplays_vram_shared?: string;
        sppci_bus?: string;
      }>;
    };
    const gpu = parsed.SPDisplaysDataType?.[0];
    if (!gpu) return null;
    const isAppleSilicon = os.cpus()[0]?.model?.includes('Apple') ?? false;
    const name = gpu.sppci_model ?? 'GPU';
    const vramStr = gpu.spdisplays_vram ?? gpu.spdisplays_vram_shared ?? null;
    const vramMb = vramStr ? parseVramString(vramStr) : null;
    return {
      name,
      vramMb: isAppleSilicon ? Math.round(os.totalmem() / MB) : vramMb,
      kind: isAppleSilicon ? 'apple-silicon' : 'discrete',
    };
  } catch {
    return null;
  }
}

async function detectGpuLinux(): Promise<SystemInfo['gpu']> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      { timeout: 4000 }
    );
    const first = stdout.split('\n')[0]?.trim();
    if (first) {
      const [name, mem] = first.split(',').map((s) => s.trim());
      return { name: name ?? 'NVIDIA GPU', vramMb: Number(mem) || null, kind: 'discrete' };
    }
  } catch {
    // valt door naar lspci
  }
  try {
    const { stdout } = await execAsync('lspci | grep -i vga', { timeout: 2000 });
    const line = stdout.split('\n')[0];
    if (line) {
      return { name: line.split(':').slice(2).join(':').trim(), vramMb: null, kind: 'integrated' };
    }
  } catch {
    /* niets gevonden */
  }
  return null;
}

async function detectGpuWindows(): Promise<SystemInfo['gpu']> {
  try {
    const { stdout } = await execAsync(
      'wmic path win32_videocontroller get name,AdapterRAM /format:csv',
      { timeout: 4000 }
    );
    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('Node'));
    const first = lines[0]?.split(',');
    if (!first || first.length < 3) return null;
    const ram = Number(first[1]);
    const name = first[2];
    return {
      name: name ?? 'GPU',
      vramMb: Number.isFinite(ram) && ram > 0 ? Math.round(ram / MB) : null,
      kind: 'discrete',
    };
  } catch {
    return null;
  }
}

function parseVramString(raw: string): number | null {
  // "8 GB" / "8192 MB"
  const m = /([\d.]+)\s*(GB|MB)/i.exec(raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return m[2].toUpperCase() === 'GB' ? Math.round(value * 1024) : Math.round(value);
}

async function gatherInfo(): Promise<SystemInfo> {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ?? 'onbekend';
  let gpu: SystemInfo['gpu'] = null;
  if (process.platform === 'darwin') gpu = await detectGpuMac();
  else if (process.platform === 'linux') gpu = await detectGpuLinux();
  else if (process.platform === 'win32') gpu = await detectGpuWindows();
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel,
    cpuCores: cpus.length,
    totalMemMb: Math.round(os.totalmem() / MB),
    freeMemMb: Math.round(os.freemem() / MB),
    gpu,
  };
}

let cached: SystemInfo | null = null;
let cacheTime = 0;
const CACHE_MS = 30_000;

export function registerSystemBridge(): void {
  ipcMain.handle('system:info', async (): Promise<SystemInfo> => {
    const now = Date.now();
    if (cached && now - cacheTime < CACHE_MS) return cached;
    cached = await gatherInfo();
    cacheTime = now;
    return cached;
  });
}
