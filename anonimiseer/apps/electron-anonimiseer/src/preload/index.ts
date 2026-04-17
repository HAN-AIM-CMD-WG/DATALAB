/**
 * Preload-bridge.
 *
 * Dit is de enige plek waar main-proces capabilities naar de renderer
 * exposed worden. We volgen strikt het principe van "kleinst mogelijke
 * oppervlakte": alleen wat de UI nu écht nodig heeft.
 *
 * Voor nu is de API leeg (alleen `version`-info). De functies voor de
 * engine-bridge, file-dialogen en audit-log voegen we toe in latere
 * fases, telkens met een expliciete entry hier.
 */

import { contextBridge } from 'electron';
import type { AnonimiseerApi } from '@shared/api';

const api: AnonimiseerApi = {
  version: {
    app: process.env.npm_package_version ?? '0.1.0',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  },
};

// Expose onder globalThis.anonimiseer in de renderer.
contextBridge.exposeInMainWorld('anonimiseer', api);
