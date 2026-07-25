import { Buffer } from "buffer";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/** Mainnet USDC mint (6 decimals). */
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function memoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });
}

/** Owner's USDC balance in human units (0 if no token account). */
export async function getUsdcBalance(conn: Connection, owner: PublicKey): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(USDC_MINT, owner, true);
    const bal = await conn.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0; // missing ATA → no USDC
  }
}

/** Owner's SOL balance in human units. */
export async function getSolBalance(conn: Connection, owner: PublicKey): Promise<number> {
  try {
    return (await conn.getBalance(owner)) / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

/** Build a USDC transfer (creating the destination ATA if needed) + optional memo. */
export async function buildUsdcTransfer(
  conn: Connection,
  from: PublicKey,
  toAddress: string,
  uiAmount: number,
  memo?: string,
): Promise<Transaction> {
  const dest = new PublicKey(toAddress);
  const fromAta = getAssociatedTokenAddressSync(USDC_MINT, from, true);
  const toAta = getAssociatedTokenAddressSync(USDC_MINT, dest, true);
  const raw = BigInt(Math.round(uiAmount * 10 ** USDC_DECIMALS));

  const tx = new Transaction();
  const toInfo = await conn.getAccountInfo(toAta);
  if (!toInfo) {
    tx.add(createAssociatedTokenAccountInstruction(from, toAta, dest, USDC_MINT));
  }
  tx.add(createTransferCheckedInstruction(fromAta, USDC_MINT, toAta, from, raw, USDC_DECIMALS));
  if (memo) tx.add(memoInstruction(memo, from));
  return tx;
}

export const solscanTx = (sig: string): string => `https://solscan.io/tx/${sig}`;
