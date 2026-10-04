import type { ComponentPropsWithRef } from 'react';

export type InputProps = ComponentPropsWithRef<'input'> & {
  /** JetBrains Mono — asset tags, serials, hostnames. */
  mono?: boolean;
};
