import type { ActivityResponse, MeResponse } from "./api";
import { FIXTURE_ACTIVITY, FIXTURE_POSITIONS, FIXTURE_TERMS_VERSION, FIXTURE_VENUES, mockMe } from "./lend-fixtures";

/** Dev only: Metro started with EXPO_PUBLIC_LEND_MOCK=1 fills the fields Track A has not deployed. Off in every build eas.json makes. */
export const LEND_MOCK = process.env.EXPO_PUBLIC_LEND_MOCK === "1";
const LEND_MOCK_MOVE = process.env.EXPO_PUBLIC_LEND_MOCK_MOVE === "1";
const POOL_FULL = "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.";
export const NEEDS_LIVE = "Mock mode: this needs the live API.";
let termsAccepted = false;
export function resetMock() {
  termsAccepted = false;
}
export type MockStep = { answer: unknown } | { error: { status: number; message: string } } | null;

/** Before the network. The mock NEVER answers with a transaction: the Seed Vault is only ever asked about real API builds. */
export function mockBefore(path: string, method: string, body: unknown): MockStep {
  if (path === "/api/venues") return { answer: FIXTURE_VENUES };
  if (path === "/api/terms" && method === "POST") {
    termsAccepted = true;
    return { answer: { acceptedVersion: FIXTURE_TERMS_VERSION, acceptedAt: new Date().toISOString() } };
  }
  if (path === "/api/lend/withdraw/build") {
    const b = body as { asset?: string; venue?: string } | undefined;
    const full = FIXTURE_POSITIONS.some((p) => p.asset === b?.asset && p.venue === b?.venue && p.poolFull);
    return { error: { status: 409, message: full ? POOL_FULL : NEEDS_LIVE } };
  }
  if (path === "/api/relink/build" || path === "/api/moves/build") return { error: { status: 409, message: NEEDS_LIVE } };
  if (path === "/api/moves/dismiss") return { answer: { dismissed: true } };
  return null;
}

/** After the network: the real answer with the lending fields added. */
export function mockAfter(path: string, json: unknown): unknown {
  if (path === "/api/me") return mockMe(json as MeResponse, new Date(), { move: LEND_MOCK_MOVE, termsAccepted });
  if (path === "/api/activity") {
    const a = json as ActivityResponse;
    return { ...a, plantings: [...FIXTURE_ACTIVITY.plantings, ...a.plantings], lendWithdrawals: FIXTURE_ACTIVITY.lendWithdrawals, moves: FIXTURE_ACTIVITY.moves, found: FIXTURE_ACTIVITY.found };
  }
  return json;
}
