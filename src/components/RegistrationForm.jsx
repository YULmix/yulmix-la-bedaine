import { useState, useEffect, useMemo, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Ban, CarFront, Check, Hand, Leaf, MilkOff, Sprout, Trash2, UserPlus, Utensils, WheatOff
} from 'lucide-react';
import { ACCOMMODATION_ICONS } from './accommodationIcons';
import { supabase } from '../lib/supabase';
import { saveRegistration } from '../lib/parties';
import { appError, dbErrorMessage } from '../lib/dbErrors';
import { attendeePrice, partyPricingOf, simulateEventPricing } from '../lib/pricingEngine';
import fr from '../locales/fr.json';
import { formatCurrency } from '../lib/format';
import { plural, getTravelRange } from '../lib/eventDisplay';
import { useToasts } from '../hooks/useToasts';
import ToastContainer from './Toast';
import { Button, Card, ChipGroup, ConfirmDialog, Field, Input, Notice, Stepper, Textarea, Toggle, cx } from './ui';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  DIETARY_OPTIONS,
  nextDietaryNeeds
} from '../lib/registrationOptions';
import {
  DEPARTURE_PLACE_MAX_LENGTH,
  LOGISTICS_FIELDS,
  departureFsaInvalid,
  draftFormFor,
  formStateOf,
  loadStoredDraft,
  makeDraft,
  newAttendee,
  sameChoice,
  sameFormState,
  storeDraft,
  transportOf
} from '../lib/registrationDraft';
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

const DIETARY_ICONS = { none: Ban, vegetarian: Leaf, vegan: Sprout, gluten_free: WheatOff, dairy_free: MilkOff, other: Utensils };
const TRANSPORT_ICONS = { offer: CarFront, need: Hand };

const withIcons = (options, icons) => options.map(option => ({ ...option, icon: icons[option.value] }));
const ACCOMMODATION_CHIPS = withIcons(ACCOMMODATION_OPTIONS, ACCOMMODATION_ICONS);
const DIETARY_CHIPS = withIcons(DIETARY_OPTIONS, DIETARY_ICONS);
const TRANSPORT_CHIPS = [{ value: '', label: fr.transportTypeNone, icon: Ban }, ...withIcons(TRANSPORT_TYPES, TRANSPORT_ICONS)];

const needsDietaryDetail = attendee => attendee.dietaryNeeds.includes('other') && !attendee.dietaryOther.trim();

// Per-attendee sleeping + food choices. Rendered once for the whole group ("mêmes choix pour
// tout le monde") or once per attendee. onChange takes a field and its value, or several fields.
// Dietary needs are several choices (#153): « Aucune restriction » alone, and unticking « Autre »
// drops its text.
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
        onChange={value => {
          const dietaryNeeds = nextDietaryNeeds(attendee.dietaryNeeds, value);
          onChange(dietaryNeeds.includes('other') ? { dietaryNeeds } : { dietaryNeeds, dietaryOther: '' });
        }}
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

// `draftKey` (sessionStorage key, see registrationDraft.js) keeps unsaved changes across a reload
// and guards against leaving them; without it (the admin's dialog) the form has neither.
// `initialStep` opens the form on a later step: the carpool board links an existing registration
// straight to its transport card (#180).
const RegistrationForm = ({ event, userRegistration, onRegistrationSuccess, onCancel, adminMode = false, onAdminSave, isIntent = false, draftKey = null, initialStep = 0 }) => {
  const travelRange = useMemo(() => getTravelRange(event), [event]);
  // What the form opens with: a draft this tab left for this registration, else what's saved.
  const [initial] = useState(() => {
    const draft = draftKey ? draftFormFor(loadStoredDraft(draftKey), userRegistration) : null;
    return { form: draft || formStateOf(userRegistration, travelRange), restored: !!draft };
  });
  const [attendees, setAttendees] = useState(initial.form.attendees);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(initialStep);
  const [nameErrors, setNameErrors] = useState({});
  const [dietErrors, setDietErrors] = useState({});

  const [sameForEveryone, setSameForEveryone] = useState(initial.form.sameForEveryone);
  const [transportType, setTransportType] = useState(initial.form.transportType);
  const [transportSeats, setTransportSeats] = useState(initial.form.transportSeats);
  const [transportArrival, setTransportArrival] = useState(initial.form.transportArrival);
  const [transportDeparture, setTransportDeparture] = useState(initial.form.transportDeparture);
  const [transportDepartureFsa, setTransportDepartureFsa] = useState(initial.form.transportDepartureFsa ?? '');
  const [transportDeparturePlace, setTransportDeparturePlace] = useState(initial.form.transportDeparturePlace ?? '');
  const [carpoolListed, setCarpoolListed] = useState(initial.form.carpoolListed ?? false);
  const [fsaError, setFsaError] = useState('');
  const [volunteeringSelections, setVolunteeringSelections] = useState(initial.form.volunteeringSelections);
  const [volunteeringOtherDetail, setVolunteeringOtherDetail] = useState(initial.form.volunteeringOtherDetail);
  const [musicRequests, setMusicRequests] = useState(initial.form.musicRequests);
  const [messageToOrganizers, setMessageToOrganizers] = useState(initial.form.messageToOrganizers);
  const [restored, setRestored] = useState(initial.restored);
  // The name filled in for a new registration (#133): part of the untouched form, not a change.
  const [prefilledName, setPrefilledName] = useState('');
  const { toasts, addToast, removeToast } = useToasts();
  const formTopRef = useRef(null);
  const isEditing = !!userRegistration;

  // A new registration starts with arrival on the event's first day and departure on its last
  // (#123): most people stay the whole event. Only while a field is still empty, so it never
  // overwrites what the member picked.
  useEffect(() => {
    if (isEditing) return;
    setTransportArrival(current => current || travelRange.defaultArrival);
    setTransportDeparture(current => current || travelRange.defaultDeparture);
  }, [isEditing, travelRange.defaultArrival, travelRange.defaultDeparture]);

  // A different registration handed in after the first render replaces the form. The same one
  // fetched again (a new object, as happens right after mounting) must not: it would wipe what
  // the member typed, or the draft just restored.
  const shownRegistration = useRef(formStateOf(userRegistration));
  useEffect(() => {
    if (!userRegistration?.attendees || sameFormState(shownRegistration.current, formStateOf(userRegistration))) return;
    shownRegistration.current = formStateOf(userRegistration);
    const form = formStateOf(userRegistration, travelRange);
    setAttendees(form.attendees);
    setSameForEveryone(form.sameForEveryone);
    setTransportType(form.transportType);
    setTransportSeats(form.transportSeats);
    setTransportArrival(form.transportArrival);
    setTransportDeparture(form.transportDeparture);
    setTransportDepartureFsa(form.transportDepartureFsa);
    setTransportDeparturePlace(form.transportDeparturePlace);
    setCarpoolListed(form.carpoolListed);
    setVolunteeringSelections(form.volunteeringSelections);
    setVolunteeringOtherDetail(form.volunteeringOtherDetail);
    setMusicRequests(form.musicRequests);
    setMessageToOrganizers(form.messageToOrganizers);
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
      setAttendees(current => (current[0].name ? current : [{ ...current[0], name }, ...current.slice(1)]));
    };
    prefillName();
    return () => { ignore = true; };
  }, [isEditing, adminMode]);

  // Offering a lift counts the seats offered; needing one, the seats needed (#179), which starts
  // at the party's size: most parties travel together. No lift, no departure place (#181), and
  // nothing to show on the carpool board (#180).
  const changeTransportType = (type) => {
    if (type === transportType) return;
    setTransportType(type);
    setTransportSeats(type === 'need' ? attendees.length : 0);
    if (type !== 'offer' && type !== 'need') {
      setTransportDepartureFsa('');
      setTransportDeparturePlace('');
      setCarpoolListed(false);
      setFsaError('');
    }
  };

  // Sync logistics across attendees when "same for everyone" is enabled
  useEffect(() => {
    if (!sameForEveryone || attendees.length < 2) return;
    const first = attendees[0];
    const needsSync = attendees.some(att => LOGISTICS_FIELDS.some(field => !sameChoice(att[field], first[field])));
    if (needsSync) {
      setAttendees(attendees.map(att => ({
        ...att,
        ...Object.fromEntries(LOGISTICS_FIELDS.map(field => [field, first[field]]))
      })));
    }
  }, [sameForEveryone, attendees]);

  // Unsaved: the form differs from what it shows untouched (the saved registration, or a new one
  // with its defaults and prefilled name). Changing a field and back again is not a change.
  const formState = {
    attendees, sameForEveryone, transportType, transportSeats, transportArrival, transportDeparture,
    transportDepartureFsa, transportDeparturePlace, carpoolListed, volunteeringSelections, volunteeringOtherDetail, musicRequests, messageToOrganizers
  };
  const untouchedForm = useMemo(() => {
    const form = formStateOf(userRegistration, travelRange);
    if (userRegistration || !prefilledName) return form;
    return { ...form, attendees: [{ ...form.attendees[0], name: prefilledName }] };
  }, [userRegistration, travelRange, prefilledName]);
  const isDirty = !sameFormState(formState, untouchedForm);

  // Set once the registration is saved or the member chose to leave: the draft is gone for good,
  // and the navigation that follows must not ask.
  const draftClosed = useRef(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const closeDraft = () => {
    draftClosed.current = true;
    storeDraft(draftKey, null);
  };

  const formJson = JSON.stringify(formState);
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

  const estimatedBalance = useMemo(() => {
    if (!event) return 0;
    return simulateEventPricing(
      [{
        id: 'temp-party',
        is_paid: false,
        attendees: attendees.map(a => ({ type: a.type, participation: a.participation, isNewMember: a.isNewMember }))
      }],
      basePrice,
      ratios
    ).calculated_amount_owed;
  }, [attendees, event, basePrice, ratios]);

  const isWaitlisted = !!(event?.max_attendees && attendees.length > event.max_attendees);

  const handleAddAttendee = () => {
    setAttendees([...attendees, newAttendee(`attendee-${Date.now()}`)]);
  };

  const handleRemoveAttendee = (id) => {
    if (attendees.length > 1) setAttendees(attendees.filter(attendee => attendee.id !== id));
  };

  // A field and its value, or an object of several fields.
  const changesOf = (field, value) => (typeof field === 'object' ? field : { [field]: value });

  const handleAttendeeChange = (id, field, value) => {
    const changes = changesOf(field, value);
    setAttendees(attendees.map(attendee => (attendee.id === id ? { ...attendee, ...changes } : attendee)));
    if (field === 'name' && value.trim()) setNameErrors(prev => ({ ...prev, [id]: undefined }));
    if ('dietaryNeeds' in changes || 'dietaryOther' in changes) setDietErrors(prev => ({ ...prev, [id]: undefined }));
  };

  // "Mêmes choix pour tout le monde": edits go to everyone at once.
  const handleGroupStayChange = (field, value) => {
    const changes = changesOf(field, value);
    setAttendees(attendees.map(attendee => ({ ...attendee, ...changes })));
    if ('dietaryNeeds' in changes || 'dietaryOther' in changes) setDietErrors({});
  };

  const handleAgeChange = (id, type) => {
    setAttendees(attendees.map(attendee => {
      if (attendee.id !== id) return attendee;
      if (type === 'Kid') return { ...attendee, type, participation: 'After-Party' };
      return { ...attendee, type, participation: attendee.participation === 'After-Party' ? 'Whole' : attendee.participation };
    }));
  };

  const validateNames = () => {
    const errors = {};
    attendees.forEach(attendee => {
      if (!attendee.name.trim()) errors[attendee.id] = fr.nameRequiredError;
    });
    setNameErrors(errors);
    const firstInvalid = attendees.find(attendee => errors[attendee.id]);
    if (firstInvalid) {
      setStep(0);
      requestAnimationFrame(() => document.getElementById(`name-${firstInvalid.id}`)?.focus());
      return false;
    }
    return true;
  };

  // « Autre » needs its text (the database refuses it blank).
  const validateDietary = () => {
    const errors = Object.fromEntries(attendees.filter(needsDietaryDetail).map(attendee => [attendee.id, fr.dietaryOtherRequired]));
    setDietErrors(errors);
    const firstInvalid = attendees.find(attendee => errors[attendee.id]);
    if (firstInvalid) {
      setStep(1);
      const idPrefix = sameForEveryone || attendees.length === 1 ? 'group' : firstInvalid.id;
      requestAnimationFrame(() => document.getElementById(`diet-other-${idPrefix}`)?.focus());
      return false;
    }
    return true;
  };

  // The departure postal code is optional, but not malformed (the database refuses it).
  const validateDepartureFsa = () => {
    if (!departureFsaInvalid(formState)) {
      setFsaError('');
      return true;
    }
    setFsaError(fr.transportDepartureFsaInvalid);
    setStep(2);
    requestAnimationFrame(() => document.getElementById('transport-departure-fsa')?.focus());
    return false;
  };

  const goToStep = (index) => {
    if (index > step && step === 0 && !validateNames()) return;
    if (index > step && step === 1 && !validateDietary()) return;
    if (index > step && step === 2 && !validateDepartureFsa()) return;
    setStep(index);
    requestAnimationFrame(() => formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step < STEPS.length - 1 && !isEditing) {
      goToStep(step + 1);
      return;
    }
    if (!validateNames() || !validateDietary() || !validateDepartureFsa()) return;
    if (!event || !event.id) {
      setError(fr.eventNotSpecifiedError);
      addToast(fr.eventNotSpecifiedError, 'error');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Handle admin mode vs normal mode
      let userId;
      let authUser = null; // Only populated in normal mode for self-healing
      if (adminMode && userRegistration) {
        // In admin mode, use the user_id from the existing registration
        userId = userRegistration.user_id;
      } else {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw appError(fr.mustBeSignedInError);
        userId = user.id;
        authUser = user;
      }

      // The bed an admin assigned stays on the attendee; the form never sends one.
      const attendeesData = attendees.map(attendee => ({
        ...(attendee.isSaved ? { id: attendee.id } : {}),
        name: attendee.name.trim(),
        type: attendee.type,
        participation: attendee.participation,
        is_new_member: attendee.isNewMember,
        sleeping_preference: attendee.sleepingPreference,
        sleeping_preference_other: attendee.sleepingPreferenceOther,
        dietary_needs: attendee.dietaryNeeds,
        bed_reason: attendee.bedReason,
        bed_reason_other: attendee.bedReasonOther,
        dietary_other: attendee.dietaryNeeds.includes('other') ? attendee.dietaryOther.trim() : ''
      }));

      // Party-wide answers only; everything about a person is on their attendee row.
      const logistics = {
        volunteering: volunteeringSelections,
        volunteering_other: volunteeringOtherDetail
      };

      const transport = transportOf(formState);

      // Get or create user profile (self-healing if missing)
      const { data: fetchedProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('Supabase profiles fetch error:', fetchError.message, fetchError.code, fetchError.details, fetchError.hint, JSON.stringify(fetchError));
        throw fetchError;
      }
      let profile = fetchedProfile;

      // If profile doesn't exist, attempt to create it (only possible in normal mode where we have authUser)
      if (!profile && authUser) {
        const { data: upsertedProfile, error: upsertErr } = await supabase
          .from('profiles')
          .upsert([{
            id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || ''
          }], { onConflict: 'id' })
          .select('id')
          .maybeSingle();

        if (upsertErr) {
          console.error('Supabase profiles upsert error:', upsertErr.message, upsertErr.code, upsertErr.details, upsertErr.hint, JSON.stringify(upsertErr));
          throw upsertErr;
        }
        profile = upsertedProfile;
      }

      if (!profile) {
        throw appError(adminMode ? fr.adminProfileMissingError : fr.profileMissingError);
      }

      // Party and attendees in one transaction. The database computes the amount owed, the price
      // lock and the waitlist, registers the party (again, if it was cancelled), and leaves
      // payment_status and admin_notes alone.
      let savedParty;
      try {
        savedParty = await saveRegistration(supabase, {
          eventId: event.id,
          attendees: attendeesData,
          party: {
            logistics,
            transport,
            music_requests: musicRequests,
            message_to_organizers: messageToOrganizers
          },
          userId: adminMode ? userId : undefined
        });
      } catch (saveError) {
        console.error('save_registration error:', saveError.message, saveError.code, saveError.details, saveError.hint, JSON.stringify(saveError));
        throw saveError;
      }

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
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <div ref={formTopRef} className="scroll-mt-24" />

      {/* Step header: every step is reachable; moving forward from step 1 validates names. */}
      <nav aria-label={fr.registrationStepsLabel} className="mb-6">
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((s, index) => {
            const isCurrent = index === step;
            const hasError = (index === 0 && Object.values(nameErrors).some(Boolean)) || (index === 1 && Object.values(dietErrors).some(Boolean)) || (index === 2 && !!fsaError);
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
                      <Field label={fr.fullNameLabel} error={nameErrors[attendee.id]} htmlFor={`name-${attendee.id}`}>
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
                          onChange={value => handleAgeChange(attendee.id, value)}
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
                <Toggle label={fr.sameForEveryone} checked={sameForEveryone} onChange={setSameForEveryone} />
              </Card>
            )}
            {sameForEveryone || attendees.length === 1 ? (
              <Card className="p-5">
                <StayChoices attendee={attendees[0]} onChange={handleGroupStayChange} idPrefix="group" dietError={dietErrors[attendees[0].id]} />
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
                        dietError={dietErrors[attendee.id]}
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
                    value={transportSeats} onChange={setTransportSeats} min={transportType === 'need' ? 1 : 0} max={20} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={fr.transportArrival} className="min-w-0">
                  {({ id }) => <Input id={id} type="datetime-local" min={travelRange.min || undefined} max={travelRange.max || undefined} className="min-w-0 max-w-full" value={transportArrival} onChange={(e) => setTransportArrival(e.target.value)} />}
                </Field>
                <Field label={fr.transportDeparture} className="min-w-0">
                  {({ id }) => <Input id={id} type="datetime-local" min={travelRange.min || undefined} max={travelRange.max || undefined} className="min-w-0 max-w-full" value={transportDeparture} onChange={(e) => setTransportDeparture(e.target.value)} />}
                </Field>
              </div>
              {(transportType === 'offer' || transportType === 'need') && (
                <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
                  <Field label={fr.transportDepartureFsa} hint={fr.transportDepartureFsaHint} error={fsaError} htmlFor="transport-departure-fsa" className="min-w-0">
                    {({ id, describedBy, invalid }) => (
                      <Input id={id} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={7}
                        placeholder={fr.transportDepartureFsaPlaceholder} aria-describedby={describedBy} invalid={invalid}
                        className="font-data" value={transportDepartureFsa}
                        onChange={(e) => { setTransportDepartureFsa(e.target.value.toUpperCase()); setFsaError(''); }}
                        onBlur={() => setTransportDepartureFsa(current => normalizeFsa(current))} />
                    )}
                  </Field>
                  <Field label={fr.transportDeparturePlace} className="min-w-0">
                    {({ id }) => <Input id={id} type="text" maxLength={DEPARTURE_PLACE_MAX_LENGTH} placeholder={fr.transportDeparturePlacePlaceholder} value={transportDeparturePlace} onChange={(e) => setTransportDeparturePlace(e.target.value)} />}
                  </Field>
                </div>
              )}
              {(transportType === 'offer' || transportType === 'need') && (
                <Toggle checked={carpoolListed} onChange={setCarpoolListed}
                  label={fr.carpoolListedLabel} description={fr.carpoolListedHint} />
              )}
            </Card>
            <Card className="space-y-4 p-5">
              <ChipGroup
                label={fr.volunteering}
                multiple
                size="sm"
                options={VOLUNTEERING_OPTIONS}
                value={volunteeringSelections}
                onChange={setVolunteeringSelections}
              />
              {volunteeringSelections.includes('other') && (
                <Field label={fr.pleaseSpecify}>
                  {({ id }) => <Input id={id} value={volunteeringOtherDetail} onChange={(e) => setVolunteeringOtherDetail(e.target.value)} placeholder={fr.volunteeringOtherPlaceholder} />}
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
                {({ id }) => <Textarea id={id} value={musicRequests} onChange={(e) => setMusicRequests(e.target.value)} placeholder={fr.musicRequestsPlaceholder} />}
              </Field>
              <Field label={fr.messageToOrganizers}>
                {({ id }) => <Textarea id={id} value={messageToOrganizers} onChange={(e) => setMessageToOrganizers(e.target.value)} placeholder={fr.messageToOrganizersPlaceholder} />}
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
