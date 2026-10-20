export default function Home() {
  return (
    <main className="game-shell">
      <iframe
        className="game-frame"
        src="/afs-game.html"
        title="AFS Flight Simulator"
        allow="fullscreen"
        allowFullScreen
      />
    </main>
  );
}
