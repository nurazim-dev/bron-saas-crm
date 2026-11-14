import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Precomputed valid argon2id hash used to equalize login timing when email is not found (BR-11).
const DUMMY_PASSWORD_HASH_PROMISE = argon2.hash(
  'dummy-timing-equalizer-password-not-valid',
  ARGON2_OPTIONS,
);

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, plainPassword);
  } catch {
    return false;
  }
}

export async function verifyDummyPassword(plainPassword: string): Promise<void> {
  const dummyHash = await DUMMY_PASSWORD_HASH_PROMISE;
  await verifyPassword(dummyHash, plainPassword);
}
