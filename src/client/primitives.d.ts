/**
 * Web-shell platform seed: `@deepseek-ai/dsh-client-ui-primitives` is listed in
 * package.json `dsh.client.inject`, provided by the shell and kept external in
 * the client bundle. Only the shapes this panel consumes are declared.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement } from 'react';

  /** Two-state toggle; `label` is the accessible name. */
  export function Switch(props: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    disabled?: boolean;
    title?: string;
    className?: string;
  }): ReactElement;
}
