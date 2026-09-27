import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Ban, BedDouble, CarFront, Caravan, Check, Hand, Layers, Leaf, Sofa, Sprout,
  Tent, Trash2, UserPlus, Utensils, WheatOff
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { calculatePricePerPointFromSellingPrice, getFinalPoints, simulateEventPricing } from '../lib/pricingEngine';
import fr from '../locales/fr.json';
import { formatCurrency } from '../lib/format';
import { plural } from '../lib/eventDisplay';
import { useToasts } from '../hooks/useToasts';
import ToastContainer from './Toast';
import { Button, Card, ChipGroup, Field, Input, Notice, Stepper, Textarea, Toggle, cx } from './ui';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  DIETARY_OPTIONS,
  REGISTRATION_STATUS,
  PAYMENT_STATUS
} from '../lib/registrationOptions';

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

const ACCOMMODATION_ICONS = { camping: Tent, floor: Layers, bed: BedDouble, sofa: Sofa, outside_other: Caravan };
const DIETARY_ICONS = { none: Ban, vegetarian: Leaf, vegan: Sprout, gluten_free: WheatOff, other: Utensils };
const TRANSPORT_ICONS = { offer: CarFront, need: Hand };

const withIcons = (options, icons) => options.map(option => ({ ...option, icon: icons[option.value] }));
const ACCOMMODATION_CHIPS = withIcons(ACCOMMODATION_OPTIONS, ACCOMMODATION_ICONS);
const DIETARY_CHIPS = withIcons(DIETARY_OPTIONS, DIETARY_ICONS);
const TRANSPORT_CHIPS = [{ value: '', label: fr.transportTypeNone, icon: Ban }, ...withIcons(TRANSPORT_TYPES, TRANSPORT_ICONS)];

const LOGISTICS_FIELDS = ['sleepingPreference', 'sleepingPreferenceOther', 'dietaryNeeds', 'bedReason', 'bedReasonOther', 'dietaryOther'];

const newAttendee = (id) => ({
  id,
  name: '',
  type: 'Adult',
  participation: 'Whole',
  isNewMember: false,
  sleepingPreference: '',
  sleepingPreferenceOther: '',
  dietaryNeeds: '',
  bedReason: '',
  bedReasonOther: '',
  dietaryOther: ''
});

const toLocalDateTime = (value) => (value && value.includes('T') ? value.slice(0, 16) : value || '');

// Per-attendee sleeping + food choices. Rendered once for the whole group ("mêmes choix pour
// tout le monde") or once per attendee.
const StayChoices = ({ attendee, onChange, idPrefix }) => (
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
        options={DIETARY_CHIPS}
        value={attendee.dietaryNeeds}
        onChange={value => onChange('dietaryNeeds', value)}
      />
      {attendee.dietaryNeeds === 'other' && (
        <Field label={fr.pleaseSpecify}>
          {({ id }) => <Input id={id} value={attendee.dietaryOther} onChange={e => onChange('dietaryOther', e.target.value)} placeholder={fr.dietaryOtherPlaceholder} />}
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

const RegistrationForm = ({ event, userRegistration, onRegistrationSuccess, onCancel, adminMode = false, onAdminSave, isIntent = false }) => {
  const [attendees, setAttendees] = useState([newAttendee('attendee-1')]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [nameErrors, setNameErrors] = useState({});

  const [sameForEveryone, setSameForEveryone] = useState(true);
  const [transportType, setTransportType] = useState('');
  const [transportSeats, setTransportSeats] = useState(0);
  const [transportArrival, setTransportArrival] = useState('');
  const [transportDeparture, setTransportDeparture] = useState('');
  const [volunteeringSelections, setVolunteeringSelections] = useState([]);
  const [volunteeringOtherDetail, setVolunteeringOtherDetail] = useState('');
  const [musicRequests, setMusicRequests] = useState('');
  const [messageToOrganizers, setMessageToOrganizers] = useState('');
  const { toasts, addToast, removeToast } = useToasts();
  const formTopRef = useRef(null);
  const isEditing = !!userRegistration;

  // Initialize with existing registration or default attendee
  useEffect(() => {
    if (!userRegistration?.attendees) return;
    const formattedAttendees = userRegistration.attendees.map((attendee, index) => ({
      id: `attendee-${index}`,
      name: attendee.name || '',
      type: attendee.type || 'Adult',
      participation: attendee.participation || 'Whole',
      isNewMember: attendee.is_new_member || false,
      sleepingPreference: attendee.sleeping_preference || '',
      sleepingPreferenceOther: attendee.sleeping_preference_other || '',
      dietaryNeeds: attendee.dietary_needs || '',
      bedReason: attendee.bed_reason || '',
      bedReasonOther: attendee.bed_reason_other || '',
      dietaryOther: attendee.dietary_other || '',
      assignedBed: attendee.assigned_bed || ''
    }));
    setAttendees(formattedAttendees);
    // Only start in "same for everyone" mode if the saved choices really are identical; otherwise
    // the sync below would overwrite everyone's choices with the first attendee's.
    const [first, ...rest] = formattedAttendees;
    setSameForEveryone(rest.every(att => LOGISTICS_FIELDS.every(field => att[field] === first[field])));
    setTransportType(userRegistration.transport?.type || '');
    setTransportSeats(userRegistration.transport?.seats || 0);
    setTransportArrival(toLocalDateTime(userRegistration.transport?.arrival));
    setTransportDeparture(toLocalDateTime(userRegistration.transport?.departure));
    setVolunteeringSelections(userRegistration.logistics?.volunteering || []);
    setVolunteeringOtherDetail(userRegistration.logistics?.volunteering_other || '');
    setMusicRequests(userRegistration.music_requests || '');
    setMessageToOrganizers(userRegistration.message_to_organizers || '');
  }, [userRegistration]);

  // Sync logistics across attendees when "same for everyone" is enabled
  useEffect(() => {
    if (!sameForEveryone || attendees.length < 2) return;
    const first = attendees[0];
    const needsSync = attendees.some(att => LOGISTICS_FIELDS.some(field => att[field] !== first[field]));
    if (needsSync) {
      setAttendees(attendees.map(att => ({
        ...att,
        ...Object.fromEntries(LOGISTICS_FIELDS.map(field => [field, first[field]]))
      })));
    }
  }, [sameForEveryone, attendees]);

  const pricePerPoint = calculatePricePerPointFromSellingPrice(event?.selling_price_whole_event || 0);

  const estimatedBalance = useMemo(() => {
    if (!event) return 0;
    return simulateEventPricing(
      [{
        id: 'temp-party',
        is_paid: false,
        attendees: attendees.map(a => ({ type: a.type, participation: a.participation, isNewMember: a.isNewMember }))
      }],
      event.selling_price_whole_event || 0
    ).calculated_amount_owed;
  }, [attendees, event]);

  const isWaitlisted = !!(event?.max_attendees && attendees.length > event.max_attendees);

  const handleAddAttendee = () => {
    setAttendees([...attendees, newAttendee(`attendee-${Date.now()}`)]);
  };

  const handleRemoveAttendee = (id) => {
    if (attendees.length > 1) setAttendees(attendees.filter(attendee => attendee.id !== id));
  };

  const handleAttendeeChange = (id, field, value) => {
    setAttendees(attendees.map(attendee => (attendee.id === id ? { ...attendee, [field]: value } : attendee)));
    if (field === 'name' && value.trim()) setNameErrors(prev => ({ ...prev, [id]: undefined }));
  };

  // "Mêmes choix pour tout le monde": edits go to everyone at once.
  const handleGroupStayChange = (field, value) => {
    setAttendees(attendees.map(attendee => ({ ...attendee, [field]: value })));
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

  const goToStep = (index) => {
    if (index > step && step === 0 && !validateNames()) return;
    setStep(index);
    requestAnimationFrame(() => formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step < STEPS.length - 1 && !isEditing) {
      goToStep(step + 1);
      return;
    }
    if (!validateNames()) return;
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
        if (!user) throw new Error(fr.mustBeSignedInError);
        userId = user.id;
        authUser = user;
      }

      const attendeesData = attendees.map(attendee => ({
        name: attendee.name.trim(),
        type: attendee.type,
        participation: attendee.participation,
        is_new_member: attendee.isNewMember,
        sleeping_preference: attendee.sleepingPreference,
        sleeping_preference_other: attendee.sleepingPreferenceOther,
        dietary_needs: attendee.dietaryNeeds,
        bed_reason: attendee.bedReason,
        bed_reason_other: attendee.bedReasonOther,
        dietary_other: attendee.dietaryOther,
        assigned_bed: attendee.assignedBed || ''
      }));

      const counts = {
        adult_whole: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Whole').length,
        adult_main: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Main').length,
        teen_whole: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Whole').length,
        teen_main: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Main').length,
        kids: attendeesData.filter(a => a.type === 'Kid').length
      };
      // Party-wide fields only; per-attendee accommodation, bed reason and bed assignment live on
      // each entry in attendeesData instead.
      const logistics = {
        food_requests: {
          requests: attendees.map(a => a.dietaryNeeds).filter(Boolean).join(', '),
          notes: attendees.map(a => a.dietaryOther).filter(Boolean).join(', ')
        },
        volunteering: volunteeringSelections,
        volunteering_other: volunteeringOtherDetail
      };

      const transport = {
        type: transportType,
        seats: transportType === 'offer' ? transportSeats : 0,
        arrival: transportArrival,
        departure: transportDeparture
      };

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
        throw new Error(adminMode ? fr.adminProfileMissingError : fr.profileMissingError);
      }

      const registrationData = {
        user_id: userId,
        event_id: event.id,
        attendees: attendeesData,
        counts: counts,
        calculated_amount_owed: estimatedBalance,
        status: REGISTRATION_STATUS.REGISTERED,
        // A self-edit of an existing registration must not reset payment_status to unpaid — that
        // would silently un-grandfather calculated_amount_owed on the next save (issue #31), since
        // the server-side trigger keys the grandfathering off the row's own persisted status.
        payment_status: userRegistration ? userRegistration.payment_status : PAYMENT_STATUS.UNPAID,
        is_waitlisted: isWaitlisted,
        logistics: logistics,
        transport: transport,
        music_requests: musicRequests,
        message_to_organizers: messageToOrganizers
      };

      // Single upsert call that handles both insert and update, respecting the UNIQUE(user_id, event_id) constraint.
      const { data: upsertedRows, error: upsertError } = await supabase
        .from('user_parties')
        .upsert([registrationData], { onConflict: 'user_id,event_id' })
        .select();

      if (upsertError) {
        console.error('Supabase user_parties upsert error:', upsertError.message, upsertError.code, upsertError.details, upsertError.hint, JSON.stringify(upsertError));
        throw upsertError;
      }

      if (!upsertedRows || upsertedRows.length === 0) {
        throw new Error(fr.noRowReturnedError);
      }

      if (adminMode && onAdminSave) {
        onAdminSave();
      } else if (onRegistrationSuccess) {
        onRegistrationSuccess(upsertedRows[0]);
      }
    } catch (err) {
      console.error('Erreur lors de l\'inscription:', err);
      setError(err.message);
      addToast(err.message, 'error');
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
            const hasError = index === 0 && Object.values(nameErrors).some(Boolean);
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
                        {pricePerPoint > 0 && (
                          <span className="font-data text-sm text-ink">{formatCurrency(getFinalPoints(attendee) * pricePerPoint)}</span>
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
                <StayChoices attendee={attendees[0]} onChange={handleGroupStayChange} idPrefix="group" />
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
            <Card className="space-y-5 p-5">
              <h3 className="text-lg font-semibold text-ink">{fr.transport}</h3>
              <ChipGroup label={fr.transportType} name="transport-type" options={TRANSPORT_CHIPS} value={transportType} onChange={setTransportType} />
              {transportType === 'offer' && (
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="transport-seats" className="text-base text-ink">{fr.transportSeats}</label>
                  <Stepper id="transport-seats" label={fr.transportSeats} value={transportSeats} onChange={setTransportSeats} max={20} />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={fr.transportArrival}>
                  {({ id }) => <Input id={id} type="datetime-local" value={transportArrival} onChange={(e) => setTransportArrival(e.target.value)} />}
                </Field>
                <Field label={fr.transportDeparture}>
                  {({ id }) => <Input id={id} type="datetime-local" value={transportDeparture} onChange={(e) => setTransportDeparture(e.target.value)} />}
                </Field>
              </div>
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
                    {pricePerPoint > 0 && <span className="font-data text-sm text-muted">{formatCurrency(getFinalPoints(attendee) * pricePerPoint)}</span>}
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
            {/* Cancelling is the close button above the form (page header or dialog header). */}
            {step > 0 && (
              <Button variant="ghost" size="icon" onClick={() => goToStep(step - 1)} aria-label={fr.previousStep}>
                <ArrowLeft aria-hidden="true" className="size-5" />
              </Button>
            )}
            {isEditing && !isLastStep && (
              <Button variant="secondary" onClick={() => goToStep(step + 1)} aria-label={fr.nextStep}>
                <ArrowRight aria-hidden="true" className="size-5" />
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
          </div>
        </div>
      </div>
    </form>
  );
};

export default RegistrationForm;
