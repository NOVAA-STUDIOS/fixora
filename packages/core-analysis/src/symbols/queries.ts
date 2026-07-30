import type { Language, SymbolKind } from '@fixora/shared-types';

/**
 * Per-language tree-sitter queries. Each symbol pattern captures the whole declaration as `@symbol`
 * (that is the range used for enclosing-symbol lookup) and the name node under a capture *named
 * after the kind* (`@function`, `@class`, …), so a single pass yields both the span and the kind.
 *
 * The grammars disagree on node and field names — that divergence is the whole tax of supporting
 * three languages, and it is contained here, behind one extraction pass (TDD §5.2). Correctness is
 * pinned by the per-language conformance tests, not by trust.
 */

/** Capture names that denote a symbol's kind (everything except the structural `@symbol`). */
export const SYMBOL_KIND_CAPTURES: readonly SymbolKind[] = [
  'function',
  'method',
  'class',
  'interface',
  'struct',
];

// The `(variable_declarator ... value: (call_expression arguments: (arguments (arrow_function))))`
// patterns cover a component wrapped in exactly one higher-order call — `memo(fn)`, `forwardRef(fn)`,
// `observer(fn)` — a common, real React shape. Measured: `export const Counter = memo(({ start }) =>
// {...})` previously produced ZERO symbols for the whole file (the arrow function's parent is
// `call_expression`, not `variable_declarator`, so the existing direct-value pattern never matched),
// so `enclosingSymbol` returned `undefined` for every finding inside it — no name in the Problems
// panel, no repair scope, weaker finding-id grounding. Deliberately narrow: exactly one level of
// wrapping, first argument only — not a general "unwrap anything" resolver.
export const SYMBOL_QUERIES: Record<Language, string> = {
  typescript: `
    (function_declaration name: (identifier) @function) @symbol
    (method_definition name: (property_identifier) @method) @symbol
    (class_declaration name: (type_identifier) @class) @symbol
    (interface_declaration name: (type_identifier) @interface) @symbol
    (variable_declarator name: (identifier) @function value: (arrow_function)) @symbol
    (variable_declarator name: (identifier) @function value: (function_expression)) @symbol
    (variable_declarator name: (identifier) @function value: (call_expression arguments: (arguments . (arrow_function)))) @symbol
    (variable_declarator name: (identifier) @function value: (call_expression arguments: (arguments . (function_expression)))) @symbol
  `,
  javascript: `
    (function_declaration name: (identifier) @function) @symbol
    (method_definition name: (property_identifier) @method) @symbol
    (class_declaration name: (identifier) @class) @symbol
    (variable_declarator name: (identifier) @function value: (arrow_function)) @symbol
    (variable_declarator name: (identifier) @function value: (function_expression)) @symbol
    (variable_declarator name: (identifier) @function value: (call_expression arguments: (arguments . (arrow_function)))) @symbol
    (variable_declarator name: (identifier) @function value: (call_expression arguments: (arguments . (function_expression)))) @symbol
  `,
  python: `
    (function_definition name: (identifier) @function) @symbol
    (class_definition name: (identifier) @class) @symbol
  `,
  go: `
    (function_declaration name: (identifier) @function) @symbol
    (method_declaration name: (field_identifier) @method) @symbol
    (type_declaration (type_spec name: (type_identifier) @struct type: (struct_type))) @symbol
    (type_declaration (type_spec name: (type_identifier) @interface type: (interface_type))) @symbol
  `,
  json: '', // JSON has no symbols; present only to satisfy the type — never queried at runtime.
  css: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
  html: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
};

/**
 * Queries capturing the callee name of a call site as `@callee`. Two shapes per language: a bare
 * call (`foo()`) and a member/attribute call (`obj.foo()`), which captures just the method name.
 * Attributing each call to its enclosing symbol (by line) yields the within-file call graph (TDD §5).
 */
export const CALL_QUERIES: Record<Language, string> = {
  typescript: `
    (call_expression function: (identifier) @callee)
    (call_expression function: (member_expression property: (property_identifier) @callee))
  `,
  javascript: `
    (call_expression function: (identifier) @callee)
    (call_expression function: (member_expression property: (property_identifier) @callee))
  `,
  python: `
    (call function: (identifier) @callee)
    (call function: (attribute attribute: (identifier) @callee))
  `,
  go: `
    (call_expression function: (identifier) @callee)
    (call_expression function: (selector_expression field: (field_identifier) @callee))
  `,
  json: '', // JSON has no symbols; present only to satisfy the type — never queried at runtime.
  css: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
  html: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
};

/** Queries capturing an import's module specifier as `@source` (a string literal). */
export const IMPORT_QUERIES: Record<Language, string> = {
  typescript: `(import_statement source: (string) @source)`,
  javascript: `(import_statement source: (string) @source)`,
  python: `
    (import_statement name: (dotted_name) @source)
    (import_statement name: (aliased_import (dotted_name) @source))
    (import_from_statement module_name: (dotted_name) @source)
  `,
  go: `(import_spec path: (interpreted_string_literal) @source)`,
  json: '', // JSON has no symbols; present only to satisfy the type — never queried at runtime.
  css: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
  html: '', // Tier-B: no symbols; present only to satisfy the type — never queried at runtime.
};
