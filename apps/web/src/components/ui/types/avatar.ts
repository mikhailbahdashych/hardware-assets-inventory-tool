export interface AvatarProps {
  name: string;
  /** Stable id to hash for the color — defaults to the name. */
  colorKey?: string;
  size?: number;
  /** Rounded square rather than a circle: things, not people. */
  square?: boolean;
}
