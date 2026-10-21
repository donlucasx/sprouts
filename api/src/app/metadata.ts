import type { Metadata } from "next";

/** What a wallet shows when this site asks to connect, and what a browser tab or a link preview shows. */
export const siteMetadata: Metadata = {
  title: "Sprouts",
  description: "Your spare change, planted on your Seeker.",
  applicationName: "Sprouts",
  openGraph: {
    title: "Sprouts",
    description: "Your spare change, planted on your Seeker.",
    url: "https://sprouts.money",
    siteName: "Sprouts",
    type: "website",
    // His ask 10-12: Discord showed no picture (it needs og:image; iMessage falls back on its own). The branded preview (previews/brand-thumb/).
    images: [{ url: "https://sprouts.money/og-preview.png", width: 987, height: 1038, alt: "Sprouts on a Seeker: the garden home screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sprouts",
    description: "Your spare change, planted on your Seeker.",
    // his pick 10-12: X crops summary_large_image to ~2:1; a landscape card keeps the phone whole. His ask 10-21: X showed the card's
    // text with no picture although the PNG serves fine; ?v= gives X's image cache a URL it has never failed on (bump it to refresh).
    images: [{ url: "https://sprouts.money/og-card-x.png?v=1021", width: 1200, height: 630, alt: "Sprouts on a Seeker: the garden home screen" }],
  },
};
