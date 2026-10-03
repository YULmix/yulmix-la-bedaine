import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { adminHref } from '../../../lib/adminRoutes';
import { activateEvent, archiveEvent, refreshEvents, useEvents } from '../../../lib/events';
import { discardEventDraft, saveEventDraft, setEventDraftField, useEventDraft, useUnsavedEventIds } from '../../../lib/eventDrafts';
import { dirtyFields, validateDraft } from '../../../lib/eventDraft';
import { useToasts } from '../../../hooks/useToasts';
import { AdminEventList } from '../AdminEvents';
import EventEditor from '../EventEditor';
import { Button, ConfirmDialog, EmptyState } from '../../ui';
import SectionStatus from './SectionStatus';

// Événements (#195): the event list (activate, archive) and, at /admin/events/:id, the event
// editor, whose unsaved changes live in the event draft store (and sessionStorage).
const EventsSection = ({ eventId, editorSection }) => {
  const navigate = useNavigate();
  const { events, loading, error } = useEvents();
  const unsavedIds = useUnsavedEventIds(events);
  const editingEvent = eventId ? events.find(event => event.id === eventId) : null;
  const draft = useEventDraft(editingEvent?.id);
  const [pendingArchive, setPendingArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const { addToast } = useToasts(1699);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  const go = (to) => navigate(adminHref(to));
  const backToEvents = () => go({ section: 'events' });

  if (eventId && !editingEvent) {
    return (
      <EmptyState icon={CalendarRange} title={fr.eventEditorNotFound}
        action={<Button variant="secondary" onClick={backToEvents}>{fr.adminTabEvents}</Button>} />
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
