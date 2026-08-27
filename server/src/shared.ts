/*
 * Re-export of the shared timeline model, so server code can import it as
 * `./shared.js` instead of reaching across the workspace with a long relative
 * path. The build compiles `shared/` alongside `server/` (see tsconfig
 * rootDir), which keeps this a plain relative import at runtime too - no
 * bundler, no path aliases, nothing to resolve at startup.
 */
export * from "../../shared/src/index.js";
