/**
 * Text encoding detection and round-tripping.
 *
 * Fixora read and wrote `'utf8'` unconditionally. For a UTF-16 or Latin-1 source that is not a
 * display bug — decoding those bytes as UTF-8 produces replacement characters, and writing the
 * result back **destroys the file**: every non-ASCII character becomes U+FFFD, permanently. A tool
 * that edits people's source cannot be wrong about what their bytes mean.
 *
 * Detection is deliberately conservative and dependency-free. A BOM is authoritative. Without one,
 * only two things are claimed: a UTF-16 pattern (which is unmistakable in text), and whether the
 * bytes are valid UTF-8 (which they are for all ASCII and all correctly-encoded Unicode). Anything
 * else falls back to Latin-1, the encoding whose defining property is that every byte sequence is
 * valid — so it can never itself fail, only be a slightly wrong guess about a legacy file.
 */

export type FileEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be' | 'latin1';

/** How many bytes are inspected when there is no BOM. Enough to be representative, small enough to
 *  stay trivial on a large file. */
const SAMPLE_BYTES = 512;

export function detectEncoding(buffer: Buffer): FileEncoding {
  // A BOM is a declaration by whoever wrote the file. It is never overridden by a heuristic.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8-bom';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf16be';

  const sample = buffer.subarray(0, Math.min(SAMPLE_BYTES, buffer.length));
  if (sample.length === 0) return 'utf8';

  // BOM-less UTF-16, detected by the giveaway that ASCII text produces: every other byte is 0x00.
  // Which half carries the zeros tells the endianness apart. Requires a real majority, so a file
  // that merely contains a stray NUL is not mistaken for UTF-16.
  let evenZero = 0;
  let oddZero = 0;
  const pairs = Math.floor(sample.length / 2);
  for (let i = 0; i < pairs; i += 1) {
    if (sample[i * 2] === 0) evenZero += 1;
    if (sample[i * 2 + 1] === 0) oddZero += 1;
  }
  if (pairs >= 8) {
    if (oddZero > pairs * 0.6 && evenZero < pairs * 0.1) return 'utf16le';
    if (evenZero > pairs * 0.6 && oddZero < pairs * 0.1) return 'utf16be';
  }

  return isValidUtf8(sample) ? 'utf8' : 'latin1';
}

/**
 * Whether the sample is well-formed UTF-8.
 *
 * Checked structurally rather than by decoding and looking for U+FFFD: a file may legitimately
 * CONTAIN U+FFFD, and treating that as a decode failure would misclassify a valid UTF-8 file as
 * Latin-1. The trailing bytes of a multi-byte sequence cut off by the sample boundary are accepted
 * rather than rejected, since a truncated sample is our doing, not the file's.
 */
function isValidUtf8(sample: Buffer): boolean {
  let i = 0;
  while (i < sample.length) {
    const byte = sample[i] ?? 0;
    if (byte <= 0x7f) {
      i += 1;
      continue;
    }
    const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc2 ? 2 : 0;
    if (width === 0) return false; // 0x80–0xC1 can never start a sequence.
    // Ran off the end of the sample mid-sequence — not evidence of anything.
    if (i + width > sample.length) return true;
    for (let k = 1; k < width; k += 1) {
      const cont = sample[i + k] ?? 0;
      if (cont < 0x80 || cont > 0xbf) return false;
    }
    i += width;
  }
  return true;
}

/** Bytes → string, honouring the detected encoding and stripping any BOM from the text itself. */
export function decodeBuffer(buffer: Buffer, encoding: FileEncoding): string {
  switch (encoding) {
    case 'utf8-bom':
      return buffer.subarray(3).toString('utf8');
    case 'utf16le':
      // `subarray(2)` only when the BOM is actually present — a BOM-less UTF-16 file has no two
      // bytes to skip, and removing them would eat a real character.
      return hasUtf16Bom(buffer) ? buffer.subarray(2).toString('utf16le') : buffer.toString('utf16le');
    case 'utf16be':
      return swap16(hasUtf16Bom(buffer) ? buffer.subarray(2) : buffer).toString('utf16le');
    case 'latin1':
      return buffer.toString('latin1');
    case 'utf8':
      return buffer.toString('utf8');
  }
}

/** String → bytes in the same encoding it was read as, BOM included where there was one. */
export function encodeText(text: string, encoding: FileEncoding): Buffer {
  switch (encoding) {
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    case 'utf16be':
      return Buffer.concat([Buffer.from([0xfe, 0xff]), swap16(Buffer.from(text, 'utf16le'))]);
    case 'latin1':
      return Buffer.from(text, 'latin1');
    case 'utf8':
      return Buffer.from(text, 'utf8');
  }
}

function hasUtf16Bom(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  const [a, b] = [buffer[0], buffer[1]];
  return (a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff);
}

/** Byte-swap a copy for the BE↔LE conversion. Node decodes UTF-16LE only, so BE is swapped either
 *  way; copying keeps the caller's buffer (which may be the file's own bytes) untouched. */
function swap16(buffer: Buffer): Buffer {
  const copy = Buffer.from(buffer);
  // `swap16` throws on an odd length, which a truncated file can genuinely have.
  if (copy.length % 2 !== 0) return copy.subarray(0, copy.length - 1).swap16();
  return copy.swap16();
}

/** Shown in the editor when it is worth knowing the file is not UTF-8. UTF-8 (with or without BOM)
 *  is the unremarkable case and gets no badge. */
export function encodingBadgeLabel(encoding: FileEncoding): string | null {
  switch (encoding) {
    case 'utf16le':
      return 'UTF-16 LE';
    case 'utf16be':
      return 'UTF-16 BE';
    case 'latin1':
      return 'Latin-1';
    default:
      return null;
  }
}
