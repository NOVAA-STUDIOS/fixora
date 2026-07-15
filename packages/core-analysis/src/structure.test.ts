import type { SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { parseStructure } from './structure.js';
import { enclosingSymbol } from './symbols/symbols.js';

/**
 * Per-language conformance (roadmap M3): each grammar must yield the same normalised symbol/import
 * shape despite wildly different node names. These are the tests that catch a query written against
 * the wrong field name for a grammar — the exact failure the "one interface, per-language
 * conformance tests" strategy exists to surface (roadmap M3 risk).
 */

function names(symbols: SymbolRef[]): string[] {
  return symbols.map((s) => s.name);
}
function kindOf(symbols: SymbolRef[], name: string): string | undefined {
  return symbols.find((s) => s.name === name)?.kind;
}

describe('TypeScript structure', () => {
  const source = `import { z } from 'zod';
import fs from 'node:fs';

export function processOrder(id: string): number {
  const total = compute();
  return total;
}

export const load = async (): Promise<void> => {};

interface Order {
  id: string;
}

class Cart {
  add(item: string): void {}
  remove(item: string): void {}
}
`;

  it('extracts functions, arrow-const functions, interfaces, classes and methods', async () => {
    const { symbols } = await parseStructure('typescript', source, 'src/order.ts');
    expect(names(symbols)).toEqual(
      expect.arrayContaining(['processOrder', 'load', 'Order', 'Cart', 'add', 'remove']),
    );
    expect(kindOf(symbols, 'processOrder')).toBe('function');
    expect(kindOf(symbols, 'load')).toBe('function');
    expect(kindOf(symbols, 'Order')).toBe('interface');
    expect(kindOf(symbols, 'Cart')).toBe('class');
    expect(kindOf(symbols, 'add')).toBe('method');
  });

  it('extracts import module specifiers without quotes', async () => {
    const { imports } = await parseStructure('typescript', source, 'src/order.ts');
    expect(imports.map((i) => i.module)).toEqual(['zod', 'node:fs']);
  });

  it('resolves the enclosing symbol for a line inside a function', async () => {
    const { symbols } = await parseStructure('typescript', source, 'src/order.ts');
    // `return total;` is line 6, inside processOrder.
    expect(enclosingSymbol(symbols, 6)?.name).toBe('processOrder');
    // The import line is top-level — no enclosing symbol.
    expect(enclosingSymbol(symbols, 1)).toBeUndefined();
  });

  it('builds a within-file call graph attributing calls to their enclosing symbol', async () => {
    const { calls } = await parseStructure('typescript', source, 'src/order.ts');
    // processOrder calls compute() — an internal edge.
    expect(calls).toContainEqual(
      expect.objectContaining({ from: 'processOrder', callee: 'compute' }),
    );
  });
});

describe('JavaScript structure', () => {
  it('extracts functions, classes and methods', async () => {
    const source = `function greet(name) { return 'hi ' + name; }
const add = (a, b) => a + b;
class Animal {
  speak() {}
}
`;
    const { symbols } = await parseStructure('javascript', source, 'src/a.js');
    expect(names(symbols)).toEqual(expect.arrayContaining(['greet', 'add', 'Animal', 'speak']));
    expect(kindOf(symbols, 'Animal')).toBe('class');
    expect(kindOf(symbols, 'speak')).toBe('method');
  });
});

describe('Python structure', () => {
  const source = `import os
from typing import List

def top_level(x):
    return x + 1

class Repository:
    def find(self, id):
        return None

    def save(self, item):
        pass
`;

  it('distinguishes a top-level function from a method inside a class', async () => {
    const { symbols } = await parseStructure('python', source, 'app/repo.py');
    expect(kindOf(symbols, 'top_level')).toBe('function');
    expect(kindOf(symbols, 'Repository')).toBe('class');
    expect(kindOf(symbols, 'find')).toBe('method');
    expect(kindOf(symbols, 'save')).toBe('method');
  });

  it('extracts imported modules', async () => {
    const { imports } = await parseStructure('python', source, 'app/repo.py');
    expect(imports.map((i) => i.module)).toEqual(expect.arrayContaining(['os', 'typing']));
  });

  it('resolves the enclosing method for a line in its body', async () => {
    const { symbols } = await parseStructure('python', source, 'app/repo.py');
    // `return None` is line 9, inside Repository.find.
    expect(enclosingSymbol(symbols, 9)?.name).toBe('find');
  });
});

describe('Go structure', () => {
  const source = `package main

import (
	"fmt"
	"strings"
)

type Cart struct {
	items []string
}

type Store interface {
	Get(id string) string
}

func NewCart() *Cart {
	return &Cart{}
}

func (c *Cart) Add(item string) {
	c.items = append(c.items, item)
}
`;

  it('extracts functions, methods, structs and interfaces', async () => {
    const { symbols } = await parseStructure('go', source, 'cmd/main.go');
    expect(names(symbols)).toEqual(expect.arrayContaining(['Cart', 'Store', 'NewCart', 'Add']));
    expect(kindOf(symbols, 'Cart')).toBe('struct');
    expect(kindOf(symbols, 'Store')).toBe('interface');
    expect(kindOf(symbols, 'NewCart')).toBe('function');
    expect(kindOf(symbols, 'Add')).toBe('method');
  });

  it('extracts imported package paths', async () => {
    const { imports } = await parseStructure('go', source, 'cmd/main.go');
    expect(imports.map((i) => i.module)).toEqual(expect.arrayContaining(['fmt', 'strings']));
  });
});
