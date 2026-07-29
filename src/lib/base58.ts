/**
 * Base58 ENCODE, and nothing else.
 *
 * A wallet's `signMessage` returns 64 raw bytes; the bot's bridge verifies a base58 string. That is
 * the entire need — so this encodes, and there is deliberately no decoder to grow into a parser for
 * things arriving from outside.
 *
 * It is ~20 lines rather than a dependency because the alternatives are worse in both directions:
 * `bs58` exists in the tree only transitively (two different majors, pulled by wallet adapters),
 * and depending on a transitive package is depending on someone else's dependency decision. The
 * bot solved the same problem the same way, for the same reason.
 *
 * Big-integer safe: it divides the byte array by 58 by long division over bytes, so it never
 * converts through a Number and cannot lose precision on a 64-byte signature.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Leading zero bytes are not carried by the arithmetic below (they are worth nothing), but they
  // ARE significant in base58 — each one is a literal '1'. Count them first.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i] as number];
  return out;
}
