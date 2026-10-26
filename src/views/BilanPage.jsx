import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, EyeOff, LockKeyhole, MessageSquareText, Plus, RotateCw, Trash2, UserX } from 'lucide-react';
import PosterHeader from '../components/brand/PosterHeader';
import FeedbackCategoryCard from '../components/FeedbackCategoryCard';
import { Button, Card, EmptyState, Notice, Skeleton, Textarea, Toggle, cx } from '../components/ui';
import fr from '../locales/fr.json';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import {
  FEEDBACK_CATEGORIES,
  addOtherKind,
  canRemoveDraft,
  canSwitchKind,
  categoryLabel,
  draftsFrom,
  draftsUnsaved,
  feedbackPageState,
  fetchMyEventFeedback,
  itemOf,
  itemsFromDrafts,
  otherKindToAdd,
  removeDraft,
  setDraftPrivate,
  setDraftText,
  submitEventFeedback
} from '../lib/eventFeedback';

// The member's retour on one event (#316), at /bilan/:eventId. The database (#315, #354, ADR 0029)
// decides the window, who may answer and what is shown; this page reads my_event_feedback() once
// and shows its state (src/lib/eventFeedback.ts).
//
// Each category card holds one comment, signed by default, with a « Privé » switch; once it has
// text, the other kind can be added beside it, never more than two (#355). The form's state is
// src/lib/eventFeedback.ts's drafts.
//
// The unsaved text lives in this component's state only: it survives a tab refocus because the
// route doesn't remount (#139), and nothing of it is written to storage, a URL or a log, so a
// private comment leaves nothing on the device once the tab is gone (ADR 0029).

const MAX_LENGTH = 5000;

const backHome = <Link to="/" className="font-semibold text-neon underline underline-offset-4">{fr.backToHome}</Link>;

const PageSkeleton = () => (
  <div aria-busy="true" className="space-y-4">
    <span className="sr-only">{fr.loading}</span>
    <Skeleton className="h-8 w-1/2" />
    <Skeleton className="h-28" />
    <Skeleton className="h-28" />
  </div>
);

// Who reads what, and when, from the member's side, before anything is sent.
const WhoSees = ({ closesOn }) => (
  <div className="rounded-control border border-line bg-night/40 p-4" data-testid="bilan-who-sees">
    <p className="text-sm font-semibold text-ink">{fr.bilanWhoSeesTitle}</p>
    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
      <li>{fr.bilanWhoSeesSigned}</li>
      <li>{fr.bilanWhoSeesPrivate}</li>
      <li>{fr.bilanWhoSeesAfterClose.replace('{date}', formatDate(closesOn))}</li>
    </ul>
  </div>
);

// The member's own signed comments after the close: the categories with one, as the same cards as
// the form's (#352), read-only. After the close my_event_feedback() returns signed items only.
const ReadOnlyAnswer = ({ items }) => (
  <div className="space-y-4">
    {FEEDBACK_CATEGORIES.map(category => [category, itemOf(items, category, false)])
      .filter(([, item]) => item)
      .map(([category, item]) => (
        <FeedbackCategoryCard key={category} category={category} titleId={`bilan-answer-${category}`} titleAs="h3">
          <div className="p-3 sm:p-4">
            <p className="rounded-control bg-raised px-4 py-3 whitespace-pre-line text-ink [overflow-wrap:anywhere]">{item.text}</p>
          </div>
        </FeedbackCategoryCard>
      ))}
  </div>
);

// One comment of a card: its kind as the textarea's label (with the card's title), the text, then
// the « Privé » switch while it is alone on the card, or what its kind means when there are two.
// `focusRequest` ({ slot }) moves the focus to this comment's text when it names its slot: after an
// add or a remove, whose button is gone.
const Comment = ({ category, titleId, card, draft, focusRequest, onText, onPrivate, onRemove }) => {
  const id = useId();
  const textRef = useRef(null);
  useEffect(() => {
    if (focusRequest?.slot === draft.slot) textRef.current?.focus();
  }, [focusRequest, draft.slot]);
  const kindId = `${id}-kind`;
  const hintId = `${id}-hint`;
  const label = categoryLabel(category);
  const hint = draft.private ? fr.bilanPrivateHint : fr.bilanSignedHint;
  return (
    <div className="space-y-2" data-testid="bilan-comment" data-kind={draft.private ? 'private' : 'signed'}>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p id={kindId} className={cx('text-sm font-semibold', draft.private ? 'text-info' : 'text-muted')}>
          {draft.private ? fr.bilanCommentPrivate : fr.bilanCommentSigned}
        </p>
        {canRemoveDraft(card, draft) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={(draft.private ? fr.bilanRemovePrivateLabel : fr.bilanRemoveSignedLabel).replace('{category}', label)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {fr.bilanRemoveComment}
          </Button>
        )}
      </div>
      <Textarea
        ref={textRef}
        rows={3}
        maxLength={MAX_LENGTH}
        value={draft.text}
        onChange={changeEvent => onText(changeEvent.target.value)}
        aria-labelledby={`${titleId} ${kindId}`}
        aria-describedby={hintId}
        className="min-h-24"
      />
      {canSwitchKind(card) ? (
        <Toggle
          label={fr.bilanPrivateToggle}
          description={<span id={hintId}>{hint}</span>}
          checked={draft.private}
          onChange={onPrivate}
          switchLabel={fr.bilanPrivateSwitchLabel.replace('{category}', label)}
        />
      ) : (
        <p id={hintId} className="text-sm text-faint">{hint}</p>
      )}
    </div>
  );
};

// One category of the form: its card, with its one or two comments and the add-the-other-kind action.
const CategoryField = ({ category, card, onChange }) => {
  const titleId = `bilan-field-${category}`;
  const toAdd = otherKindToAdd(card);
  const [focusRequest, setFocusRequest] = useState(null);
  const add = () => {
    onChange(drafts => addOtherKind(drafts, category));
    setFocusRequest({ slot: card[0].slot === 'a' ? 'b' : 'a' });
  };
  const remove = slot => {
    onChange(drafts => removeDraft(drafts, category, slot));
    setFocusRequest({ slot: card.find(draft => draft.slot !== slot)?.slot ?? 'a' });
  };
  return (
    <FeedbackCategoryCard category={category} titleId={titleId} titleAs="h3" region={false}>
      <div className="space-y-4 p-3 sm:p-4">
        {card.map((draft, index) => (
          <div key={draft.slot} className={cx(index > 0 && 'border-t border-line pt-4')}>
            <Comment
              category={category}
              titleId={titleId}
              card={card}
              draft={draft}
              focusRequest={focusRequest}
              onText={text => onChange(drafts => setDraftText(drafts, category, draft.slot, text))}
              onPrivate={isPrivate => onChange(drafts => setDraftPrivate(drafts, category, draft.slot, isPrivate))}
              onRemove={() => remove(draft.slot)}
            />
          </div>
        ))}
        {toAdd !== null && (
          <Button variant="secondary" size="sm" onClick={add}>
            <Plus aria-hidden="true" className="size-4" />
            {toAdd ? fr.bilanAddPrivate : fr.bilanAddSigned}
          </Button>
        )}
      </div>
    </FeedbackCategoryCard>
  );
};

const FeedbackForm = ({ eventId, feedback, onSaved }) => {
  const saved = feedback.items;
  const [drafts, setDrafts] = useState(() => draftsFrom(saved));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  const change = update => {
    setDrafts(update);
    setJustSaved(false);
  };

  const handleSubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    setJustSaved(false);
    const items = itemsFromDrafts(drafts);
    // Nothing written and nothing saved: the button is disabled, nothing to send. With saved
    // comments, an empty form is sent: the save replaces the whole set, so it removes them all (#354).
    if (items.length === 0 && saved.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const savedItems = await submitEventFeedback(supabase, eventId, items);
      // What the database kept (trimmed, blanks dropped) is the new saved state and the form's.
      setDrafts(draftsFrom(savedItems));
      setJustSaved(true);
      onSaved(savedItems);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const unsaved = draftsUnsaved(drafts, saved);
  const nothingToSend = saved.length === 0 && itemsFromDrafts(drafts).length === 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <WhoSees closesOn={feedback.closes_on} />

      <div className="space-y-4">
        {FEEDBACK_CATEGORIES.map(category => (
          <CategoryField key={category} category={category} card={drafts[category]} onChange={change} />
        ))}
      </div>

      {error && <Notice tone="bad">{error}</Notice>}
      {justSaved && !unsaved && (
        <Notice tone="ok" icon={CheckCircle2} role="status" title={fr.bilanSavedTitle} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-faint">{fr.bilanEditableUntil.replace('{date}', formatDate(feedback.closes_on))}</p>
        <Button type="submit" loading={saving} disabled={nothingToSend} className="sm:shrink-0">
          {saved.length > 0 ? fr.bilanSubmitEdit : fr.bilanSubmit}
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
              <ReadOnlyAnswer items={feedback.items} />
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
                onSaved={items => setFeedback(current => ({ ...current, items }))}
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BilanPage;
