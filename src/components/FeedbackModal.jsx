import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import { Button, Dialog, Field, Notice, Textarea } from './ui';

// Opened from the account menu or the footer ("Signaler un problème"). It used to be a floating
// button, which sat on top of the registration form's save button on phones.
const FeedbackModal = ({ userId, open, onClose }) => {
  const [content, setContent] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setContent('');
    setScreenshotUrl(null);
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file || !userId) return;

    setUploadingScreenshot(true);
    setError(null);
    try {
      const extension = file.type.split('/')[1] || 'png';
      const path = `${userId}/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('feedback')
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('feedback').getPublicUrl(path);
      setScreenshotUrl(publicUrlData.publicUrl);
    } catch (err) {
      console.error('Error uploading feedback screenshot:', err);
      setError(fr.feedbackError);
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userId || !content.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from('app_feedback').insert([{
        user_id: userId,
        content: content.trim(),
        screenshot_url: screenshotUrl
      }]);
      if (insertError) throw insertError;

      setSuccess(true);
      setContent('');
      setScreenshotUrl(null);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError(fr.feedbackError);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!userId) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={fr.feedbackModalTitle}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose}>{fr.feedbackCancel}</Button>
          <Button type="submit" form="feedback-form" loading={isSubmitting} disabled={uploadingScreenshot || !content.trim()}>
            {fr.feedbackSubmit}
          </Button>
        </>
      )}
    >
      <form id="feedback-form" onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        {error && <Notice tone="bad">{error}</Notice>}
        {success && <Notice tone="ok" role="status">{fr.feedbackSuccess}</Notice>}
        <Field label={fr.feedbackFieldLabel} hint={fr.feedbackPasteHint}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={handlePaste}
              rows={5}
              required
              placeholder={fr.feedbackPlaceholder}
            />
          )}
        </Field>

        {uploadingScreenshot && (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <ImagePlus aria-hidden="true" className="size-4" /> {fr.feedbackScreenshotUploading}
          </p>
        )}

        {screenshotUrl && !uploadingScreenshot && (
          <div className="relative inline-block self-start">
            <img src={screenshotUrl} alt={fr.feedbackScreenshotAlt} className="max-h-40 rounded-control border border-line" />
            <button
              type="button"
              onClick={() => setScreenshotUrl(null)}
              aria-label={fr.feedbackRemoveScreenshot}
              className="absolute -right-3 -top-3 grid size-8 place-items-center rounded-full border border-edge bg-raised text-ink hover:bg-surface"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
};

export default FeedbackModal;
