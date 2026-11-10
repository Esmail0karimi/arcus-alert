import React from "react";
/** A crash inside one tab must never turn the whole app into a black page. */
export class Guard extends React.Component<{ name: string; children?: React.ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: any) {
    return { err: String(e?.message || e) };
  }
  componentDidCatch(e: any) {
    try {
      console.error("tab crashed:", this.props.name, e);
    } catch {}
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 20, color: "#ffb3b3" }}>
        <b>⚠ {this.props.name}</b>
        <p style={{ fontSize: 13 }}>This tab hit an error and was stopped so the rest of the app keeps working.</p>
        <code style={{ fontSize: 12, opacity: 0.8 }}>{this.state.err}</code>
        <p>
          <button type="button" onClick={() => this.setState({ err: null })}>Retry</button>{" "}
          <button type="button" onClick={() => { try { localStorage.removeItem("arcus.news.v1"); } catch {} location.reload(); }}>Clear cached data &amp; reload</button>
        </p>
      </div>
    );
  }
}
