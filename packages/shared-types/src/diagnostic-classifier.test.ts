import { describe, expect, it } from 'vitest';

import { classifyDiagnostic } from './diagnostic-classifier.js';

/**
 * Launch blocker regression: Fixora was sending project configuration/environment diagnostics
 * (missing @types/node, unresolved modules, tsconfig gaps) to AI Repair. The model produced source
 * edits that could never resolve them, verification failed every time, and Apply stayed disabled —
 * read by users as "Repair is broken" rather than "your project is missing a dependency."
 */
describe('classifyDiagnostic', () => {
  it('classifies a missing Node type declaration diagnostic, with npm install as the fix', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2591',
      message: "Cannot find name 'crypto'. Do you need to install type definitions for node?",
    });
    expect(result).not.toBeNull();
    expect(result?.reason.toLowerCase()).toContain('node');
    expect(result?.fix).toContain('npm install --save-dev @types/node');
  });

  it('classifies the same for Buffer, via the same code', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2591',
      message: "Cannot find name 'Buffer'. Do you need to install type definitions for node?",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toContain('@types/node');
  });

  it('classifies an unresolved module, naming the exact package to install', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2307',
      message: "Cannot find module 'lodash' or its corresponding type declarations.",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toBe('npm install lodash');
    expect(result?.reason).toContain('lodash');
  });

  it('classifies a missing type declaration file, suggesting the @types package', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS7016',
      message:
        "Could not find a declaration file for module 'left-pad'. 'left-pad.js' implicitly has an 'any' type.",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toBe('npm install --save-dev @types/left-pad');
  });

  it('classifies a scoped package correctly for the @types name', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS7016',
      message: "Could not find a declaration file for module '@foo/bar'.",
    });
    expect(result?.fix).toBe('npm install --save-dev @types/bar');
  });

  it('classifies a module resolution setting problem as tsconfig, not a code defect', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2792',
      message:
        "Cannot find module 'lodash'. Did you mean to set the 'moduleResolution' option to 'bundler'?",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toContain('moduleResolution');
    expect(result?.fix).toContain('tsconfig.json');
  });

  it('classifies a missing global lib type as a tsconfig "lib" gap', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2318',
      message: "Cannot find global type 'Promise'.",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toContain('lib');
    expect(result?.fix).toContain('tsconfig.json');
  });

  it('does NOT classify an unresolved RELATIVE import as a config issue — it is a wrong path, AI-fixable', () => {
    // Regression: the Repair button was blocked for exactly this — a typo'd relative import is a
    // genuine source defect, not a missing dependency, and must stay eligible for AI Repair.
    expect(
      classifyDiagnostic({
        ruleId: 'TS2307',
        message: "Cannot find module './utils/helper' or its corresponding type declarations.",
      }),
    ).toBeNull();
    expect(
      classifyDiagnostic({
        ruleId: 'TS2307',
        message: "Cannot find module '../shared/config' or its corresponding type declarations.",
      }),
    ).toBeNull();
    expect(
      classifyDiagnostic({
        ruleId: 'TS7016',
        message: "Could not find a declaration file for module './local'.",
      }),
    ).toBeNull();
  });

  it('still classifies an unresolved BARE package specifier as a config issue', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2307',
      message: "Cannot find module 'lodash' or its corresponding type declarations.",
    });
    expect(result).not.toBeNull();
  });

  it('does NOT classify a moduleResolution hint on a RELATIVE path — same guard as TS2307/TS7016', () => {
    // Same bug shape as the TS2307 fix, one branch over: TS2792 fires for relative-import typos too
    // ("Did you mean to set the 'moduleResolution' option...") and is not a tsconfig problem there.
    expect(
      classifyDiagnostic({
        ruleId: 'TS2792',
        message:
          "Cannot find module './utilz'. Did you mean to set the 'moduleResolution' option to 'bundler'?",
      }),
    ).toBeNull();
  });

  it('still classifies a moduleResolution hint on a BARE package specifier as a config issue', () => {
    const result = classifyDiagnostic({
      ruleId: 'TS2792',
      message:
        "Cannot find module 'lodash'. Did you mean to set the 'moduleResolution' option to 'bundler'?",
    });
    expect(result).not.toBeNull();
    expect(result?.fix).toContain('moduleResolution');
  });

  it('does NOT classify a genuine source-code defect — the classifier is narrow on purpose', () => {
    expect(
      classifyDiagnostic({
        ruleId: 'TS2345',
        message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
      }),
    ).toBeNull();
    expect(
      classifyDiagnostic({
        ruleId: 'TS2322',
        message: "Type 'number' is not assignable to type 'string'.",
      }),
    ).toBeNull();
    expect(
      classifyDiagnostic({ ruleId: 'no-unused-vars', message: "'x' is defined but never used." }),
    ).toBeNull();
  });

  it('never fabricates a fix when the message carries no quoted name', () => {
    const result = classifyDiagnostic({ ruleId: 'TS2307', message: 'Cannot find module.' });
    expect(result).not.toBeNull();
    expect(result?.fix).not.toContain('undefined');
  });
});
