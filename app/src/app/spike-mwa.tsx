// SPIKE S3 (contracts sec 9): two ALT-free v0 transactions, one wallet session. Branch spike/mwa-two-tx only. NOTHING IS SENT.
import { useState } from 'react'
import { ScrollView, Text } from 'react-native'
import {
  address, appendTransactionMessageInstruction, compileTransaction, createNoopSigner, createSolanaRpc, createTransactionMessage, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, type Transaction,
} from '@solana/kit'
import { getAddMemoInstruction } from '@solana-program/memo'
import { transact, useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from '@/components/Button'
import { identity } from '@/lib/identity'
import { useSession } from '@/lib/session'

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com')

/** Two memo-only transactions paid by the user: v0, no lookup table, the same shape as every Sprouts user transaction. */
async function twoMemoTxs(user: string): Promise<Transaction[]> {
  const { value } = await rpc.getLatestBlockhash().send()
  return [1, 2].map((n) =>
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(user)), m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(value, m),
        (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: `sprouts spike S3, ${n} of 2, never sent` }), m),
      ),
    ),
  )
}

export default function SpikeMwa() {
  const { session } = useSession()
  const { signTransactions } = useMobileWallet()
  const [log, setLog] = useState<string[]>([])
  const say = (s: string) => {
    const line = `${new Date().toISOString().slice(11, 19)} ${s}`
    console.log(`[S3] ${line}`)
    setLog((l) => [...l, line])
  }
  const signedBy = (t: Transaction, who: string) => ((t.signatures as Record<string, unknown>)[who] ? 'yes' : 'no')
  async function caps() {
    try {
      say(`caps ${JSON.stringify(await transact(async (w) => w.getCapabilities()))}`)
    } catch (e) {
      say(`caps failed: ${String(e)}`)
    }
  }
  async function signTwoKit() {
    if (!session) return say('sign in first')
    try {
      const txs = await twoMemoTxs(session.pubkey)
      say('kit: asking for 2 signatures in one call')
      const t0 = Date.now()
      const out = await signTransactions(txs)
      say(`kit: ${out.length} back in ${Date.now() - t0} ms; signed ${out.map((t) => signedBy(t, session.pubkey)).join(',')}`)
    } catch (e) {
      say(`kit failed: ${String(e)}`)
    }
  }
  async function signTwoRaw() {
    if (!session) return say('sign in first')
    try {
      const txs = await twoMemoTxs(session.pubkey)
      say('raw: authorize + signTransactions in one transact')
      const t0 = Date.now()
      const out = await transact(async (w) => {
        await w.authorize({ chain: 'solana:mainnet', identity })
        return w.signTransactions({ transactions: txs })
      })
      say(`raw: ${out.length} back in ${Date.now() - t0} ms; signed ${out.map((t) => signedBy(t, session.pubkey)).join(',')}`)
    } catch (e) {
      say(`raw failed: ${String(e)}`)
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 12 }}>
      <Text>Spike S3. Nothing here is sent.</Text>
      <Button title="1. Capabilities" onPress={caps} />
      <Button title="2. Sign two (kit, the app's path)" onPress={signTwoKit} />
      <Button title="3. Sign two (authorize + sign, one session)" onPress={signTwoRaw} />
      {log.map((l, i) => (
        <Text key={i} selectable>
          {l}
        </Text>
      ))}
    </ScrollView>
  )
}
