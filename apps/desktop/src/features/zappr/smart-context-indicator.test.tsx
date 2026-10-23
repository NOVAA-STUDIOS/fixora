import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SmartContextIndicator } from './smart-context-indicator.js';

describe('SmartContextIndicator', () => {
  it('shows the automatic file count and relative paths, and exposes an accessible toggle', () => {
    const onToggle = vi.fn();
    render(<SmartContextIndicator
      enabled
      files={[{ path: 'src/app.ts', reason: 'prompt-match' }, { path: 'src/lib.ts', reason: 'import' }]}
      onToggle={onToggle}
    />);

    expect(screen.getByLabelText('Automatic project context: 2 files').textContent).toContain('Auto context: 2 files');
    expect(screen.getByLabelText('Automatic project context: 2 files').getAttribute('title')).toContain('src/app.ts');
    const toggle = screen.getByRole('button', { name: 'Smart context: On' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
