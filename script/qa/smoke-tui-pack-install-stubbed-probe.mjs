import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[1];

Bun.plugin({
  name: "opentui-runtime-module-stubs",
  setup(build) {
    build.module("opentui:runtime-module:%40opentui%2Fsolid", () => ({
      loader: "js",
      contents: `
        export function createComponent(Comp, props) { return Comp(props); }
        export function insert(parent, accessor) { 
          parent.children.push(accessor);
        }
        export function effect(fn) { 
          let prev = {};
          globalThis.__mockEffects.push(() => { prev = fn(prev) || prev; });
          globalThis.__mockEffects[globalThis.__mockEffects.length - 1]();
        }
        export function memo(fn) { return fn; }
        export function createElement(tag) { return { tag, children: [], props: {} }; }
        export function setProp(node, name, value) { 
          node.props[name] = value; 
          return value;
        }
        export function insertNode(parent, node) { parent.children.push(node); }
        export function createTextNode(text) { return { text }; }
      `
    }));
    build.module("opentui:runtime-module:solid-js", () => ({
      loader: "js",
      contents: `
        export function createSignal(initial) {
          let value = initial;
          const read = () => value;
          const write = (newVal) => {
            value = newVal;
            for (const fn of globalThis.__mockEffects) fn();
          };
          return [read, write];
        }
        export function createMemo(fn) {
          let value;
          globalThis.__mockEffects.push(() => { value = fn(); });
          globalThis.__mockEffects[globalThis.__mockEffects.length - 1]();
          return () => value;
        }
        export function createEffect(fn) {
          globalThis.__mockEffects.push(fn);
          fn();
        }
      `
    }));
  }
});

globalThis.__mockEffects = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const compiled = await import(pathToFileURL(join(packageRoot, "dist/tui-compiled/mailbox-sidebar.js")).href);
assert(
  typeof compiled.createMailboxSidebarController === "function",
  "compiled TUI export shape is invalid",
);

const controller = compiled.createMailboxSidebarController({
  getMailbox: () => ({
    inboundUnread: 0,
    inboundProcessed: 0,
    outboundUnresolved: 0,
    outboundRead: 0,
    outboundFailed: 0,
    projects: [
      {
        projectId: "online-project",
        label: "online-project-with-a-very-long-name",
        presence: "online",
        statusText: "online",
        dotColor: "success"
      },
      {
        projectId: "offline-project",
        label: "offline-project",
        presence: "lastSeen",
        statusText: "1 day ago",
        dotColor: "muted"
      }
    ]
  }),
  getPrefs: () => ({ rememberCollapsed: false, header: { label: "Mailbox", showVersion: true } }),
  getVersion: () => "9.9.9",
  badgeTextColor: () => undefined,
  initialCollapsed: true,
});

const element = compiled.MailboxSidebar({ controller, theme: {} });

function stringify(node) {
  if (typeof node === "function") return stringify(node());
  if (Array.isArray(node)) return node.map(stringify).join("");
  if (node && node.text !== undefined) return node.text;
  if (node && node.children) return node.children.map(stringify).join("");
  return String(node);
}

const initialOutput = stringify(element);
assert(initialOutput.includes("▶"), "initial output missing collapse marker");

controller.toggle();

const expandedOutput = stringify(element);
assert(expandedOutput.includes("▼"), "expanded output missing collapse marker");
assert(initialOutput !== expandedOutput, "reactivity proof failed: output did not change after signal write");
for (const expected of ["In", "Unread", "Done", "Out", "Pending", "Read", "Failed", "Projects", "(1/2)", "1 day ago"]) {
  assert(expandedOutput.includes(expected), `expanded output missing ${expected}`);
}
assert(!expandedOutput.includes("v9.9.9"), "expanded output retained the version string");

function nodes(node) {
  if (typeof node === "function") return nodes(node());
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...(node.children ? node.children.flatMap(nodes) : [])];
}

assert(
  nodes(element).some((node) => node.props?.wrapMode === "none" && node.props?.truncate === true),
  "project label is not configured for single-line truncation",
);
assert(
  nodes(element).some((node) => node.props?.justifyContent === "space-between" && node.props?.gap === 1),
  "project row does not preserve a gap between truncated label and status",
);

controller.toggle();

const recollapsedOutput = stringify(element);
assert(recollapsedOutput.includes("▶"), "recollapsed output missing collapse marker");
assert(!recollapsedOutput.includes("Unread"), "recollapsed output retained expanded rows");

const emptyController = compiled.createMailboxSidebarController({
  getMailbox: () => ({
    inboundUnread: 0,
    inboundProcessed: 0,
    outboundUnresolved: 0,
    outboundRead: 0,
    outboundFailed: 0,
    projects: [],
  }),
  getPrefs: () => ({ header: { label: "Mailbox", showVersion: true }, rememberCollapsed: true }),
  getVersion: () => "9.9.9",
  badgeTextColor: () => "white",
  initialCollapsed: false,
  onToggle: () => {},
  requestRender: () => {},
});
const emptyElement = compiled.MailboxSidebar({ controller: emptyController, theme: {} });
assert(stringify(emptyElement).includes("No connected projects"), "empty project message is missing");
assert(
  !nodes(emptyElement).some((node) => node.tag === "text" && node.children?.length === 0),
  "empty project message produces placeholder text elements",
);
assert(
  !nodes(emptyElement).some(
    (node) => node.props?.justifyContent === "space-between" && stringify(node).includes("No connected projects"),
  ),
  "empty project message is forced through the three-column project row layout",
);

console.log("stubbed runtime probe loaded the compiled TUI path and proved bidirectional layout reactivity");
