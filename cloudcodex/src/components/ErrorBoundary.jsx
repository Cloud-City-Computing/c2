/**
 * ErrorBoundary — keeps one render error from blanking the whole application.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { Component } from 'react';

/**
 * Catches render, lifecycle and constructor errors below it and shows a
 * recoverable message instead of unmounting the React root.
 *
 * There was no boundary anywhere in the app before this, so any single throw
 * left the user on a blank page with no indication anything had happened and no
 * way back except a manual reload. That is how the editor teardown bug
 * (open-questions.md B11) turned a cosmetic unmount race into a total outage,
 * and how a null workspace owner could take down the admin console.
 *
 * It deliberately does NOT catch errors in event handlers, async callbacks or
 * the server: React error boundaries cannot see those. It is a floor, not a
 * substitute for handling failures where they happen.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
    this.handleDismiss = this.handleDismiss.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(
      `[${new Date().toISOString()}] Unhandled render error:`,
      error,
      info?.componentStack
    );
  }

  handleReload() {
    window.location.reload();
  }

  /**
   * Clear the error and try rendering the children again. Useful when the
   * failure was tied to state that has since changed; if it throws again the
   * boundary simply catches it again.
   */
  handleDismiss() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__panel">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__body">
            Cloud Codex hit an unexpected error while drawing this page. Your
            saved work is not affected.
          </p>
          {error.message ? (
            <pre className="error-boundary__detail">{error.message}</pre>
          ) : null}
          <div className="error-boundary__actions">
            <button type="button" className="btn" onClick={this.handleReload}>
              Reload the page
            </button>
            <button type="button" className="btn" onClick={this.handleDismiss}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
