/**
 * Regression test for #33: fetchEvents() must never fabricate a demo active event.
 * Covers both cases that used to trigger the demo fallback: an empty `events` table,
 * and a failed query.
 */
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import App from '../App';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
    rpc: jest.fn(() => Promise.resolve({ data: false, error: null })),
    from: jest.fn(),
  },
}));

const authenticatedSession = {
  user: { id: 'user-1', email: 'member@test.local' },
};

function mockEventsQuery({ data = null, error = null }) {
  supabase.from.mockImplementation((table) => {
    if (table === 'events') {
      return {
        select: () => ({
          order: () => Promise.resolve({ data, error }),
        }),
      };
    }
    // Any other table (e.g. profiles) a mounted view might touch: return an empty result.
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    };
  });
}

describe('App — fetchEvents never fabricates demo data (#33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    supabase.auth.getSession.mockResolvedValue({ data: { session: authenticatedSession }, error: null });
    supabase.rpc.mockResolvedValue({ data: false, error: null });
  });

  test('renders the empty state, not demo data, when the events table is empty', async () => {
    mockEventsQuery({ data: [], error: null });

    render(<BrowserRouter><App /></BrowserRouter>);

    expect(await screen.findByText('Aucun événement en cours')).toBeInTheDocument();
    expect(screen.queryByText('Weekend en montagne')).not.toBeInTheDocument();
  });

  test('renders the empty state, not demo data, when the events query errors', async () => {
    mockEventsQuery({ data: null, error: new Error('network error') });

    render(<BrowserRouter><App /></BrowserRouter>);

    expect(await screen.findByText('Aucun événement en cours')).toBeInTheDocument();
    expect(screen.queryByText('Weekend en montagne')).not.toBeInTheDocument();
  });
});
