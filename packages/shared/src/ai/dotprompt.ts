/**
 * Server prompt templates (architecture §3.2, §5.3). The sources are the Dotprompt files in
 * `ai/templates/*.prompt`; they are copied to the Firebase console with a semver id suffix and the
 * client calls them by id with template variables only, so the personas and the system prompt
 * never ship in the client bundle. This module holds the ids and a small renderer for the subset
 * of Handlebars the templates use (`{{var}}`, `{{#if var}}…{{else}}…{{/if}}`, `{{role "…"}}`,
 * `{{history}}`), used by tests to check that the builders fill every declared variable and that
 * the prompt reads as intended. TODO(M38): the active ids come from Remote Config.
 */

export const PROMPT_TEMPLATE_IDS = {
  /** npc-runtime.md §1: one NPC dialogue turn (template chat, cloud only). */
  npcTurn: "npc-turn-v1-0-0",
  /** npc-runtime.md §3: 4 cached openers per NPC × language × level × time × friendship band. */
  npcOpener: "npc-opener-v1-0-0",
} as const;
export type PromptTemplateName = keyof typeof PROMPT_TEMPLATE_IDS;

/** The template variables a builder produces (Handlebars falsy values hide `{{#if}}` blocks). */
export type TemplateVariables = Record<string, string | number | boolean>;

export interface DotpromptSource {
  frontmatter: string;
  body: string;
}

export function splitDotprompt(source: string): DotpromptSource {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!m) throw new Error("not a Dotprompt source (missing frontmatter)");
  return { frontmatter: m[1]!, body: m[2]! };
}

export interface DeclaredInput {
  name: string;
  optional: boolean;
  type: string;
}

/** The variables under `input.schema` (Picoschema, one level deep). */
export function declaredInputs(frontmatter: string): DeclaredInput[] {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^input:\s*$/.test(l));
  if (start < 0) return [];
  const out: DeclaredInput[] = [];
  let inSchema = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^ {2}schema:\s*$/.test(line)) {
      inSchema = true;
      continue;
    }
    if (/^ {2}\S/.test(line)) inSchema = false;
    const m = /^ {4}(\w+)(\?)?:\s*(\w+)/.exec(line);
    if (inSchema && m) out.push({ name: m[1]!, optional: m[2] === "?", type: m[3]! });
  }
  return out;
}

/** A frontmatter scalar such as `model` or `maxOutputTokens`. */
export function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const m = new RegExp(`^\\s*${key}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, "m").exec(frontmatter);
  return m?.[1];
}

export interface RenderOptions {
  /** Rendered in place of `{{history}}`. */
  history?: string;
}

type Node = { kind: "text"; text: string } | { kind: "var"; name: string } | { kind: "if"; name: string; then: Node[]; else: Node[] };

function parse(body: string): Node[] {
  const tags = /\{\{\s*(#if\s+([\w.]+)|else|\/if|role\s+"(\w+)"|history|([\w.]+))\s*\}\}/g;
  const root: Node[] = [];
  const stack: { node: Extract<Node, { kind: "if" }>; inElse: boolean }[] = [];
  const target = () => {
    const top = stack[stack.length - 1];
    return top ? (top.inElse ? top.node.else : top.node.then) : root;
  };
  let last = 0;
  for (let m = tags.exec(body); m; m = tags.exec(body)) {
    if (m.index > last) target().push({ kind: "text", text: body.slice(last, m.index) });
    last = m.index + m[0].length;
    const tag = m[1]!;
    if (m[2]) {
      const node: Extract<Node, { kind: "if" }> = { kind: "if", name: m[2], then: [], else: [] };
      target().push(node);
      stack.push({ node, inElse: false });
    } else if (tag === "else") {
      const top = stack[stack.length - 1];
      if (!top) throw new Error("{{else}} outside {{#if}}");
      top.inElse = true;
    } else if (tag === "/if") {
      if (!stack.pop()) throw new Error("unbalanced {{/if}}");
    } else if (m[3]) target().push({ kind: "text", text: `[${m[3]}]` });
    else if (tag === "history") target().push({ kind: "var", name: "@history" });
    else target().push({ kind: "var", name: m[4]! });
  }
  if (stack.length) throw new Error("unclosed {{#if}}");
  if (last < body.length) target().push({ kind: "text", text: body.slice(last) });
  return root;
}

/** Variable names a template body references (outside `{{history}}`). */
export function referencedVariables(body: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === "var" && n.name !== "@history") names.add(n.name);
      if (n.kind === "if") {
        names.add(n.name);
        walk(n.then);
        walk(n.else);
      }
    }
  };
  walk(parse(body));
  return [...names];
}

/**
 * Renders a template body the way Handlebars does for this subset: missing or falsy variables
 * render empty and hide `{{#if}}` blocks; roles render as `[system]` / `[user]` markers.
 */
export function renderTemplateBody(body: string, vars: Readonly<TemplateVariables>, options: RenderOptions = {}): string {
  const truthy = (v: unknown) => v !== undefined && v !== false && v !== "" && v !== 0 && v !== null;
  const render = (nodes: Node[]): string =>
    nodes
      .map((n) => {
        if (n.kind === "text") return n.text;
        if (n.kind === "var") return n.name === "@history" ? (options.history ?? "") : String(vars[n.name] ?? "");
        return render(truthy(vars[n.name]) ? n.then : n.else);
      })
      .join("");
  return render(parse(body));
}
