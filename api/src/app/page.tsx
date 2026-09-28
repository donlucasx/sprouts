/** The API's front door: one sentence, the safety story, and where the code is. The app lives on the Seeker. */
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "10vh auto", padding: "0 24px", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sprouts</h1>
      <p>Every swap rounds up. The change buys SKR and stakes it, into a garden only your Seeker can open.</p>
      <p>
        This is the backend. The puller key is hot: its authority over each linked wallet is at most the daily limit, revocable on chain in
        one tap, and custody lasts one transaction. Nothing here holds user funds.
      </p>
      <p>
        Code and the safety story: <a href="https://github.com/donlucasx/sprouts">github.com/donlucasx/sprouts</a>
      </p>
    </main>
  );
}
