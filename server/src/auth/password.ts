import { hash, verify, Algorithm } from "@node-rs/argon2";

/*
 * Password hashing. argon2id with OWASP's recommended parameters - deliberately
 * boring, and deliberately not configurable from the environment, because the
 * only reason to lower these is to make an attacker's job easier.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash
    // that distinguishes this account from any other.
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification. Called when no account
 * matches, so response timing does not reveal which addresses are registered.
 */
export async function dummyVerify(): Promise<void> {
  await hashPassword("timing-equalisation-placeholder");
}
