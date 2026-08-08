/**
 * Cloud Codex - Tests for FirstRunGate and the WelcomeSetup it renders
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const hookState = { firstRun: null, loading: false, complete: vi.fn() };
vi.mock('../../../src/hooks/useFirstRun.js', () => ({ default: () => hookState }));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import FirstRunGate from '../../../src/components/FirstRunGate.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  hookState.firstRun = null;
  hookState.loading = false;
  hookState.complete = vi.fn();
});

describe('FirstRunGate', () => {
  it('renders nothing while loading', () => {
    hookState.loading = true;
    const { container } = wrap(<FirstRunGate />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an onboarded user', () => {
    hookState.firstRun = { needsOnboarding: false, isAdmin: false };
    const { container } = wrap(<FirstRunGate />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the admin variant with an invite call to action', () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: true,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    wrap(<FirstRunGate />);

    expect(screen.getByRole('heading', { name: /welcome to cloud codex/i })).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /invite your team/i })).toHaveAttribute('href', '/admin');
  });

  it('shows the member variant without the invite call to action', () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    wrap(<FirstRunGate />);

    expect(screen.queryByRole('link', { name: /invite your team/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /welcome to cloud codex/i })).toHaveAttribute('href', '/archives/5/doc/9');
  });

  it('tells a squad-less member what to ask for instead of pretending', () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: null, archive: null, log: null, pendingSquadInvites: 0,
    };
    wrap(<FirstRunGate />);

    expect(screen.getByText(/not part of a squad yet/i)).toBeInTheDocument();
  });

  it('shows an archive reached without squad membership rather than the dead-end copy', () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: null,
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    wrap(<FirstRunGate />);

    expect(screen.queryByText(/not part of a squad yet/i)).not.toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /welcome to cloud codex/i })).toHaveAttribute('href', '/archives/5/doc/9');
  });

  it('points a squad-less member at their pending invitations when they have some', () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: null, archive: null, log: null, pendingSquadInvites: 2,
    };
    wrap(<FirstRunGate />);

    expect(screen.getByText(/2 pending squad invitations/i)).toBeInTheDocument();
  });

  it('calls complete() when dismissed', async () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: { id: 3, name: 'General' }, archive: null, log: null, pendingSquadInvites: 0,
    };
    const user = userEvent.setup();
    wrap(<FirstRunGate />);

    await user.click(screen.getByRole('button', { name: /get started/i }));
    expect(hookState.complete).toHaveBeenCalledTimes(1);
  });

  it('calls complete() when the document link itself is clicked', async () => {
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    const user = userEvent.setup();
    wrap(<FirstRunGate />);

    await user.click(screen.getByRole('link', { name: /welcome to cloud codex/i }));
    expect(hookState.complete).toHaveBeenCalledTimes(1);
  });

  it('awaits completion before navigating, so a slow POST cannot lose the race to the destination page', async () => {
    let resolveComplete;
    hookState.complete = vi.fn(() => new Promise((resolve) => { resolveComplete = resolve; }));
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<FirstRunGate />} />
          <Route path="/archives/5/doc/9" element={<div>Doc Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('link', { name: /welcome to cloud codex/i }));

    // The handler must call and await complete() before it navigates: the
    // route change has not happened yet, even though the click resolved.
    expect(hookState.complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Doc Page')).not.toBeInTheDocument();

    resolveComplete();
    await waitFor(() => expect(screen.getByText('Doc Page')).toBeInTheDocument());
  });

  it('still navigates when completion fails, so the user is never trapped under the overlay', async () => {
    hookState.complete = vi.fn().mockRejectedValue(new Error('network error'));
    hookState.firstRun = {
      needsOnboarding: true, isAdmin: false,
      squad: { id: 3, name: 'General' },
      archive: { id: 5, name: 'Getting Started' },
      log: { id: 9, title: 'Welcome to Cloud Codex' },
      pendingSquadInvites: 0,
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<FirstRunGate />} />
          <Route path="/archives/5/doc/9" element={<div>Doc Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('link', { name: /welcome to cloud codex/i }));
    await waitFor(() => expect(screen.getByText('Doc Page')).toBeInTheDocument());
  });
});
