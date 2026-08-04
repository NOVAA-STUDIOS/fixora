/**
 * The Diagnostic Classifier — a lightweight, rule-based gate that runs before AI Repair.
 *
 * Some TypeScript diagnostics are not source-code defects at all: a missing `@types/node`, an
 * unresolved module, a `tsconfig.json` `lib`/`moduleResolution` gap. Sending these to a model
 * produces a plausible-looking source edit that routes around the real problem, which then fails
 * verification (the missing type/module is still missing) — Apply becomes disabled, and the user
 * reads that as "Repair is broken" when the actual cause is a project configuration or environment
 * gap that no source-code edit can fix.
 *
 * This classifier answers one question — "is this a configuration/environment problem?" — from the
 * diagnostic's own code and message, with no model call and no workspace access. It is deliberately
 * narrow: only well-known TypeScript diagnostic codes for module resolution and missing type
 * declarations are classified; every other diagnostic is left alone, unclassified, and free to enter
 * the AI Repair pipeline exactly as before.
 */

export interface ConfigDiagnosis {
  /** The plain-language root cause — never a raw compiler code. */
  reason: string;
  /** The exact command or configuration change that resolves it. */
  fix: string;
}

type ClassifiableFinding = { ruleId: string; message: string };

/** `Cannot find module 'X' or its corresponding type declarations.` — a missing dependency. */
const MISSING_MODULE_CODES = new Set(['TS2307']);

/** `Could not find a declaration file for module 'X'.` / `Cannot find type definition file for 'X'.` */
const MISSING_TYPE_DECLARATION_CODES = new Set(['TS7016', 'TS2688']);

/** `Cannot find module 'X'. Did you mean to set the 'moduleResolution' option...` — a tsconfig setting. */
const MODULE_RESOLUTION_CODES = new Set(['TS2792']);

/** `Cannot find global type 'X'.` — the `lib` compiler option does not include it. */
const MISSING_LIB_CODES = new Set(['TS2318', 'TS2584']);

/** `Cannot find name 'X'.` for a Node.js/DOM global — the `types`/`lib` compiler option gap. */
const MISSING_GLOBAL_TYPES_CODES = new Set(['TS2580', 'TS2591']);

const QUOTED = /'([^']+)'/;

function quotedName(message: string): string | null {
  return QUOTED.exec(message)?.[1] ?? null;
}

function typesPackageFor(moduleName: string): string {
  const bare = moduleName.startsWith('@') ? moduleName.split('/')[1] : moduleName;
  return `@types/${bare ?? moduleName}`;
}

/**
 * A relative/absolute specifier ('./foo', '../foo', '/foo', 'C:\...') names a file INSIDE this
 * project, not a package. An unresolved one is a wrong or misspelled path — a genuine source defect
 * AI Repair can fix by correcting the string — never a missing dependency. Only bare specifiers
 * ('lodash', '@scope/pkg') are classified as a configuration/environment problem below.
 */
function isProjectLocalSpecifier(name: string): boolean {
  return name.startsWith('.') || name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name);
}

/**
 * Classify one diagnostic. Returns a `ConfigDiagnosis` (root cause + exact fix) when the diagnostic
 * is a project configuration/environment problem, or `null` when it is — as far as this classifier
 * can tell — a genuine source-code defect that AI Repair should still handle.
 */
export function classifyDiagnostic(finding: ClassifiableFinding): ConfigDiagnosis | null {
  const { ruleId, message } = finding;

  // tsc frequently embeds its own remedy directly in the message — trust it verbatim rather than
  // re-deriving one, and it catches phrasing beyond the fixed code list below.
  const embeddedTypesHint = /install type definitions for (\w[\w.-]*)/i.exec(message);
  if (embeddedTypesHint?.[1] !== undefined) {
    const pkg = embeddedTypesHint[1].toLowerCase() === 'node' ? '@types/node' : typesPackageFor(embeddedTypesHint[1]);
    return {
      reason: `TypeScript cannot find type definitions for '${embeddedTypesHint[1]}' — a missing dependency, not a defect in this file.`,
      fix: `npm install --save-dev ${pkg}`,
    };
  }

  if (MISSING_MODULE_CODES.has(ruleId)) {
    const name = quotedName(message);
    // A relative/absolute specifier is a path INTO this project, not a package — an unresolved one
    // is a wrong or misspelled path, which AI Repair can fix, not a missing dependency.
    if (name !== null && isProjectLocalSpecifier(name)) return null;
    return {
      reason:
        name !== null
          ? `The module '${name}' could not be resolved — a missing dependency or path problem, not a defect in this file.`
          : 'A module could not be resolved — a missing dependency or path problem, not a defect in this file.',
      fix: name !== null ? `npm install ${name}` : "Install the missing package with your project's package manager.",
    };
  }

  if (MISSING_TYPE_DECLARATION_CODES.has(ruleId)) {
    const name = quotedName(message);
    if (name !== null && isProjectLocalSpecifier(name)) return null;
    return {
      reason:
        name !== null
          ? `'${name}' has no type declarations available — TypeScript cannot check it without a types package.`
          : 'This module has no type declarations available — TypeScript cannot check it without a types package.',
      fix:
        name !== null
          ? `npm install --save-dev ${typesPackageFor(name)}`
          : 'Install the matching @types package for this module, or add a local .d.ts declaration.',
    };
  }

  if (MODULE_RESOLUTION_CODES.has(ruleId)) {
    const name = quotedName(message);
    // Same guard as the module/type-declaration branches above: a relative/absolute specifier is a
    // path INTO this project, not a package — an unresolved one is a wrong or misspelled path, a
    // genuine source defect AI Repair can fix, not a tsconfig setting.
    if (name !== null && isProjectLocalSpecifier(name)) return null;
    return {
      reason:
        "This is a TypeScript module resolution setting, not a code defect — the import is valid but tsconfig.json isn't configured to resolve it this way.",
      fix: 'Set "moduleResolution": "bundler" (or "node16"/"nodenext") in tsconfig.json under compilerOptions.',
    };
  }

  if (MISSING_GLOBAL_TYPES_CODES.has(ruleId)) {
    return {
      reason:
        "Node.js's built-in globals (crypto, Buffer, process, ...) aren't typed without @types/node — a missing type package, not a bug in this code.",
      fix: 'npm install --save-dev @types/node, then add "types": ["node"] to tsconfig.json under compilerOptions.',
    };
  }

  if (MISSING_LIB_CODES.has(ruleId)) {
    const name = quotedName(message);
    return {
      reason:
        name !== null
          ? `The global type '${name}' isn't available under the current TypeScript "lib" setting — a compiler configuration gap, not a code defect.`
          : 'A global type isn\'t available under the current TypeScript "lib" setting — a compiler configuration gap, not a code defect.',
      fix: 'Add the matching entry (e.g. "dom", "es2020") to the "lib" array in tsconfig.json under compilerOptions.',
    };
  }

  return null;
}
