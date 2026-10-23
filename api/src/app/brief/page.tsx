import { redirect } from "next/navigation";

/** His ruling 10-23: the brief (R316, a temporary page for the Solana Mobile team) is replaced by the deck; old links land there. */
export default function Brief() {
  redirect("/deck");
}
