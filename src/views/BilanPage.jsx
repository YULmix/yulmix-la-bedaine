import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, EyeOff, LockKeyhole, MessageSquareText, RotateCw, UserX } from 'lucide-react';
import PosterHeader from '../components/brand/PosterHeader';
import { Button, Card, ChipGroup, EmptyState, Field, Notice, Skeleton, Textarea } from '../components/ui';
import fr from '../locales/fr.json';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import {
  FEEDBACK_CATEGORIES,
  answersFrom,
  categoryLabel,
  feedbackPageState,
  fetchMyEventFeedback,
  hasAnyAnswer,
  isUnsaved,
  submitEventFeedback
} from '../lib/eventFeedback';

// The member's post-mortem of one event, « bilan » (#316), at /bilan/:eventId. The database
// (#315, ADR 0029) decides the window, who may answer and what is shown; this page reads
// my_event_feedback() once and shows its state (src/lib/eventFeedback.ts).
//
// The unsaved text lives in this component's state only: it survives a tab refocus because the
// route doesn't remount (#139), and nothing of it is written to storage, a URL or a log, so an
// anonymous answer leaves nothing on the device once the tab is gone (ADR 0029).

const MAX_LENGTH = 5000;
const IDENTITY_OPTIONS = [
  { value: 'named', label: fr.bilanIdentityNamed },
  { value: 'anonymous', label: fr.bilanIdentityAnonymous }
];

const backHome = <Link to="/" className="font-semibold text-neon underline underline-offset-4">{fr.backToHome}</Link>;

const PageSkeleton = () => (
  <div aria-busy="true" className="space-y-4">
    <span className="sr-only">{fr.loading}</span>
    <Skeleton className="h-8 w-1/2" />
    <Skeleton className="h-28" />
    <Skeleton className="h-28" />
  </div>
);

// Who reads what, and when: next to the anonymity choice, before anything is sent.
const WhoSees = ({ closesOn }) => (
  <div className="rounded-control border border-line bg-night/40 p-4">
    <p className="text-sm font-semibold text-ink">{fr.bilanWhoSeesTitle}</p>
    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
      <li>{fr.bilanWhoSeesNobodyBefore.replace('{date}', formatDate(closesOn))}</li>
      <li>{fr.bilanWhoSeesNamed}</li>
      <li>{fr.bilanWhoSeesAnonymous}</li>
      <li>{fr.bilanWhoSeesAfterClose.replace('{date}', formatDate(closesOn))}</li>
    </ul>
  </div>
);

const ReadOnlyAnswer = ({ answer }) => (
  <dl className="space-y-4">
    {FEEDBACK_CATEGORIES.filter(category => answer.answers?.[category]).map(category => (
      <div key={category}>
        <dt className="text-sm font-semibold text-muted">{categoryLabel(category)}</dt>
        <dd className="mt-1 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{answer.answers[category]}</dd>
      </div>
    ))}
  </dl>
);

const FeedbackForm = ({ eventId, feedback, onSaved }) => {
  const saved = feedback.answer;
  const [answers, setAnswers] = useState(() => answersFrom(saved));
  const [isAnonymous, setIsAnonymous] = useState(() => !!saved?.is_anonymous);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  const setAnswer = (category, text) => {
    setAnswers(current => ({ ...current, [category]: text }));
    setJustSaved(false);
  };

  const handleSubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    setJustSaved(false);
    // The database refuses it too (event_feedback_empty); this saves the round trip.
    if (!hasAnyAnswer(answers)) {
      setError(fr.dbErrorEventFeedbackEmpty);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const answer = await submitEventFeedback(supabase, eventId, answers, isAnonymous);
      // What the database kept (trimmed, blanks dropped) is the new saved state and the form's.
      setAnswers(answersFrom(answer));
      setIsAnonymous(answer.is_anonymous);
      setJustSaved(true);
      onSaved(answer);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const unsaved = isUnsaved(answers, isAnonymous, saved);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-5">
        {FEEDBACK_CATEGORIES.map(category => (
          <Field key={category} label={categoryLabel(category)}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={MAX_LENGTH}
                value={answers[category]}
                onChange={changeEvent => setAnswer(category, changeEvent.target.value)}
                className="min-h-24"
              />
            )}
          </Field>
        ))}
      </div>

      <div className="space-y-3">
        <ChipGroup
          label={fr.bilanIdentityLabel}
          options={IDENTITY_OPTIONS}
          value={isAnonymous ? 'anonymous' : 'named'}
          onChange={value => { setIsAnonymous(value === 'anonymous'); setJustSaved(false); }}
        />
        <p className="text-sm text-ink" data-testid="bilan-identity-hint">
          {fr.bilanIdentityHint.replace('{date}', formatDate(feedback.closes_on))}
        </p>
        <WhoSees closesOn={feedback.closes_on} />
      </div>

      {error && <Notice tone="bad">{error}</Notice>}
      {justSaved && !unsaved && (
        <Notice tone="ok" icon={CheckCircle2} role="status" title={fr.bilanSavedTitle} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-faint">{fr.bilanEditableUntil.replace('{date}', formatDate(feedback.closes_on))}</p>
        <Button type="submit" loading={saving} className="sm:shrink-0">
          {saved ? fr.bilanSubmitEdit : fr.bilanSubmit}
        </Button>
      </div>
    </form>
  );
};

const BilanPage = ({ events = [] }) => {
  const { eventId } = useParams();
  const event = events.find(candidate => candidate?.id === eventId) || null;
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // Keyed on the event only: an auth event on tab refocus re-renders the app, and must not
  // reload (and reset) the form.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    fetchMyEventFeedback(supabase, eventId)
      .then(result => { if (current) setFeedback(result); })
      .catch(loadError => { if (current) setError(loadError.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [eventId, attempt]);

  const state = feedback ? feedbackPageState(feedback) : null;

  return (
    <div className="space-y-6">
      {event && <PosterHeader event={event} compact />}

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl text-ink">
          <MessageSquareText aria-hidden="true" className="size-6 shrink-0 text-neon" strokeWidth={1.75} />
          {fr.bilanPageTitle}
        </h2>

        <div className="mt-5" data-testid="bilan-body" data-state={state || (error ? 'error' : 'loading')}>
          {loading && !feedback ? (
            <PageSkeleton />
          ) : error ? (
            <Notice
              tone="bad"
              title={fr.bilanLoadError}
              action={<Button variant="secondary" size="sm" onClick={() => setAttempt(n => n + 1)}><RotateCw aria-hidden="true" className="size-4" />{fr.retry}</Button>}
            >
              {error}
            </Notice>
          ) : state === 'hidden' ? (
            <EmptyState icon={EyeOff} title={fr.bilanHiddenTitle} action={backHome}>{fr.bilanHiddenMessage}</EmptyState>
          ) : state === 'closed_named' ? (
            <div className="space-y-5">
              <Notice tone="info" icon={LockKeyhole} title={fr.bilanClosedNamedTitle}>{fr.bilanClosedNamedMessage}</Notice>
              <ReadOnlyAnswer answer={feedback.answer} />
            </div>
          ) : state === 'not_eligible' ? (
            <EmptyState icon={UserX} title={fr.bilanNotEligibleTitle} action={backHome}>{fr.bilanNotEligibleMessage}</EmptyState>
          ) : state === 'closed' ? (
            <EmptyState icon={LockKeyhole} title={fr.bilanClosedTitle} action={backHome}>{fr.bilanClosedMessage}</EmptyState>
          ) : state === 'not_yet' ? (
            <EmptyState icon={CalendarClock} title={fr.bilanNotYetTitle} action={backHome}>
              {feedback.opens_on ? fr.bilanNotYetMessage.replace('{date}', formatDate(feedback.opens_on)) : fr.bilanNotYetNoDate}
            </EmptyState>
          ) : (
            <>
              <p className="mb-6 text-muted">{fr.bilanIntro}</p>
              <FeedbackForm
                eventId={eventId}
                feedback={feedback}
                onSaved={answer => setFeedback(current => ({ ...current, answer }))}
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BilanPage;
