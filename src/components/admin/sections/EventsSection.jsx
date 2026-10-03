import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Plus } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { NEW_EVENT_ID, adminHref } from '../../../lib/adminRoutes';
import { activateEvent, archiveEvent, refreshEvents, useEvents } from '../../../lib/events';
import { createEventFromDraft, discardEventDraft, saveEventDraft, setEventDraftField, useEventDraft, useUnsavedEventIds } from '../../../lib/eventDrafts';
import { dirtyFields, validateDraft, validateNewEvent } from '../../../lib/eventDraft';
import { useToasts } from '../../../hooks/useToasts';
import { AdminEventList } from '../AdminEvents';
import { AdminHeaderActions } from '../AdminNav';
import EventEditor from '../EventEditor';
import { Button, ConfirmDialog, EmptyState } from '../../ui';
import SectionStatus from './SectionStatus';

// Événements (#195): the event list (activate, archive) and, at /admin/events/:id, the event
// editor, whose unsaved changes live in the event draft store (and sessionStorage). A new event
// (#111) is the same editor, empty, at /admin/events/new, its draft kept apart under NEW_EVENT_ID;
// creating asks first (an event can't be deleted, ADR 0008), inserts a draft, and opens it.
const EventsSection = ({ eventId, editorSection }) => {
  const navigate = useNavigate();
  const { events, loading, error } = useEvents();
  const unsavedIds = useUnsavedEventIds(events);
  const editingEvent = eventId ? events.find(event => event.id === eventId) : null;
  const creating = eventId === NEW_EVENT_ID;
  const draft = useEventDraft(creating ? NEW_EVENT_ID : editingEvent?.id);
  // The required fields only complain once creating was tried, not on an empty form.
  const [triedCreate, setTriedCreate] = useState(false);
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const [pendingArchive, setPendingArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const { addToast } = useToasts(1699);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  const go = (to) => navigate(adminHref(to));
  const backToEvents = () => go({ section: 'events' });

  if (eventId && !editingEvent && !creating) {
    return (
      <EmptyState icon={CalendarRange} title={fr.eventEditorNotFound}
        action={<Button variant="secondary" onClick={backToEvents}>{fr.adminTabEvents}</Button>} />
    );
  }

  if (creating) {
    const typed = validateNewEvent(draft.changes);
    const errors = triedCreate ? typed : validateDraft(null, draft.changes);
    const handleCreate = () => {
      if (Object.keys(typed).length) {
        setTriedCreate(true);
        return;
      }
      setConfirmingCreate(true);
    };
    const confirmCreate = async () => {
      const theme = String(draft.changes.theme).trim();
      try {
        const id = await createEventFromDraft();
        addToast(fr.eventCreatedToast.replace('{theme}', theme), 'success');
        setTriedCreate(false);
        // Replacing /new: Back from the new draft shouldn't land on an empty form.
        navigate(adminHref({ section: 'events', eventId: id, editorSection: 'details' }), { replace: true });
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setConfirmingCreate(false);
      }
    };
    return (
      <>
        <EventEditor
          event={null}
          section="details"
          changes={draft.changes}
          dirtyCount={Object.keys(draft.changes).length}
          errors={errors}
          restored={draft.restored && Object.keys(draft.changes).length > 0}
          saving={draft.saving}
          onChange={(field, value) => setEventDraftField(NEW_EVENT_ID, field, value)}
          onSave={handleCreate}
          onDiscard={() => { discardEventDraft(NEW_EVENT_ID); setTriedCreate(false); }}
          backTo={adminHref({ section: 'events' })}
        />
        <ConfirmDialog
          open={confirmingCreate}
          title={fr.eventCreateConfirmTitle}
          confirmLabel={fr.eventCreate}
          onConfirm={confirmCreate}
          onCancel={() => setConfirmingCreate(false)}
          loading={draft.saving}
        >
          {fr.eventCreateConfirm.replace('{theme}', String(draft.changes.theme ?? '').trim())}
        </ConfirmDialog>
      </>
    );
  }

  if (editingEvent) {
    const dirty = dirtyFields(editingEvent, draft.changes);
    const errors = validateDraft(editingEvent, draft.changes);
    const handleSave = async () => {
      if (!dirty.length || Object.keys(errors).length) return;
      try {
        await saveEventDraft(editingEvent);
        addToast(fr.eventMetadataUpdatedToast, 'success');
      } catch (err) {
        addToast(err.message, 'error');
      }
    };
    return (
      <EventEditor
        event={editingEvent}
        section={editorSection}
        onSectionChange={section => go({ section: 'events', eventId: editingEvent.id, editorSection: section })}
        onVenueChange={refreshEvents}
        changes={draft.changes}
        dirtyCount={dirty.length}
        errors={errors}
        restored={draft.restored && dirty.length > 0}
        saving={draft.saving}
        onChange={(field, value) => setEventDraftField(editingEvent.id, field, value)}
        onSave={handleSave}
        onDiscard={() => discardEventDraft(editingEvent.id)}
        backTo={adminHref({ section: 'events' })}
      />
    );
  }

  // Only one event can be active: the events store checks, and so does the database.
  const handleActivate = async (event) => {
    try {
      await activateEvent(event);
      addToast(fr.eventActivatedToast.replace('{theme}', event.theme), 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const confirmArchive = async () => {
    const event = pendingArchive;
    if (!event) return;
    setArchiving(true);
    try {
      await archiveEvent(event);
      addToast(fr.eventArchivedToast.replace('{theme}', event.theme), 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setArchiving(false);
      setPendingArchive(null);
    }
  };

  return (
    <>
      <AdminHeaderActions>
        <Button onClick={() => go({ section: 'events', eventId: NEW_EVENT_ID, editorSection: 'details' })}>
          <Plus aria-hidden="true" className="size-4.5" />{fr.eventNew}
        </Button>
      </AdminHeaderActions>
      <AdminEventList
        events={events}
        draftEventIds={unsavedIds}
        onActivate={handleActivate}
        onArchive={setPendingArchive}
        onEdit={event => go({ section: 'events', eventId: event.id, editorSection: 'details' })}
      />
      <ConfirmDialog
        open={!!pendingArchive}
        title={fr.archiveEventConfirmTitle}
        confirmLabel={fr.archiveEventButton}
        onConfirm={confirmArchive}
        onCancel={() => setPendingArchive(null)}
        loading={archiving}
      >
        {pendingArchive && fr.archiveEventConfirm.replace('{theme}', pendingArchive.theme)}
      </ConfirmDialog>
    </>
  );
};

export default EventsSection;
