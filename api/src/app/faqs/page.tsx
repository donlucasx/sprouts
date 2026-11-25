import type { Metadata } from "next";
import { pageLang } from "../page-lang";
import { FaqsView } from "./faqs-view";

export const metadata: Metadata = { title: "Sprouts: FAQs", description: "How Sprouts works, what permission it needs, what it costs, and how to pause or stop it." };

/** /faqs in the browser's language (P9: Spanish when Accept-Language prefers it, else English exactly as before). */
export default async function Faqs() {
  return <FaqsView lang={await pageLang()} />;
}
