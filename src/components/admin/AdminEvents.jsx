import { Archive, CalendarPlus, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatEventDates } from '../../lib/eventDisplay';
import { Button, Card, Dialog, EmptyState, Field, Input, Tag, Textarea, Toggle } from '../ui';
import { EventLocationsEditor } from './EventLocations';

const STATUS = {
  ACTIVE: { tone: 'ok', key: 'eventStatusActive' },
  ARCHIVED: { tone: 'neutral', key: 'eventStatusArchived' },
  DRAFT: { tone: 'info', key: 'draft' }
};

// Event list with lifecycle actions (activate / archive / edit). The only-one-active rule lives
// in the database (only_one_active_event); the UI checks first and reports the constraint error.
export const AdminEventList = ({ events, onActivate, onArchive, onEdit }) => (
  <section className="space-y-4">
    <h2 className="text-xl font-semibold text-ink">{fr.adminEventsManagementTitle}</h2>
    {events.length === 0 ? (
      <EmptyState icon={CalendarPlus} title={fr.noEventsYet} />
    ) : (
      <ul className="overflow-hidden rounded-card border border-line bg-surface divide-y divide-line">
        {events.map(event => {
          const status = STATUS[event.status] || STATUS.DRAFT;
          const dates = formatEventDates(event);
          return (
            <li key={event.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{event.theme}</p>
                  <Tag tone={status.tone}>{fr[status.key]}</Tag>
                  {event.is_active && event.is_reg_open && <Tag tone="neon">{fr.eventRegOpenLabel}</Tag>}
                </div>
                {dates && <p className="mt-1 font-data text-xs text-faint">{dates}</p>}
                {event.description && <p className="mt-1 line-clamp-1 text-sm text-muted">{event.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!event.is_active && event.status !== 'ARCHIVED' && (
                  <Button size="sm" onClick={() => onActivate(event)}>
                    <Power aria-hidden="true" className="size-4" />{fr.activateEventButton}
                  </Button>
                )}
                {event.is_active && (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(event)}>
                    <Pencil aria-hidden="true" className="size-4" />{fr.edit}
                  </Button>
                )}
                {event.is_active && (
                  <Button size="sm" variant="ghost" onClick={() => onArchive(event)}>
                    <Archive aria-hidden="true" className="size-4" />{fr.archiveEventButton}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

const Fieldset = ({ legend, children }) => (
  <fieldset className="space-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
    <legend className="mb-1 text-base font-semibold text-ink">{legend}</legend>
    {children}
  </fieldset>
);

const RowListEditor = ({ label, rows, fields, onChange, onAdd, onRemove, addLabel, removeLabel }) => (
  <div>
    <p className="mb-1.5 text-sm font-semibold text-muted">{label}</p>
    <ul className="space-y-2">
      {rows.map((row, index) => (
        <li key={index} className="flex gap-2">
          {fields.map(field => (
            <Input
              key={field.key}
              type={field.type || 'text'}
              step={field.step}
              aria-label={field.placeholder}
              placeholder={field.placeholder}
              value={row[field.key] ?? ''}
              onChange={e => onChange(index, field.key, field.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
              className={field.className}
            />
          ))}
          <Button variant="ghost" size="icon" onClick={() => onRemove(index)} aria-label={removeLabel}>
            <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
          </Button>
        </li>
      ))}
    </ul>
    <Button variant="ghost" size="sm" onClick={onAdd} className="mt-2">
      <Plus aria-hidden="true" className="size-4" />{addLabel}
    </Button>
  </div>
);

// The event's descriptive fields, grouped into fieldsets so the dialog reads top-down. Money
// (price, ratios, budget) is edited in the Budget tab (#109). The sleeping locations (#113) save
// as they are edited, not with the dialog's Save.
export const EventEditDialog = ({
  event,
  changes,
  onChange,
  onLinkChange,
  onAddLinkRow,
  onRemoveLinkRow,
  onSave,
  onClose
}) => {
  const value = (field, fallback = '') => changes[field] ?? event?.[field] ?? fallback;
  const num = (field, parse, fallback) => e => onChange(field, parse(e.target.value) || fallback);

  return (
    <Dialog
      open={!!event}
      onClose={onClose}
      title={fr.editEventMetadataTitle}
      size="lg"
      dismissible={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{fr.cancel}</Button>
          <Button onClick={onSave}>{fr.save}</Button>
        </>
      )}
    >
      {event && (
        <div className="space-y-6 px-5 py-5 sm:px-6">
          <Fieldset legend={fr.eventFieldsetEssentials}>
            <Field label={fr.eventTitle}>{({ id }) => <Input id={id} value={value('theme')} onChange={e => onChange('theme', e.target.value)} />}</Field>
            <Field label={fr.eventDescriptionLabel}>{({ id }) => <Textarea id={id} value={value('description')} onChange={e => onChange('description', e.target.value)} />}</Field>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <Field label={fr.eventVenueAddressLabel}>{({ id }) => <Input id={id} value={value('venue_address')} onChange={e => onChange('venue_address', e.target.value)} />}</Field>
              <Field label={fr.eventDurationLabel}>{({ id }) => <Input id={id} type="number" inputMode="numeric" value={value('duration_days')} onChange={num('duration_days', parseInt, 2)} />}</Field>
            </div>
          </Fieldset>

          <Fieldset legend={fr.eventFieldsetCalendar}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={fr.eventStartDateLabel}>{({ id }) => <Input id={id} type="date" value={value('event_start_date')} onChange={e => onChange('event_start_date', e.target.value || null)} />}</Field>
              <Field label={fr.eventRegStartDateLabel}>{({ id }) => <Input id={id} type="date" value={value('reg_start_date')} onChange={e => onChange('reg_start_date', e.target.value)} />}</Field>
              <Field label={fr.eventIntentMonthsLabel}>{({ id }) => <Input id={id} type="number" inputMode="numeric" value={value('z_intent_months')} onChange={num('z_intent_months', parseInt, 2)} />}</Field>
              <Field label={fr.eventRegCloseWeeksLabel}>{({ id }) => <Input id={id} type="number" inputMode="numeric" value={value('x_reg_close_weeks')} onChange={num('x_reg_close_weeks', parseInt, 1)} />}</Field>
              <Field label={fr.eventMaxAttendeesLabel}>{({ id }) => <Input id={id} type="number" inputMode="numeric" value={value('max_attendees')} onChange={num('max_attendees', parseInt, 90)} />}</Field>
            </div>
            <Toggle label={fr.eventRegOpenLabel} checked={!!value('is_reg_open', false)} onChange={checked => onChange('is_reg_open', checked)} />
          </Fieldset>

          <Fieldset legend={fr.eventFieldsetMembers}>
            <Field label={fr.eventPointsOfContactLabel}>{({ id }) => <Textarea id={id} value={value('points_of_contact')} onChange={e => onChange('points_of_contact', e.target.value)} />}</Field>
            <Field label={fr.eventInstructionsLabel}>{({ id }) => <Textarea id={id} rows={4} value={value('instructions')} onChange={e => onChange('instructions', e.target.value)} />}</Field>
            <RowListEditor
              label={fr.eventExternalLinksLabel}
              rows={value('external_links', [])}
              fields={[
                { key: 'label', placeholder: fr.eventExternalLinksLabelPlaceholder, className: 'flex-1' },
                { key: 'url', placeholder: fr.eventExternalLinksUrlPlaceholder, type: 'url', className: 'flex-[2]' }
              ]}
              onChange={onLinkChange}
              onAdd={onAddLinkRow}
              onRemove={onRemoveLinkRow}
              addLabel={fr.eventExternalLinksAddRow}
              removeLabel={fr.eventExternalLinksRemoveRow}
            />
          </Fieldset>

          <Fieldset legend={fr.eventFieldsetSleeping}>
            <EventLocationsEditor eventId={event.id} />
          </Fieldset>
        </div>
      )}
    </Dialog>
  );
};
