import type { Metadata } from "next";

/** What a wallet shows when this site asks to connect, and what a browser tab or a link preview shows. */
export const siteMetadata: Metadata = {
  title: "Sprouts",
  description: "Round-ups into SKR that your Seeker keeps and a yield manager grows.",
  applicationName: "Sprouts",
  openGraph: {
    title: "Sprouts",
    description: "Round-ups into SKR that your Seeker keeps and a yield manager grows.",
    url: "https://sprouts.money",
    siteName: "Sprouts",
    type: "website",
    // His ask 10-12: Discord showed no picture (it needs og:image; iMessage falls back on its own). The branded preview (previews/brand-thumb/).
    images: [{ url: "https://sprouts.money/og-preview.png", width: 987, height: 1038, alt: "Sprouts on a Seeker: the garden home screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sprouts",
    description: "Round-ups into SKR that your Seeker keeps and a yield manager grows.",
    images: ["https://sprouts.money/og-preview.png"],
  },
};
