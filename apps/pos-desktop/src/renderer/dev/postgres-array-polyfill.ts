/**
 * ESM polyfill for postgres-array (CJS → ESM).
 *
 * postgres-array@3.0.4 is a pure CommonJS module consumed internally by
 * pg-types / the Prisma runtime.  When Vite serves it raw via /@fs/ (deep
 * transitive dep of the excluded @prisma/client), its CJS–ESM interop proxy
 * fails to expose the named `parse` export, causing:
 *
 *   “[…] does not provide an export named 'parse'”
 *
 * This file duplicates the ~120-line parser as ESM, sidestepping the
 * interop entirely.  It is aliased in vite.config.ts as `postgres-array`.
 *
 * Source: https://github.com/bendrucker/postgres-array (MIT)
 */

const BACKSLASH = '\\';
const DQUOT = '"';
const LBRACE = '{';
const RBRACE = '}';
const LBRACKET = '[';
const EQUALS = '=';
const COMMA = ',';

/** When the raw value is this, it means a literal `null` */
const NULL_STRING = 'NULL';

function makeParseArrayWithTransform(
  transform?: ((value: string) => unknown) | null,
): (str: string) => unknown[] {
  const haveTransform = transform != null;
  return function parseArray(str: string): unknown[] {
    const rbraceIndex = str.length - 1;
    if (rbraceIndex === 1) {
      return [];
    }
    if (str[rbraceIndex] !== RBRACE) {
      throw new Error('Invalid array text - must end with }');
    }

    // If starts with `[`, it is specifying the index bounds. Skip past first `=`.
    let position = 0;
    if (str[position] === LBRACKET) {
      position = str.indexOf(EQUALS) + 1;
    }

    if (str[position++] !== LBRACE) {
      throw new Error('Invalid array text - must start with {');
    }
    const output: unknown[] = [];
    let current: unknown[] = output;
    const stack: unknown[][] = [];

    let currentStringStart = position;
    let currentString = '';
    let expectValue = true;

    for (; position < rbraceIndex; ++position) {
      const char = str[position];
      if (char === DQUOT) {
        // It's escaped
        currentStringStart = ++position;
        let dquot = str.indexOf(DQUOT, currentStringStart);
        let backSlash = str.indexOf(BACKSLASH, currentStringStart);
        while (backSlash !== -1 && backSlash < dquot) {
          position = backSlash;
          const part = str.slice(currentStringStart, position);
          currentString += part;
          currentStringStart = ++position;
          if (dquot === position++) {
            // This was an escaped doublequote; find the next one!
            dquot = str.indexOf(DQUOT, position);
          }
          // Either way, find the next backslash
          backSlash = str.indexOf(BACKSLASH, position);
        }
        position = dquot;
        const part = str.slice(currentStringStart, position);
        currentString += part;
        current.push(haveTransform ? transform!(currentString) : currentString);
        currentString = '';
        expectValue = false;
      } else if (char === LBRACE) {
        const newArray: unknown[] = [];
        current.push(newArray);
        stack.push(current);
        current = newArray;
        currentStringStart = position + 1;
        expectValue = true;
      } else if (char === COMMA) {
        expectValue = true;
      } else if (char === RBRACE) {
        expectValue = false;
        const arr = stack.pop();
        if (arr === undefined) {
          throw new Error("Invalid array text - too many '}'");
        }
        current = arr;
      } else if (expectValue) {
        currentStringStart = position;
        let c: string;
        while (
          (c = str[position]) !== COMMA &&
          c !== RBRACE &&
          position < rbraceIndex
        ) {
          ++position;
        }
        const part = str.slice(currentStringStart, position--);
        current.push(
          part === NULL_STRING
            ? null
            : haveTransform
              ? transform!(part)
              : part,
        );
        expectValue = false;
      } else {
        throw new Error('Was expecting delimiter');
      }
    }

    return output;
  };
}

const parseArray = makeParseArrayWithTransform();

/**
 * Parse a PostgreSQL array string into a JavaScript array.
 * Optionally transform each element via the `transform` callback.
 */
export function parse(
  source: string,
  transform?: ((value: string) => unknown) | null,
): unknown[] {
  return transform != null
    ? makeParseArrayWithTransform(transform)(source)
    : parseArray(source);
}
