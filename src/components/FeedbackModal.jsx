import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';

const FeedbackModal = ({ userId }) => {
  const [isOpen, setIsOpen] = useState(false);
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
    setIsOpen(false);
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
        setIsOpen(false);
        resetForm();
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
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 font-medium"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="hidden sm:inline">{fr.feedbackButtonLabel}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">{fr.feedbackModalTitle}</h2>
              <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{fr.feedbackSuccess}</div>
              )}

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={handlePaste}
                rows={5}
                required
                placeholder={fr.feedbackPlaceholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />

              {uploadingScreenshot && (
                <p className="text-sm text-gray-500">{fr.feedbackScreenshotUploading}</p>
              )}

              {screenshotUrl && !uploadingScreenshot && (
                <div className="relative inline-block">
                  <img src={screenshotUrl} alt={fr.feedbackScreenshotAlt} className="max-h-40 rounded-lg border border-gray-200" />
                  <button
                    type="button"
                    onClick={() => setScreenshotUrl(null)}
                    aria-label={fr.feedbackRemoveScreenshot}
                    className="absolute -top-2 -right-2 bg-gray-800 text-white rounded-full p-1 hover:bg-gray-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={handleClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
                  {fr.feedbackCancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || uploadingScreenshot || !content.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fr.feedbackSubmit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default FeedbackModal;
