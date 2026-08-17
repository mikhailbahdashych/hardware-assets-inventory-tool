import type { ComponentPropsWithoutRef } from 'react';

export type InputProps = ComponentPropsWithoutRef<'input'> & {
  /** JetBrains Mono — asset tags, serials, hostnames. */
  mono?: boolean;
};
