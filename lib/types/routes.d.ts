import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicLocalOptimize, PublicTokenSaver } from './settings.js';
export declare function createApiRoutes(options: {
    getSaver: () => PublicTokenSaver;
    setSaver: (patch: unknown) => Promise<PublicTokenSaver> | PublicTokenSaver;
    getLocal: () => PublicLocalOptimize;
    setLocal: (patch: unknown) => Promise<PublicLocalOptimize> | PublicLocalOptimize;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
