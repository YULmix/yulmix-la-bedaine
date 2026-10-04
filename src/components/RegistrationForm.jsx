import { useState, useEffect, useMemo, useReducer, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Ban, CarFront, Check, Hand, Trash2, UserPlus
} from 'lucide-react';
import { ACCOMMODATION_ICONS, DIETARY_ICONS } from './accommodationIcons';
import { supabase } from '../lib/supabase';
import { saveRegistration } from '../lib/parties';
import { appError, dbErrorMessage } from '../lib/dbErrors';
import { attendeePrice, partyPrice, partyPricingOf } from '../lib/pricingEngine';
import fr from '../locales/fr.json';
import { formatCurrency } from '../lib/format';
import { plural, getTravelRange } from '../lib/eventDisplay';
import { useToasts } from '../hooks/useToasts';
import { Button, Card, ChipGroup, ConfirmDialog, Field, Input, Notice, Stepper, Textarea, Toggle, cx } from './ui';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  DIETARY_OPTIONS
} from '../lib/registrationOptions';
import {
  DEPARTURE_PLACE_MAX_LENGTH,
  fromParty,
  issuesUpToStep,
  registrationReducer,
  toSavePayload,
  validate
} from '../lib/registration';
import { draftFormFor, loadStoredDraft, makeDraft, sameFormState, storeDraft } from '../lib/registrationDraft';
import { normalizeFsa } from '../lib/postalCode';

const STEPS = [
  { id: 'who', labelKey: 'stepWho' },
  { id: 'stay', labelKey: 'stepStay' },
  { id: 'help', labelKey: 'stepHelp' },
  { id: 'review', labelKey: 'stepReview' }
];

const AGE_OPTIONS = [
  { value: 'Adult', label: fr.attendeeTypeAdult },
  { value: 'Teenager', label: fr.attendeeTypeTeenager },
  { value: 'Kid', label: fr.attendeeTypeKid }
];

const PRESENCE_OPTIONS = [
  { value: 'Whole', label: fr.participationWhole },
  { value: 'Main', label: fr.participationMainShort }
];

const TRANSPORT_ICONS = { offer: CarFront, need: Hand };

const withIcons = (options, icons) => options.map(option => ({ ...option, icon: icons[option.value] }));
const ACCOMMODATION_CHIPS = withIcons(ACCOMMODATION_OPTIONS, ACCOMMODATION_ICONS);
const DIETARY_CHIPS = withIcons(DIETARY_OPTIONS, DIETARY_ICONS);
const TRANSPORT_CHIPS = [{ value: '', label: fr.transportTypeNone, icon: Ban }, ...withIcons(TRANSPORT_TYPES, TRANSPORT_ICONS)];

// Per-attendee sleeping + food choices. Rendered once for the whole group ("mêmes choix pour
// tout le monde") or once per attendee. onChange takes a field and its value. Dietary needs are
// several choices (#153): the reducer keeps « Aucune restriction » alone, and drops the « Autre »
// text when « Autre » is unticked.
const StayChoices = ({ attendee, onChange, idPrefix, dietError }) => (
  <div className="space-y-6">
    <div className="space-y-3">
      <ChipGroup
        label={fr.accommodation}
        name={`${idPrefix}-sleep`}
        options={ACCOMMODATION_CHIPS}
        value={attendee.sleepingPreference}
        onChange={value => onChange('sleepingPreference', value)}
      />
      {attendee.sleepingPreference === 'bed' && (
        <div className="space-y-3 rounded-control border border-line bg-night/50 p-4">
          <ChipGroup
            label={fr.bedReason}
            name={`${idPrefix}-bed-reason`}
            size="sm"
            options={BED_REASON_OPTIONS}
            value={attendee.bedReason}
            onChange={value => onChange('bedReason', value)}
          />
          {attendee.bedReason === 'other' && (
            <Field label={fr.pleaseSpecify}>
              {({ id }) => <Input id={id} value={attendee.bedReasonOther} onChange={e => onChange('bedReasonOther', e.target.value)} placeholder={fr.bedReasonOtherPlaceholder} />}
            </Field>
          )}
        </div>
      )}
      {attendee.sleepingPreference === 'outside_other' && (
        <Field label={fr.pleaseSpecify}>
          {({ id }) => <Input id={id} value={attendee.sleepingPreferenceOther} onChange={e => onChange('sleepingPreferenceOther', e.target.value)} placeholder={fr.accommodationOutsideOtherPlaceholder} />}
        </Field>
      )}
    </div>
    <div className="space-y-3">
      <ChipGroup
        label={fr.dietaryNeeds}
        name={`${idPrefix}-diet`}
        multiple
        options={DIETARY_CHIPS}
        value={attendee.dietaryNeeds}
        onChange={value => onChange('dietaryNeeds', value)}
      />
      {attendee.dietaryNeeds.includes('other') && (
        <Field label={fr.pleaseSpecify} error={dietError} htmlFor={`diet-other-${idPrefix}`}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={attendee.dietaryOther} onChange={e => onChange('dietaryOther', e.target.value)} placeholder={fr.dietaryOtherPlaceholder} />}
        </Field>
      )}
    </div>
  </div>
);

const StepTitle = ({ title, text }) => (
  <div className="mb-6">
    <h2 className="font-display text-display-md text-ink">{title}</h2>
    {text && <p className="mt-2 max-w-2xl text-muted">{text}</p>}
  </div>
);

// Leaving the form in the app with unsaved changes asks first (#144). Its own component so the
// admin's registration dialog, which has no draft, never registers a second router blocker.
const LeaveGuard = ({ shouldBlock, onLeave }) => {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && shouldBlock());
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title={fr.registrationLeaveTitle}
      confirmLabel={fr.registrationLeaveConfirm}
      onConfirm={() => { onLeave(); blocker.proceed(); }}
      onCancel={() => blocker.reset()}
    >
      {fr.registrationLeaveBody}
    </ConfirmDialog>
  );
};

// A draft stored before a field existed lacks it: the form's state has every field, in the order
// fromParty gives them (the dirty check compares them as JSON).
const formOfDraft = draft => ({
  ...Object.fromEntries(Object.keys(fromParty(null)).map(key => [key, draft[key]])),
  transportDepartureFsa: draft.transportDepartureFsa ?? '',
  transportDeparturePlace: draft.transportDeparturePlace ?? ''
});

// `draftKey` (sessionStorage key, see registrationDraft.ts) keeps unsaved changes across a reload
// and guards against leaving them; without it (the admin's dialog) the form has neither.
// `initialStep` opens the form on a later step: the carpool board links an existing registration
// straight to its transport card (#180).
const RegistrationForm = ({ event, userRegistration, onRegistrationSuccess, onCancel, adminMode = false, onAdminSave, isIntent = false, draftKey = null, initialStep = 0 }) => {
  const travelRange = useMemo(() => getTravelRange(event), [event]);
  // What the form opens with: a draft this tab left for this registration, else what's saved.
  const [initial] = useState(() => {
    const draft = draftKey ? draftFormFor(loadStoredDraft(draftKey), userRegistration) : null;
    return { form: draft ? formOfDraft(draft) : fromParty(userRegistration, travelRange), restored: !!draft };
  });
  // The form's state; every rule between its fields is registration.ts's reducer.
  const [form, dispatch] = useReducer(registrationReducer, initial.form);
  const {
    attendees, sameForEveryone, transportType, transportSeats, transportArrival, transportDeparture,
    transportDepartureFsa, transportDeparturePlace, volunteeringSelections, volunteeringOtherDetail, musicRequests, messageToOrganizers
  } = form;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(initialStep);
  // The validation issues shown at their fields (registration.ts's validate), until fixed.
  const [shownIssues, setShownIssues] = useState([]);
  const [restored, setRestored] = useState(initial.restored);
  // The name filled in for a new registration (#133): part of the untouched form, not a change.
  const [prefilledName, setPrefilledName] = useState('');
  const { addToast } = useToasts();
  const formTopRef = useRef(null);
  const isEditing = !!userRegistration;

  const change = changes => dispatch({ type: 'changed', changes });

  // A new registration starts with arrival on the event's first day and departure on its last
  // (#123): most people stay the whole event. Only while a field is still empty, so it never
  // overwrites what the member picked, and never for a saved registration, even one whose saved
  // attendees were all removed (a cleared arrival restored from a draft stays cleared).
  useEffect(() => {
    if (isEditing) return;
    dispatch({ type: 'travelDefaultsApplied', travelRange: { defaultArrival: travelRange.defaultArrival, defaultDeparture: travelRange.defaultDeparture } });
  }, [isEditing, travelRange.defaultArrival, travelRange.defaultDeparture]);

  // A different registration handed in after the first render replaces the form. The same one
  // fetched again (a new object, as happens right after mounting) must not: it would wipe what
  // the member typed, or the draft just restored.
  const shownRegistration = useRef(fromParty(userRegistration));
  useEffect(() => {
    if (!userRegistration?.attendees || sameFormState(shownRegistration.current, fromParty(userRegistration))) return;
    shownRegistration.current = fromParty(userRegistration);
    dispatch({ type: 'replaced', form: fromParty(userRegistration, travelRange) });
    setRestored(false);
  }, [userRegistration, travelRange]);

  // A new registration starts with the member as its first attendee (#133): whoever registers
  // almost always comes. Only while that name is still empty, so it never overwrites typing.
  useEffect(() => {
    if (isEditing || adminMode) return undefined;
    let ignore = false;
    const prefillName = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const name = (data?.full_name || user.user_metadata?.full_name || '').trim();
      if (ignore || !name) return;
      setPrefilledName(name);
      dispatch({ type: 'namePrefilled', name });
    };
    prefillName();
    return () => { ignore = true; };
  }, [isEditing, adminMode]);

  // Fixing a field hides its issue; the others stay until the next check.
  const dismissIssues = (matches) => setShownIssues(current => (current.some(matches) ? current.filter(issue => !matches(issue)) : current));
  const issueAt = (field, attendeeId) => shownIssues.find(issue => issue.field === field && issue.attendeeId === attendeeId)?.message;

  // The reducer resets the seats, and with no lift the departure place (#179, #181).
  const changeTransportType = (type) => {
    if (type === transportType) return;
    change({ transportType: type });
    if (type !== 'offer' && type !== 'need') dismissIssues(issue => issue.field === 'transportDepartureFsa');
  };

  // Unsaved: the form differs from what it shows untouched (the saved registration, or a new one
  // with its defaults and prefilled name). Changing a field and back again is not a change.
  const untouchedForm = useMemo(() => {
    const untouched = fromParty(userRegistration, travelRange);
    if (userRegistration || !prefilledName) return untouched;
    return { ...untouched, attendees: [{ ...untouched.attendees[0], name: prefilledName }] };
  }, [userRegistration, travelRange, prefilledName]);
  const isDirty = !sameFormState(form, untouchedForm);

  // Set once the registration is saved or the member chose to leave: the draft is gone for good,
  // and the navigation that follows must not ask.
  const draftClosed = useRef(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const closeDraft = () => {
    draftClosed.current = true;
    storeDraft(draftKey, null);
  };

  const formJson = JSON.stringify(form);
  useEffect(() => {
    if (!draftKey || draftClosed.current) return;
    storeDraft(draftKey, isDirty ? makeDraft(JSON.parse(formJson), userRegistration) : null);
  }, [draftKey, formJson, isDirty, userRegistration]);

  // Closing or reloading the tab with unsaved changes asks first. A reload would restore them,
  // but a closed tab wouldn't.
  useEffect(() => {
    if (!draftKey || !isDirty) return undefined;
    const warn = (e) => { if (!draftClosed.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftKey, isDirty]);

  // An existing registration is priced at what it locked when it was made, not today's price (#117).
  const { basePrice, ratios } = useMemo(() => partyPricingOf(userRegistration, event), [userRegistration, event]);

  const estimatedBalance = useMemo(() => (event ? partyPrice(attendees, basePrice, ratios) : 0), [attendees, event, basePrice, ratios]);

  const isWaitlisted = !!(event?.max_attendees && attendees.length > event.max_attendees);

  const handleAddAttendee = () => dispatch({ type: 'attendeeAdded', id: `attendee-${Date.now()}` });

  const handleRemoveAttendee = (id) => dispatch({ type: 'attendeeRemoved', id });

  // A field and its value, or an object of several fields.
  const changesOf = (field, value) => (typeof field === 'object' ? field : { [field]: value });

  // An age pick also sets the tier a Kid has (the reducer's age rule).
  const handleAttendeeChange = (id, field, value) => {
    const changes = changesOf(field, value);
    dispatch({ type: 'attendeeChanged', id, changes });
    if (field === 'name' && value.trim()) dismissIssues(issue => issue.field === 'name' && issue.attendeeId === id);
    if ('dietaryNeeds' in changes || 'dietaryOther' in changes) dismissIssues(issue => issue.field === 'dietaryOther' && issue.attendeeId === id);
  };

  // "Mêmes choix pour tout le monde": edits go to everyone at once.
  const handleGroupStayChange = (field, value) => {
    const changes = changesOf(field, value);
    dispatch({ type: 'groupStayChanged', changes });
    if ('dietaryNeeds' in changes || 'dietaryOther' in changes) dismissIssues(issue => issue.field === 'dietaryOther');
  };

  // The input an issue points at. With one set of choices for the group, a diet issue is the
  // group's « Autre » text.
  const inputIdOf = (issue) => {
    if (issue.field === 'name') return `name-${issue.attendeeId}`;
    if (issue.field === 'dietaryOther') return `diet-other-${sameForEveryone || attendees.length === 1 ? 'group' : issue.attendeeId}`;
    return 'transport-departure-fsa';
  };

  // Whether nothing in `issues` (in step order) blocks. The steps are checked in order, up to
  // `lastStep` or the first with an issue: those steps show their issues now, the later ones keep
  // what they showed. With an issue, the form goes to its step and focuses its field.
  const passes = (issues, lastStep) => {
    const [first] = issues;
    const checkedUpTo = first ? first.step : lastStep;
    setShownIssues(current => [...current.filter(issue => issue.step > checkedUpTo), ...issues.filter(issue => issue.step === checkedUpTo)]);
    if (!first) return true;
    setStep(first.step);
    requestAnimationFrame(() => document.getElementById(inputIdOf(first))?.focus());
    return false;
  };

  const goToStep = (index) => {
    if (index > step && !passes(issuesUpToStep(validate(form), step), step)) return;
    setStep(index);
    requestAnimationFrame(() => formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step < STEPS.length - 1 && !isEditing) {
      goToStep(step + 1);
      return;
    }
    if (!passes(validate(form), STEPS.length - 1)) return;
    if (!event || !event.id) {
      setError(fr.eventNotSpecifiedError);
      addToast(fr.eventNotSpecifiedError, 'error');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Party and attendees in one transaction. The database takes the member from the session
      // (an admin saves for the party's member), computes the amount owed, the price lock and the
      // waitlist, registers the party (again, if it was cancelled), and leaves payment_status and
      // admin_notes alone.
      const savedParty = await saveRegistration(supabase, {
        eventId: event.id,
        ...toSavePayload(form),
        userId: adminMode ? userRegistration?.user_id : undefined
      });

      if (!savedParty) {
        throw appError(fr.noRowReturnedError);
      }

      if (draftKey) closeDraft();
      if (adminMode && onAdminSave) {
        onAdminSave();
      } else if (onRegistrationSuccess) {
        onRegistrationSuccess(savedParty);
      }
    } catch (err) {
      console.error('Erreur lors de l\'inscription:', err);
      const message = dbErrorMessage(err, fr.saveError);
      setError(message);
      addToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;
  const saveLabel = isEditing ? fr.saveChangesButton : isIntent ? fr.saveIntentButton : fr.saveRegistrationButton;

  return (
    <form onSubmit={handleSubmit} noValidate className="relative">
      <div ref={formTopRef} className="scroll-mt-24" />

      {/* Step header: every step is reachable; moving forward from step 1 validates names. */}
      <nav aria-label={fr.registrationStepsLabel} className="mb-6">
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((s, index) => {
            const isCurrent = index === step;
            const hasError = shownIssues.some(issue => issue.step === index);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goToStep(index)}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="group flex w-full flex-col gap-2 py-1 text-left"
                >
                  <span className={cx('h-1 w-full rounded-full transition duration-250', index <= step ? 'bg-neon' : 'bg-line', hasError && 'bg-bad')} />
                  <span className={cx('text-sm font-semibold leading-tight', isCurrent ? 'text-ink' : 'text-faint group-hover:text-muted')}>
                    <span className="font-data text-xs">{index + 1}</span>
                    <span className="sr-only sm:not-sr-only"> {fr[s.labelKey]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {draftKey && <LeaveGuard shouldBlock={() => dirtyRef.current && !draftClosed.current} onLeave={closeDraft} />}
      {restored && isDirty && <Notice tone="info" className="mb-6">{fr.registrationDraftRestored}</Notice>}
      {error && <Notice tone="bad" className="mb-6">{error}</Notice>}

      <div key={step} className="animate-step">
        {step === 0 && (
          <section>
            <StepTitle title={isIntent ? fr.stepWhoIntentTitle : fr.stepWhoTitle} text={fr.stepWhoText} />
            <ul className="space-y-4">
              {attendees.map((attendee, index) => (
                <li key={attendee.id}>
                  <Card className="p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-muted">
                        {fr.participantNumberLabel}{index + 1}
                      </h3>
                      <div className="flex items-center gap-2">
                        {basePrice > 0 && (
                          <span className="font-data text-sm text-ink">{formatCurrency(attendeePrice(attendee, basePrice, ratios))}</span>
                        )}
                        {attendees.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveAttendee(attendee.id)}
                            aria-label={fr.removeAttendeeLabel.replace('{name}', attendee.name || `${fr.participantNumberLabel}${index + 1}`)}
                          >
                            <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-5">
                      <Field label={fr.fullNameLabel} error={issueAt('name', attendee.id)} htmlFor={`name-${attendee.id}`}>
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            value={attendee.name}
                            onChange={(e) => handleAttendeeChange(attendee.id, 'name', e.target.value)}
                            placeholder={fr.fullNamePlaceholder}
                            autoComplete={index === 0 ? 'name' : 'off'}
                            required
                          />
                        )}
                      </Field>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <ChipGroup
                          label={fr.ageLabel}
                          name={`age-${attendee.id}`}
                          options={AGE_OPTIONS}
                          value={attendee.type}
                          onChange={value => handleAttendeeChange(attendee.id, 'type', value)}
                        />
                        {attendee.type !== 'Kid' ? (
                          <ChipGroup
                            label={fr.presenceLabel}
                            name={`presence-${attendee.id}`}
                            options={PRESENCE_OPTIONS}
                            value={attendee.participation}
                            onChange={value => handleAttendeeChange(attendee.id, 'participation', value)}
                          />
                        ) : (
                          <p className="self-end text-sm text-faint">{fr.kidsFreeNotice}</p>
                        )}
                      </div>
                      <Toggle
                        label={fr.firstTimeAttendee}
                        description={fr.firstTimeToggleHint}
                        checked={attendee.isNewMember}
                        onChange={value => handleAttendeeChange(attendee.id, 'isNewMember', value)}
                      />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={handleAddAttendee} className="mt-4 w-full border-dashed sm:w-auto">
              <UserPlus aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
              {fr.addParticipantButton}
            </Button>
          </section>
        )}

        {step === 1 && (
          <section>
            <StepTitle title={fr.stepStayTitle} text={fr.accommodationNotice} />
            {attendees.length > 1 && (
              <Card className="mb-4 px-5 py-3">
                <Toggle label={fr.sameForEveryone} checked={sameForEveryone} onChange={value => change({ sameForEveryone: value })} />
              </Card>
            )}
            {sameForEveryone || attendees.length === 1 ? (
              <Card className="p-5">
                <StayChoices attendee={attendees[0]} onChange={handleGroupStayChange} idPrefix="group" dietError={issueAt('dietaryOther', attendees[0].id)} />
              </Card>
            ) : (
              <ul className="space-y-4">
                {attendees.map((attendee, index) => (
                  <li key={attendee.id}>
                    <Card className="p-5">
                      <h3 className="mb-4 text-lg font-semibold text-ink">{attendee.name || `${fr.participantNumberLabel}${index + 1}`}</h3>
                      <StayChoices
                        attendee={attendee}
                        onChange={(field, value) => handleAttendeeChange(attendee.id, field, value)}
                        idPrefix={attendee.id}
                        dietError={issueAt('dietaryOther', attendee.id)}
                      />
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-sm text-faint">{fr.foodNotice}</p>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <StepTitle title={fr.stepHelpTitle} text={fr.stepHelpText} />
            <Card id="transport" className="scroll-mt-24 space-y-5 p-5">
              <h3 className="text-lg font-semibold text-ink">{fr.transport}</h3>
              <ChipGroup label={fr.transportType} name="transport-type" options={TRANSPORT_CHIPS} value={transportType} onChange={changeTransportType} />
              {(transportType === 'offer' || transportType === 'need') && (
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="transport-seats" className="text-base text-ink">{transportType === 'need' ? fr.transportSeatsNeededLabel : fr.transportSeats}</label>
                  <Stepper id="transport-seats" label={transportType === 'need' ? fr.transportSeatsNeededLabel : fr.transportSeats}
                    value={transportSeats} onChange={value => change({ transportSeats: value })} min={transportType === 'need' ? 1 : 0} max={20} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={fr.transportArrival} className="min-w-0">
                  {({ id }) => <Input id={id} type="datetime-local" min={travelRange.min || undefined} max={travelRange.max || undefined} className="min-w-0 max-w-full" value={transportArrival} onChange={(e) => change({ transportArrival: e.target.value })} />}
                </Field>
                <Field label={fr.transportDeparture} className="min-w-0">
                  {({ id }) => <Input id={id} type="datetime-local" min={travelRange.min || undefined} max={travelRange.max || undefined} className="min-w-0 max-w-full" value={transportDeparture} onChange={(e) => change({ transportDeparture: e.target.value })} />}
                </Field>
              </div>
              {(transportType === 'offer' || transportType === 'need') && (
                <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
                  <Field label={fr.transportDepartureFsa} hint={fr.transportDepartureFsaHint} error={issueAt('transportDepartureFsa')} htmlFor="transport-departure-fsa" className="min-w-0">
                    {({ id, describedBy, invalid }) => (
                      <Input id={id} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={7}
                        placeholder={fr.transportDepartureFsaPlaceholder} aria-describedby={describedBy} invalid={invalid}
                        className="font-data" value={transportDepartureFsa}
                        onChange={(e) => { change({ transportDepartureFsa: e.target.value.toUpperCase() }); dismissIssues(issue => issue.field === 'transportDepartureFsa'); }}
                        onBlur={(e) => change({ transportDepartureFsa: normalizeFsa(e.target.value) })} />
                    )}
                  </Field>
                  <Field label={fr.transportDeparturePlace} className="min-w-0">
                    {({ id }) => <Input id={id} type="text" maxLength={DEPARTURE_PLACE_MAX_LENGTH} placeholder={fr.transportDeparturePlacePlaceholder} value={transportDeparturePlace} onChange={(e) => change({ transportDeparturePlace: e.target.value })} />}
                  </Field>
                </div>
              )}
            </Card>
            <Card className="space-y-4 p-5">
              <ChipGroup
                label={fr.volunteering}
                multiple
                size="sm"
                options={VOLUNTEERING_OPTIONS}
                value={volunteeringSelections}
                onChange={value => change({ volunteeringSelections: value })}
              />
              {volunteeringSelections.includes('other') && (
                <Field label={fr.pleaseSpecify}>
                  {({ id }) => <Input id={id} value={volunteeringOtherDetail} onChange={(e) => change({ volunteeringOtherDetail: e.target.value })} placeholder={fr.volunteeringOtherPlaceholder} />}
                </Field>
              )}
            </Card>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <StepTitle title={fr.stepReviewTitle} />
            <Card className="space-y-5 p-5">
              <Field label={fr.musicRequests}>
                {({ id }) => <Textarea id={id} value={musicRequests} onChange={(e) => change({ musicRequests: e.target.value })} placeholder={fr.musicRequestsPlaceholder} />}
              </Field>
              <Field label={fr.messageToOrganizers}>
                {({ id }) => <Textarea id={id} value={messageToOrganizers} onChange={(e) => change({ messageToOrganizers: e.target.value })} placeholder={fr.messageToOrganizersPlaceholder} />}
              </Field>
            </Card>
            <Card className="p-5">
              <h3 className="text-lg font-semibold text-ink">{fr.registrationFormSummaryTitle}</h3>
              <ul className="mt-3 divide-y divide-line">
                {attendees.map((attendee, index) => (
                  <li key={attendee.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-ink">
                      {attendee.name || `${fr.participantNumberLabel}${index + 1}`}
                      {attendee.isNewMember && <Check aria-label={fr.firstTimeTag} className="ml-2 inline size-4 text-neon" />}
                    </span>
                    {basePrice > 0 && <span className="font-data text-sm text-muted">{formatCurrency(attendeePrice(attendee, basePrice, ratios))}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-faint">{fr.firstTimeDiscountNotice}</p>
            </Card>
          </section>
        )}
      </div>

      {/* Sticky action bar: the running total and the next action, always in the thumb zone. */}
      <div className="sticky bottom-0 z-40 -mx-4 mt-8 border-t border-line bg-night/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md md:mx-0 md:rounded-card md:border md:px-5">
        {isWaitlisted && <p className="mb-2 text-sm text-warn">{fr.waitlistWarning}</p>}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0" aria-live="polite">
            <p className="whitespace-nowrap text-xs text-muted">
              {fr.estimatedAmountDueLabel}
              <span className="hidden sm:inline">, {plural(attendees.length, 'countPersonOne', 'countPersonOther')}</span>
            </p>
            <p className="font-data text-xl font-medium text-ink">{formatCurrency(estimatedBalance)}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Cancelling is the close button above the form (page header or dialog header).
                When editing, save is possible from any step, so the step arrows flank it:
                back on the left, forward on the right, matching the step header's direction. */}
            {step > 0 && (
              <Button variant="secondary" size="icon" onClick={() => goToStep(step - 1)} aria-label={fr.previousStep}>
                <ArrowLeft aria-hidden="true" className="size-5" />
              </Button>
            )}
            <Button type="submit" loading={isSubmitting}>
              {isSubmitting
                ? (adminMode ? fr.updatingInProgress : fr.savingInProgress)
                : (isLastStep || isEditing) ? saveLabel : (
                  <>
                    {fr.nextStep}
                    <ArrowRight aria-hidden="true" className="size-4.5" />
                  </>
                )}
            </Button>
            {isEditing && (isLastStep
              // Keeps the save button anchored in place when the forward arrow goes away.
              ? <span aria-hidden="true" className="size-11" />
              : (
                <Button variant="secondary" size="icon" onClick={() => goToStep(step + 1)} aria-label={fr.nextStep}>
                  <ArrowRight aria-hidden="true" className="size-5" />
                </Button>
              ))}
          </div>
        </div>
      </div>
    </form>
  );
};

export default RegistrationForm;
