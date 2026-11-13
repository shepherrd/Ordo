import { version } from "../../package.json";

// Electron launched with a JS entry point reports Electron's own version.
// Bind both development and packaged provenance to Ordo's compiled version.
export const applicationVersion = version;
