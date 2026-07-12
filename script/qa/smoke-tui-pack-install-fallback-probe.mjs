import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[1];
const tui = await import(pathToFileURL(join(packageRoot, "dist/tui.js")).href);
if (typeof tui.default?.tui !== "function") {
  throw new Error("raw fallback default export shape is invalid");
}
console.log("raw fallback probe loaded the TUI entry");
