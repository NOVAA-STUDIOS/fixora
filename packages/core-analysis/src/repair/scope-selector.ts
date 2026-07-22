import type { Language } from '@fixora/shared-types';
import type { Node } from 'web-tree-sitter';

import type { RepairScope, RepairScopeLevel } from '../analyzer.js';

/**
 * The AST repair-scope selector (Repair Context Engine v2).
 *
 * A repair must be generated against the SMALLEST region that (a) parses on its own and (b) can be
 * spliced back without breaking the file. Too small — an object property, a bare sub-expression, a
 * method signature — and the model receives a fragment that cannot compile and returns a patch the
 * parser rejects (the TS2322-in-an-object-literal failure). Too large — the whole module for a
 * one-line fix — and it generates far more code than the change needs.
 *
 * The rule that satisfies both: walk UP from the finding to the smallest ancestor whose node type is a
 * *statement or declaration* (or a function/class/module above them). Those are exactly the nodes that
 * are members of a statement list — a program body, a block, a class body — so each one parses as a
 * standalone program AND can be replaced wholesale while its container stays valid. A fragment that is
 * NOT such a node (a `pair`, an argument, a `<Tag>` attribute, a method definition on its own) is never
 * selected; the walk continues up until a real scope is reached. That is the hierarchy in the brief —
 * Token → Expression → Statement → Declaration → Function → Class → Module — landing on the first level
 * that independently compiles.
 */

/**
 * Node types that ARE a self-contained scope, with the hierarchy level they sit at. Anything not in
 * this map is a fragment: the walk skips it and keeps climbing. An exported/decorated declaration is
 * registered at its wrapper (see `isSkippable`) so the model sees and returns the full public form.
 */
const TS_JS_SCOPES: Record<string, RepairScopeLevel> = {
  expression_statement: 'statement',
  if_statement: 'statement',
  for_statement: 'statement',
  for_in_statement: 'statement',
  while_statement: 'statement',
  do_statement: 'statement',
  switch_statement: 'statement',
  try_statement: 'statement',
  return_statement: 'statement',
  throw_statement: 'statement',
  break_statement: 'statement',
  continue_statement: 'statement',
  labeled_statement: 'statement',
  with_statement: 'statement',
  import_statement: 'statement',
  lexical_declaration: 'declaration',
  variable_declaration: 'declaration',
  interface_declaration: 'declaration',
  type_alias_declaration: 'declaration',
  enum_declaration: 'declaration',
  export_statement: 'declaration',
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  program: 'module',
};

const PYTHON_SCOPES: Record<string, RepairScopeLevel> = {
  expression_statement: 'statement',
  if_statement: 'statement',
  for_statement: 'statement',
  while_statement: 'statement',
  with_statement: 'statement',
  try_statement: 'statement',
  return_statement: 'statement',
  raise_statement: 'statement',
  assert_statement: 'statement',
  import_statement: 'statement',
  import_from_statement: 'statement',
  global_statement: 'statement',
  delete_statement: 'statement',
  function_definition: 'function',
  decorated_definition: 'function',
  class_definition: 'class',
  module: 'module',
};

function scopeMap(language: Language): Record<string, RepairScopeLevel> {
  if (language === 'python') return PYTHON_SCOPES;
  return TS_JS_SCOPES; // typescript / javascript (tsx uses the same node types)
}

/**
 * A node is skippable — not registered as its own scope — when a wrapper node should represent it
 * instead: an `export …`/decorated declaration is grounded on the wrapper so the repair keeps the
 * `export` keyword and decorators rather than risk duplicating or dropping them.
 */
function isSkippable(node: Node): boolean {
  const parent = node.parent;
  if (parent === null) return false;
  return parent.type === 'export_statement' || parent.type === 'decorated_definition';
}

/** All scope-eligible node ranges in a tree, each tagged with its hierarchy level. */
export function collectScopes(root: Node, language: Language): RepairScope[] {
  const map = scopeMap(language);
  const scopes: RepairScope[] = [];
  const visit = (node: Node): void => {
    const level = map[node.type];
    if (level !== undefined && level !== 'module' && !isSkippable(node)) {
      scopes.push({
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        level,
      });
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child !== null) visit(child);
    }
  };
  visit(root);
  return scopes;
}

/**
 * The smallest scope containing `line` — the tightest region that still compiles independently. Ties
 * (identical spans) resolve to the lower level, so a `statement` wins over the `declaration` that
 * happens to share its bounds. Returns null when nothing does (a blank line, or a language with no
 * scope map).
 */
export function smallestScopeContaining(
  scopes: readonly RepairScope[],
  line: number,
): RepairScope | null {
  let best: RepairScope | null = null;
  for (const s of scopes) {
    if (line < s.startLine || line > s.endLine) continue;
    if (best === null) {
      best = s;
      continue;
    }
    const span = s.endLine - s.startLine;
    const bestSpan = best.endLine - best.startLine;
    if (span < bestSpan) best = s;
  }
  return best;
}
