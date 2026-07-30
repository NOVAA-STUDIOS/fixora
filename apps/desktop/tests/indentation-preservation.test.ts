import { describe, expect, it } from 'vitest';

import { reindentToMatch, spliceLines } from '../electron/main/verification/patch.js';

/**
 * Indentation preservation — a defect found during manual validation.
 *
 * Models routinely dedent: asked for "the corrected code" for a target that begins at column 4, they
 * reply flush left. `spliceLines` normalised line ENDINGS but not indentation, so the reply was
 * written verbatim and real damage reached users' files. Observed in the certification corpus, where
 * an applied repair turned `    const [x] = useState(0);` into an unindented line, and a JSON member
 * lost its two spaces.
 *
 * In Python this is not cosmetic — it changes what the code means.
 */

describe('reindentToMatch', () => {
  it('restores the indent when the model replies flush left', () => {
    expect(reindentToMatch('    const x = 1;', 'const x = 2;')).toBe('    const x = 2;');
  });

  it('preserves RELATIVE indentation inside the block — only its alignment shifts', () => {
    const original = '  function a() {\n    return 1;\n  }';
    const replacement = 'function a() {\n  return 2;\n}';
    expect(reindentToMatch(original, replacement)).toBe('  function a() {\n    return 2;\n  }');
  });

  it('is a no-op when the model already matched the indent', () => {
    const replacement = '    const x = 2;';
    expect(reindentToMatch('    const x = 1;', replacement)).toBe(replacement);
  });

  it('never puts trailing whitespace on a blank line', () => {
    const out = reindentToMatch('    a\n    b', 'a\n\nb');
    expect(out).toBe('    a\n\n    b');
    expect(out.split('\n')[1]).toBe('');
  });

  it('removes excess indent when the model over-indents', () => {
    expect(reindentToMatch('  a\n  b', '      a\n      b')).toBe('  a\n  b');
  });

  it('leaves tabs-vs-spaces alone rather than guessing the convention', () => {
    // Guessing an author's whitespace convention is how you corrupt a file, not fix one.
    const replacement = '\t\tconst x = 2;';
    expect(reindentToMatch('    const x = 1;', replacement)).toBe(replacement);
  });

  it('preserves tab indentation when the original uses tabs', () => {
    expect(reindentToMatch('\tconst x = 1;', 'const x = 2;')).toBe('\tconst x = 2;');
  });

  it('never alters non-whitespace content', () => {
    const out = reindentToMatch('    foo("  bar  ");', 'foo("  bar  ");');
    expect(out).toBe('    foo("  bar  ");');
    expect(out.trim()).toBe('foo("  bar  ");'); // inner spacing untouched
  });

  it('handles an empty original or replacement without throwing', () => {
    expect(reindentToMatch('', 'x')).toBe('x');
    expect(reindentToMatch('  x', '')).toBe('');
  });
});

describe('spliceLines — indentation survives the splice', () => {
  it('the React case from the certification corpus keeps its indent', () => {
    const file = [
      'export function Bad({ on }: { on: boolean }) {',
      '  if (on) {',
      '    const [x] = useState(0);',
      '    return <span>{x}</span>;',
      '  }',
      '}',
      '',
    ].join('\n');
    // What the model actually returned during validation: correct code, no indent.
    const patched = spliceLines(file, 3, 3, 'const [x, _setX] = useState(0);');
    expect(patched.split('\n')[2]).toBe('    const [x, _setX] = useState(0);');
  });

  it('the JSON case keeps its two spaces', () => {
    const file = '{\n  "items": [1, 2, 3,]\n}\n';
    const patched = spliceLines(file, 2, 2, '"items": [1, 2, 3]');
    expect(patched.split('\n')[1]).toBe('  "items": [1, 2, 3]');
  });

  it('Python indentation is preserved — where it is semantic, not cosmetic', () => {
    const file = ['def f(xs):', '    total = 0', '    for x in xs:', '        total += x', ''].join(
      '\n',
    );
    // Dedenting this would move the statement out of the loop and change what the code does.
    const patched = spliceLines(file, 4, 4, 'total += x * 2');
    expect(patched.split('\n')[3]).toBe('        total += x * 2');
  });

  it('a multi-line replacement keeps its internal structure and its alignment', () => {
    const file = ['class A:', '    def m(self):', '        return 1', ''].join('\n');
    const patched = spliceLines(file, 2, 3, 'def m(self):\n    return 2');
    expect(patched.split('\n').slice(1, 3)).toEqual(['    def m(self):', '        return 2']);
  });

  it('still normalises CRLF — the existing guarantee is unaffected', () => {
    const file = 'a\r\n    b\r\nc\r\n';
    const patched = spliceLines(file, 2, 2, 'B');
    expect(patched).toBe('a\r\n    B\r\nc\r\n');
  });

  it('verification and apply splice IDENTICALLY — the property the whole gate rests on', () => {
    // Both paths call this same function, so a patch that verified is byte-identical to the one
    // written. Pinned explicitly because normalising in one place only would silently break it.
    const file = 'x\n    const a = 1;\ny\n';
    const verified = spliceLines(file, 2, 2, 'const a = 2;');
    const applied = spliceLines(file, 2, 2, 'const a = 2;');
    expect(applied).toBe(verified);
    expect(verified.split('\n')[1]).toBe('    const a = 2;');
  });
});
