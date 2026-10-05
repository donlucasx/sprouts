import { redirect } from "next/navigation";

/** Privacy lives in the one Terms page (its "Data we keep" section). */
export default function Privacy() {
  redirect("/terms#data-we-keep");
}
