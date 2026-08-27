import clsx, { type ClassValue } from "clsx";

/** Conditional class names. Kept as its own module so every import is short. */
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
